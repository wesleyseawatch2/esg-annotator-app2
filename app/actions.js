// 檔案路徑: app/actions.js
'use server';
import { sql } from '@vercel/postgres';
import { revalidatePath } from 'next/cache';

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
            a.evidence_quality
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
            a.evidence_quality
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
    // 獲取當前 ID 之後的下一筆資料（不管是否已標註）
    const { rows } = await sql`
      SELECT
        sd.*,
        a.esg_type,
        a.promise_status,
        a.promise_string,
        a.verification_timeline,
        a.evidence_status,
        a.evidence_string,
        a.evidence_quality
      FROM source_data sd
      LEFT JOIN annotations a ON sd.id = a.source_data_id AND a.user_id = ${userId}
      WHERE sd.project_id = ${projectId}
      AND sd.id > ${currentId}
      ORDER BY sd.page_number ASC, sd.id ASC
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
      LEFT JOIN annotations a ON sd.id = a.source_data_id AND a.user_id = ${userId}
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
        a.status,
        a.promise_status,
        a.promise_string,
        a.evidence_status,
        a.evidence_string,
        ROW_NUMBER() OVER (ORDER BY sd.page_number ASC, sd.id ASC) as sequence
      FROM source_data sd
      LEFT JOIN annotations a ON sd.id = a.source_data_id AND a.user_id = ${userId}
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
          ROW_NUMBER() OVER (ORDER BY sd.page_number ASC, sd.id ASC) as sequence
        FROM source_data sd
        LEFT JOIN annotations a ON sd.id = a.source_data_id AND a.user_id = ${userId}
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
    evidence_string, evidence_quality, skipped
  } = data;
  try {
    // 將字串轉換為陣列（如果是逗號分隔的字串）
    const esgTypeArray = typeof esg_type === 'string' ? esg_type.split(',').filter(Boolean) : esg_type;
    const isSkipped = skipped === true;

    await sql`
      INSERT INTO annotations (
        source_data_id, user_id, esg_type, promise_status, promise_string,
        verification_timeline, evidence_status, evidence_string, evidence_quality, status, skipped, updated_at
      ) VALUES (
        ${source_data_id}, ${user_id}, ${esgTypeArray}, ${promise_status}, ${promise_string},
        ${verification_timeline}, ${evidence_status}, ${evidence_string}, ${evidence_quality}, 'completed', ${isSkipped}, NOW()
      )
      ON CONFLICT (source_data_id, user_id)
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
        updated_at = NOW();
    `;
    revalidatePath('/');
    return { success: true };
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

// --- 取得啟用的公告（所有用戶可見）---
export async function getActiveAnnouncements() {
  try {
    const { rows: announcements } = await sql`
      SELECT
        id,
        title,
        content,
        type,
        created_at
      FROM announcements
      WHERE is_active = TRUE
      ORDER BY created_at DESC;
    `;

    return { success: true, announcements };
  } catch (error) {
    return { success: false, error: error.message };
  }
}