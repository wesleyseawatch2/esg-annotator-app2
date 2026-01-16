// 檔案路徑: app/actions.js
'use server';
import { sql } from '@vercel/postgres';
import { revalidatePath } from 'next/cache';
import fs from 'fs/promises';
import path from 'path';

export async function registerUser(username, password) {
  try {
    const { rows } = await sql`SELECT * FROM users WHERE username = ${username};`;
    if (rows.length > 0) {
      return { success: false, error: '此使用者名稱已被註冊' };
    }
    await sql`INSERT INTO users (username, password) VALUES (${username}, ${password});`;
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function loginUser(username, password) {
  try {
    const { rows } = await sql`SELECT * FROM users WHERE username = ${username};`;
    if (rows.length === 0) {
      return { success: false, error: '找不到此使用者' };
    }
    const user = rows[0];
    if (user.password !== password) {
      return { success: false, error: '密碼錯誤' };
    }
    return { success: true, user: { id: user.id, username: user.username, role: user.role } }; 
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function getProjectsWithProgress(userId) {
  try {
    // 檢查使用者角色和帳號
    const { rows: userRows } = await sql`SELECT role, username FROM users WHERE id = ${userId};`;
    const isAdmin = userRows.length > 0 && userRows[0].role === 'admin';
    const isSuperAdmin = userRows.length > 0 && userRows[0].username === 'wesley';

    let query;

    if (isSuperAdmin || isAdmin) {
      // 超級管理員（wesley）和一般管理員可以看到所有專案
      query = sql`
        SELECT
          p.id,
          p.name,
          p.page_offset,
          p.group_id,
          pg.name as group_name,
          (SELECT COUNT(*) FROM source_data WHERE project_id = p.id) as total_tasks,
          (
            SELECT COUNT(*)
            FROM annotations a
            WHERE a.user_id = ${userId}
            AND a.source_data_id IN (SELECT id FROM source_data WHERE project_id = p.id)
            AND a.status = 'completed'
            AND (a.skipped IS NULL OR a.skipped = FALSE)
            AND a.reannotation_round = 0
          ) as completed_tasks
        FROM projects p
        LEFT JOIN project_groups pg ON p.group_id = pg.id
        ORDER BY p.name;
      `;
    } else {
      // 一般使用者只能看到：
      // 使用者有權限的群組專案（必須明確分配到群組才能看到）
      query = sql`
        SELECT
          p.id,
          p.name,
          p.page_offset,
          p.group_id,
          pg.name as group_name,
          (SELECT COUNT(*) FROM source_data WHERE project_id = p.id) as total_tasks,
          (
            SELECT COUNT(*)
            FROM annotations a
            WHERE a.user_id = ${userId}
            AND a.source_data_id IN (SELECT id FROM source_data WHERE project_id = p.id)
            AND a.status = 'completed'
            AND (a.skipped IS NULL OR a.skipped = FALSE)
            AND a.reannotation_round = 0
          ) as completed_tasks
        FROM projects p
        LEFT JOIN project_groups pg ON p.group_id = pg.id
        WHERE p.group_id IN (
          SELECT group_id FROM user_group_permissions WHERE user_id = ${userId}
        )
        ORDER BY p.name;
      `;
    }

    const { rows } = await query;
    return { projects: rows };
  } catch (error) {
    return { error: error.message };
  }
}

export async function getNextTaskForUser(projectId, userId) {
  try {
    const { rows } = await sql`
      SELECT sd.*
      FROM source_data sd
      WHERE sd.project_id = ${projectId}
      AND NOT EXISTS (
        SELECT 1 FROM annotations a WHERE a.source_data_id = sd.id AND a.user_id = ${userId}
      )
      ORDER BY sd.page_number, sd.id
      LIMIT 1;
    `;

    if (rows.length > 0) {
        return { task: rows[0] };
    }
    
    return { task: null };
  } catch (error) {
    return { error: error.message };
  }
}

// --- 切換資料的「回看標記」狀態 ---
export async function toggleAnnotationMark(sourceDataId, userId) {
  try {
    // 1. 檢查是否已有標註記錄
    const { rows } = await sql`
      SELECT id, is_marked FROM annotations 
      WHERE source_data_id = ${sourceDataId} AND user_id = ${userId};
    `;

    let newMarkedState = true;

    if (rows.length > 0) {
      // 2a. 如果已有記錄，則切換狀態
      newMarkedState = !rows[0].is_marked;
      await sql`
        UPDATE annotations 
        SET is_marked = ${newMarkedState}, updated_at = NOW()
        WHERE id = ${rows[0].id};
      `;
    } else {
      // 2b. 如果沒有記錄，則建立一筆新的
      await sql`
        INSERT INTO annotations (source_data_id, user_id, is_marked, updated_at)
        VALUES (${sourceDataId}, ${userId}, TRUE, NOW());
      `;
    }

    revalidatePath('/');
    return { success: true, isMarked: newMarkedState };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// --- 取得專案所有資料詳情（用於總覽頁面） ---
export async function getProjectTasksOverview(projectId, userId) {
  try {
    const { rows } = await sql`
      SELECT
        sd.id,
        sd.page_number,
        LEFT(sd.original_data, 200) as preview_text,
        a.status,
        a.skipped,
        a.is_marked,
        ROW_NUMBER() OVER (ORDER BY sd.page_number ASC, sd.id ASC) as sequence
      FROM source_data sd
      LEFT JOIN LATERAL (
        SELECT * FROM annotations
        WHERE source_data_id = sd.id AND user_id = ${userId}
        ORDER BY reannotation_round DESC
        LIMIT 1
      ) a ON true
      WHERE sd.project_id = ${projectId}
      ORDER BY sd.page_number ASC, sd.id ASC;
    `;
    return { success: true, tasks: rows };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function getPreviousTaskForUser(projectId, userId, currentId) {
  try {
    // 如果 currentId 是 null（已完成所有標註），返回最後一筆已標註的資料
    const { rows } = currentId === null
      ? await sql`
          SELECT
            sd.*,
            a.esg_type,
            a.promise_status,
            a.promise_string,
            a.verification_timeline,
            a.evidence_status,
            a.evidence_string,
            a.evidence_quality,
            a.is_marked
          FROM source_data sd
          JOIN annotations a ON sd.id = a.source_data_id
          WHERE sd.project_id = ${projectId}
          AND a.user_id = ${userId}
          ORDER BY sd.page_number DESC, sd.id DESC
          LIMIT 1;
        `
      : await sql`
          SELECT
            sd.*,
            a.esg_type,
            a.promise_status,
            a.promise_string,
            a.verification_timeline,
            a.evidence_status,
            a.evidence_string,
            a.evidence_quality,
            a.is_marked
          FROM source_data sd
          JOIN annotations a ON sd.id = a.source_data_id
          WHERE sd.project_id = ${projectId}
          AND a.user_id = ${userId}
          AND sd.id < ${currentId}
          ORDER BY sd.page_number DESC, sd.id DESC
          LIMIT 1;
        `;

    if (rows.length > 0) {
        return { task: rows[0] };
    }

    return { task: null };
  } catch (error) {
    return { error: error.message };
  }
}

export async function getNextTaskAfterCurrent(projectId, userId, currentId) {
  try {
    // 使用 ROW_NUMBER 來獲取當前項目之後的下一筆資料（按照 page_number 和 id 排序）
    const { rows } = await sql`
      WITH numbered_tasks AS (
        SELECT
          sd.*,
          a.esg_type,
          a.promise_status,
          a.promise_string,
          a.verification_timeline,
          a.evidence_status,
          a.evidence_string,
          a.evidence_quality,
          ROW_NUMBER() OVER (ORDER BY sd.page_number ASC, sd.id ASC) as row_num
        FROM source_data sd
        LEFT JOIN LATERAL (
          SELECT * FROM annotations
          WHERE source_data_id = sd.id AND user_id = ${userId}
          ORDER BY reannotation_round DESC
          LIMIT 1
        ) a ON true
        WHERE sd.project_id = ${projectId}
      ),
      current_row AS (
        SELECT row_num FROM numbered_tasks WHERE id = ${currentId}
      )
      SELECT nt.*
      FROM numbered_tasks nt, current_row cr
      WHERE nt.row_num = cr.row_num + 1;
    `;

    if (rows.length > 0) {
        return { task: rows[0] };
    }

    return { task: null };
  } catch (error) {
    return { error: error.message };
  }
}

export async function getSkippedTasks(projectId, userId) {
  try {
    const { rows } = await sql`
      SELECT
        sd.*,
        a.esg_type,
        a.promise_status,
        a.promise_string,
        a.verification_timeline,
        a.evidence_status,
        a.evidence_string,
        a.evidence_quality,
        a.skipped
      FROM source_data sd
      JOIN annotations a ON sd.id = a.source_data_id
      WHERE sd.project_id = ${projectId}
      AND a.user_id = ${userId}
      AND a.skipped = TRUE
      ORDER BY sd.page_number ASC, sd.id ASC;
    `;

    return { tasks: rows, count: rows.length };
  } catch (error) {
    return { error: error.message };
  }
}

export async function getTaskByPageNumber(projectId, userId, pageNumber) {
  try {
    const { rows } = await sql`
      SELECT
        sd.*,
        a.esg_type,
        a.promise_status,
        a.promise_string,
        a.verification_timeline,
        a.evidence_status,
        a.evidence_string,
        a.evidence_quality,
        a.skipped
      FROM source_data sd
      LEFT JOIN LATERAL (
        SELECT * FROM annotations
        WHERE source_data_id = sd.id AND user_id = ${userId}
        ORDER BY reannotation_round DESC
        LIMIT 1
      ) a ON true
      WHERE sd.project_id = ${projectId}
      AND sd.page_number = ${pageNumber}
      ORDER BY sd.id ASC
      LIMIT 1;
    `;

    if (rows.length > 0) {
        return { task: rows[0] };
    }

    return { task: null };
  } catch (error) {
    return { error: error.message };
  }
}

export async function getAllTasksWithStatus(projectId, userId) {
  try {
    const { rows } = await sql`
      SELECT
        sd.id,
        sd.page_number,
        sd.original_data,
        a.skipped,
        a.is_marked,
        a.status,
        a.promise_status,
        a.promise_string,
        a.evidence_status,
        a.evidence_string,
        ROW_NUMBER() OVER (ORDER BY sd.page_number ASC, sd.id ASC) as sequence
      FROM source_data sd
      LEFT JOIN LATERAL (
        SELECT * FROM annotations
        WHERE source_data_id = sd.id AND user_id = ${userId}
        ORDER BY reannotation_round DESC
        LIMIT 1
      ) a ON true
      WHERE sd.project_id = ${projectId}
      ORDER BY sd.page_number ASC, sd.id ASC;
    `;

    return { tasks: rows };
  } catch (error) {
    return { error: error.message };
  }
}

export async function validateCompletedAnnotations(projectId, userId) {
  try {
    // 首先獲取總題數
    const { rows: totalRows } = await sql`
      SELECT COUNT(*) as total
      FROM source_data sd
      WHERE sd.project_id = ${projectId};
    `;
    const totalTasks = parseInt(totalRows[0]?.total || 0);

    // 獲取已完成（非跳過）的標註
    const { rows } = await sql`
      SELECT
        sd.id,
        sd.page_number,
        a.esg_type,
        a.promise_status,
        a.promise_string,
        a.verification_timeline,
        a.evidence_status,
        a.evidence_string,
        a.evidence_quality,
        ROW_NUMBER() OVER (ORDER BY sd.page_number ASC, sd.id ASC) as sequence
      FROM source_data sd
      JOIN annotations a ON sd.id = a.source_data_id
      WHERE sd.project_id = ${projectId}
      AND a.user_id = ${userId}
      AND a.status = 'completed'
      AND a.skipped = FALSE;
    `;

    const invalidTasks = rows.filter(task => {
      const issues = [];

      // 1. 檢查承諾狀態是否已選擇
      if (!task.promise_status || (task.promise_status !== 'Yes' && task.promise_status !== 'No')) {
        issues.push('未選擇承諾狀態');
      }

      // 2. 如果承諾狀態為 Yes，檢查相關欄位
      if (task.promise_status === 'Yes') {
        // 2.1 檢查承諾標記
        if (!task.promise_string || task.promise_string.trim() === '') {
          issues.push('缺少承諾標記');
        }

        // 2.2 檢查驗證時間軸
        const validTimelines = ['within_2_years', 'between_2_and_5_years', 'longer_than_5_years', 'already'];
        if (!task.verification_timeline || !validTimelines.includes(task.verification_timeline)) {
          issues.push('未選擇驗證時間軸');
        }

        // 2.3 檢查證據狀態
        if (!task.evidence_status || (task.evidence_status !== 'Yes' && task.evidence_status !== 'No')) {
          issues.push('未選擇證據狀態');
        }

        // 2.4 如果證據狀態為 Yes，檢查證據標記和品質
        if (task.evidence_status === 'Yes') {
          if (!task.evidence_string || task.evidence_string.trim() === '') {
            issues.push('缺少證據標記');
          }

          const validQualities = ['Clear', 'Not Clear', 'Misleading'];
          if (!task.evidence_quality || !validQualities.includes(task.evidence_quality)) {
            issues.push('未選擇證據品質');
          }
        }
      }

      return issues.length > 0;
    });

    return {
      totalTasks: totalTasks,
      totalCompleted: rows.length,
      invalidCount: invalidTasks.length,
      invalidTasks: invalidTasks.map(t => {
        const issues = [];

        if (!t.promise_status || (t.promise_status !== 'Yes' && t.promise_status !== 'No')) {
          issues.push('未選擇承諾狀態');
        }

        if (t.promise_status === 'Yes') {
          if (!t.promise_string || t.promise_string.trim() === '') {
            issues.push('缺少承諾標記');
          }

          const validTimelines = ['within_2_years', 'between_2_and_5_years', 'longer_than_5_years', 'already'];
          if (!t.verification_timeline || !validTimelines.includes(t.verification_timeline)) {
            issues.push('未選擇驗證時間軸');
          }

          if (!t.evidence_status || (t.evidence_status !== 'Yes' && t.evidence_status !== 'No')) {
            issues.push('未選擇證據狀態');
          }

          if (t.evidence_status === 'Yes') {
            if (!t.evidence_string || t.evidence_string.trim() === '') {
              issues.push('缺少證據標記');
            }

            const validQualities = ['Clear', 'Not Clear', 'Misleading'];
            if (!t.evidence_quality || !validQualities.includes(t.evidence_quality)) {
              issues.push('未選擇證據品質');
            }
          }
        }

        return {
          sequence: t.sequence,
          pageNumber: t.page_number,
          issues: issues
        };
      })
    };
  } catch (error) {
    return { error: error.message };
  }
}

export async function getTaskBySequence(projectId, userId, sequence) {
  try {
    const { rows } = await sql`
      WITH numbered_tasks AS (
        SELECT
          sd.*,
          a.esg_type,
          a.promise_status,
          a.promise_string,
          a.verification_timeline,
          a.evidence_status,
          a.evidence_string,
          a.evidence_quality,
          a.skipped,
          a.is_marked,
          ROW_NUMBER() OVER (ORDER BY sd.page_number ASC, sd.id ASC) as sequence
        FROM source_data sd
        LEFT JOIN LATERAL (
          SELECT * FROM annotations
          WHERE source_data_id = sd.id AND user_id = ${userId}
          ORDER BY reannotation_round DESC
          LIMIT 1
        ) a ON true
        WHERE sd.project_id = ${projectId}
      )
      SELECT * FROM numbered_tasks
      WHERE sequence = ${sequence};
    `;

    if (rows.length > 0) {
        return { task: rows[0] };
    }

    return { task: null };
  } catch (error) {
    return { error: error.message };
  }
}

export async function resetProjectAnnotations(projectId, userId) {
  try {
    await sql`
      DELETE FROM annotations
      WHERE user_id = ${userId}
      AND source_data_id IN (
        SELECT id FROM source_data WHERE project_id = ${projectId}
      );
    `;
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function saveAnnotation(data) {
  const {
    source_data_id, user_id, esg_type, promise_status,
    promise_string, verification_timeline, evidence_status,
    evidence_string, evidence_quality, skipped,
    isReannotationMode = false  // 新增：由前端傳入是否為重標模式
  } = data;
  try {
    // 將字串轉換為陣列（如果是逗號分隔的字串）
    const esgTypeArray = typeof esg_type === 'string' ? esg_type.split(',').filter(Boolean) : esg_type;
    const isSkipped = skipped === true;

    // 1. 先撈取舊資料 (以比對差異)
    // 優先取 reannotation_round=1（重標），沒有則取 round=0（初標）
    const { rows: oldRows } = await sql`
      SELECT * FROM annotations
      WHERE source_data_id = ${source_data_id}
      AND user_id = ${user_id}
      ORDER BY reannotation_round DESC
      LIMIT 1;
    `;

    // 判斷目標 round：
    // - 如果前端指定是重標模式 → round=1
    // - 如果沒有舊資料 → round=0（初標）
    // - 如果有舊資料但不是重標模式 → 維持原本的 round（覆蓋）
    let targetRound = 0;
    if (isReannotationMode) {
      targetRound = 1;  // 重標模式一律存到 round=1
    } else if (oldRows.length > 0) {
      targetRound = oldRows[0].reannotation_round || 0;  // 覆蓋原本的 round
    }

    // 取得目標 round 的 save_count
    const { rows: targetRows } = await sql`
      SELECT save_count FROM annotations
      WHERE source_data_id = ${source_data_id}
      AND user_id = ${user_id}
      AND reannotation_round = ${targetRound}
      LIMIT 1;
    `;
    const currentSaveCount = targetRows.length > 0 ? (targetRows[0].save_count || 0) : 0;

    // 如果是重標模式，記錄變更到 Audit Log
    if (isReannotationMode && oldRows.length > 0) {
      const oldData = oldRows[0];
      const changes = [];

      // 定義要監控的欄位
      const fieldsToCheck = [
        { key: 'promise_status', label: '承諾狀態' },
        { key: 'verification_timeline', label: '驗證時間軸' },
        { key: 'evidence_status', label: '證據狀態' },
        { key: 'evidence_quality', label: '證據品質' },
        { key: 'promise_string', label: '承諾標記' },
        { key: 'evidence_string', label: '證據標記' },
        { key: 'esg_type', label: 'ESG 類型' }
      ];

      fieldsToCheck.forEach(field => {
        let oldVal = oldData[field.key] || '';
        let newVal = data[field.key] || '';

        // 簡單轉字串比對
        if (String(oldVal).trim() !== String(newVal).trim()) {
           changes.push({
             field: field.label,
             oldVal: String(oldVal).substring(0, 100),
             newVal: String(newVal).substring(0, 100)
           });
        }
      });

      // 寫入 Audit Log
      if (changes.length > 0) {
        for (const change of changes) {
            await sql`
                INSERT INTO reannotation_audit_log (
                source_data_id, user_id, task_name, old_value, new_value,
                round_number, changed_at, change_reason
                ) VALUES (
                ${source_data_id}, ${user_id}, ${change.field}, ${change.oldVal}, ${change.newVal},
                1, NOW(), '使用者重標註'
                );
            `;
        }
      }
    }

    // 2. 儲存/更新
    // 初標：reannotation_round=0
    // 重標：reannotation_round=1（覆蓋）
    await sql`
      INSERT INTO annotations (
        source_data_id, user_id, esg_type, promise_status, promise_string,
        verification_timeline, evidence_status, evidence_string, evidence_quality,
        status, skipped, version, reannotation_round, save_count, updated_at
      ) VALUES (
        ${source_data_id}, ${user_id}, ${esgTypeArray}, ${promise_status}, ${promise_string},
        ${verification_timeline}, ${evidence_status}, ${evidence_string}, ${evidence_quality},
        'completed', ${isSkipped}, 1, ${targetRound}, ${currentSaveCount + 1}, NOW()
      )
      ON CONFLICT (source_data_id, user_id, reannotation_round)
      DO UPDATE SET
        esg_type = EXCLUDED.esg_type,
        promise_status = EXCLUDED.promise_status,
        promise_string = EXCLUDED.promise_string,
        verification_timeline = EXCLUDED.verification_timeline,
        evidence_status = EXCLUDED.evidence_status,
        evidence_string = EXCLUDED.evidence_string,
        evidence_quality = EXCLUDED.evidence_quality,
        status = 'completed',
        skipped = EXCLUDED.skipped,
        save_count = annotations.save_count + 1,
        updated_at = NOW();
    `;
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// 讀取單筆資料的重標註歷史紀錄
export async function getReannotationHistory(sourceDataId, userId) {
  try {
    const { rows } = await sql`
      SELECT changed_at, task_name, old_value, new_value, round_number
      FROM reannotation_audit_log
      WHERE source_data_id = ${sourceDataId}
      AND user_id = ${userId}
      ORDER BY changed_at DESC;
    `;
    // 格式化時間
    const history = rows.map(row => ({
        ...row,
        changed_at: new Date(row.changed_at).toLocaleString('zh-TW')
    }));
    
    return { success: true, history };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function getAllUsersProgress() {
  try {
    // 只查詢有分配使用者權限的組別和專案
    const { rows } = await sql`
      SELECT
        u.id as user_id,
        u.username,
        u.role,
        p.id as project_id,
        p.name as project_name,
        p.group_id,
        pg.name as group_name,
        (SELECT COUNT(*) FROM source_data WHERE project_id = p.id) as total_tasks,
        (
          SELECT COUNT(*)
          FROM annotations a
          WHERE a.user_id = u.id
          AND a.source_data_id IN (SELECT id FROM source_data WHERE project_id = p.id)
          AND a.status = 'completed'
          AND (a.skipped IS NULL OR a.skipped = FALSE)
          AND a.reannotation_round = 0
        ) as completed_tasks
      FROM user_group_permissions ugp
      JOIN users u ON ugp.user_id = u.id
      JOIN projects p ON ugp.group_id = p.group_id
      JOIN project_groups pg ON p.group_id = pg.id
      WHERE p.group_id IS NOT NULL
      ORDER BY pg.name, p.name, u.username;
    `;
    return { success: true, data: rows };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function getAllReannotationProgress() {
  try {
    // 查詢所有重標註任務的進度（從 reannotation_tasks 表）
    const { rows } = await sql`
      SELECT
        u.id as user_id,
        u.username,
        u.role,
        p.id as project_id,
        p.name as project_name,
        p.group_id,
        pg.name as group_name,
        rr.round_number,
        rr.task_group,
        COUNT(DISTINCT rt.source_data_id) as total_tasks,
        COUNT(DISTINCT CASE
          WHEN rt.status IN ('submitted', 'skipped')
          THEN rt.source_data_id
        END) as completed_tasks
      FROM reannotation_tasks rt
      JOIN reannotation_rounds rr ON rt.round_id = rr.id
      JOIN projects p ON rr.project_id = p.id
      JOIN users u ON rt.user_id = u.id
      LEFT JOIN project_groups pg ON p.group_id = pg.id
      GROUP BY u.id, u.username, u.role, p.id, p.name, p.group_id,
               pg.name, rr.round_number, rr.task_group
      ORDER BY pg.name, p.name, rr.round_number, rr.task_group, u.username;
    `;
    return { success: true, data: rows };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// --- 更新資料的 PDF 頁碼（僅限 admin）---
export async function updateSourceDataPageNumber(sourceDataId, newPageNumber, userId) {
  try {
    // 驗證使用者是否為 admin
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return { success: false, error: '權限不足，僅管理員可調整頁碼' };
    }

    // 取得該資料所屬的專案，以獲取 pdf_urls
    const { rows: dataRows } = await sql`
      SELECT sd.project_id, p.pdf_urls
      FROM source_data sd
      JOIN projects p ON sd.project_id = p.id
      WHERE sd.id = ${sourceDataId};
    `;

    if (dataRows.length === 0) {
      return { success: false, error: '找不到該筆資料' };
    }

    const projectId = dataRows[0].project_id;
    const pdfUrls = dataRows[0].pdf_urls;

    // 從 pdf_urls 中找到對應的 URL
    const newPdfUrl = pdfUrls[newPageNumber] || null;

    if (!newPdfUrl) {
      return { success: false, error: `找不到第 ${newPageNumber} 頁的 PDF` };
    }

    // 更新資料的 page_number 和 source_url
    await sql`
      UPDATE source_data
      SET page_number = ${newPageNumber}, source_url = ${newPdfUrl}
      WHERE id = ${sourceDataId};
    `;

    revalidatePath('/');
    return { success: true, newPageNumber, newPdfUrl };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// --- 從本地資料夾讀取 Markdown 公告 ---
export async function getLocalAnnouncements() {
  try {
    const announcementsDir = path.join(process.cwd(), 'announcements');
    
    // 檢查資料夾是否存在
    try {
        await fs.access(announcementsDir);
    } catch {
        return { success: true, announcements: [] };
    }

    const files = await fs.readdir(announcementsDir);
    const announcements = [];

    for (const file of files) {
        if (!file.endsWith('.md')) continue;
        
        const filePath = path.join(announcementsDir, file);
        const fileContent = await fs.readFile(filePath, 'utf-8');
        
        // 簡單解析 Frontmatter (--- ... ---)
        const parts = fileContent.split('---');
        if (parts.length < 3) continue; // 格式不正確略過
        
        const metaLines = parts[1].trim().split('\n');
        const metadata = {};
        metaLines.forEach(line => {
            const [key, ...value] = line.split(':');
            if (key && value) {
                metadata[key.trim()] = value.join(':').trim();
            }
        });
        
        const content = parts.slice(2).join('---').trim();
        
        announcements.push({
            id: file,
            title: metadata.title || file.replace('.md', ''),
            date: metadata.date || '',
            type: metadata.type || 'info',
            content: content
        });
    }

    // 依照日期降序排列 (新的在上面)
    announcements.sort((a, b) => new Date(b.date) - new Date(a.date));

    return { success: true, announcements };
  } catch (error) {
    console.error("讀取公告失敗:", error);
    return { success: false, error: "無法載入公告" };
  }
}
