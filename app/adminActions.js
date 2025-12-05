// 檔案路徑: app/adminActions.js
'use server';
import { sql } from '@vercel/postgres';
import { revalidatePath } from 'next/cache';
import { del, put } from '@vercel/blob';
import { PDFDocument } from 'pdf-lib';

// --- 刪除專案（完全刪除）---
export async function deleteProject(userId, projectId) {
  try {
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return { success: false, error: '權限不足' };
    }

    // 1. 先取得專案的 pdf_urls，以便刪除 Blob 中的檔案
    const { rows: projectRows } = await sql`
      SELECT pdf_urls FROM projects WHERE id = ${projectId};
    `;

    let deletedBlobCount = 0;
    if (projectRows.length > 0 && projectRows[0].pdf_urls) {
      const pdfUrls = projectRows[0].pdf_urls;
      const urls = Object.values(pdfUrls);

      // 刪除 Vercel Blob 中的所有 PDF 檔案
      for (const url of urls) {
        try {
          await del(url);
          deletedBlobCount++;
        } catch (blobError) {
          console.error(`刪除 Blob 失敗 (${url}):`, blobError.message);
          // 繼續刪除其他檔案，不中斷流程
        }
      }
    }

    // 2. 刪除資料庫中的所有相關資料
    await sql`DELETE FROM annotations WHERE source_data_id IN (SELECT id FROM source_data WHERE project_id = ${projectId});`;
    await sql`DELETE FROM source_data WHERE project_id = ${projectId};`;
    await sql`DELETE FROM projects WHERE id = ${projectId};`;

    revalidatePath('/admin');
    return {
      success: true,
      message: `專案已完全刪除（包含 ${deletedBlobCount} 個 PDF 檔案）`
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// --- 刪除專案（僅刪除專案記錄，保留資料）---
export async function deleteProjectOnly(userId, projectId) {
  try {
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return { success: false, error: '權限不足' };
    }

    // 檢查專案是否存在
    const { rows: projectRows } = await sql`
      SELECT name FROM projects WHERE id = ${projectId};
    `;

    if (projectRows.length === 0) {
      return { success: false, error: '專案不存在' };
    }

    const projectName = projectRows[0].name;

    // 只刪除專案記錄，保留 source_data 和 annotations
    await sql`DELETE FROM projects WHERE id = ${projectId};`;

    revalidatePath('/admin');
    return {
      success: true,
      message: `專案「${projectName}」已刪除（PDF 和標註資料已保留）`
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function saveProjectData(userId, { projectName, jsonData, pageUrlMap, startPage = 1 }) {
  try {
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return { success: false, error: '權限不足' };
    }

    // startPage 是用戶指定的「JSON page_number:1 對應到哪個 PDF」
    // offset = startPage - 1
    const pageOffset = startPage - 1;

    let projectResult = await sql`SELECT id FROM projects WHERE name = ${projectName};`;
    let projectId;
    
    if (projectResult.rows.length === 0) {
      projectResult = await sql`
        INSERT INTO projects (name, page_offset, pdf_urls) 
        VALUES (${projectName}, ${pageOffset}, ${JSON.stringify(pageUrlMap)}) 
        RETURNING id;
      `;
      projectId = projectResult.rows[0].id;
    } else {
      projectId = projectResult.rows[0].id;
      await sql`
        UPDATE projects 
        SET page_offset = ${pageOffset}, pdf_urls = ${JSON.stringify(pageUrlMap)}
        WHERE id = ${projectId};
      `;
    }

    let insertedCount = 0;
    let matchedCount = 0;
    
    for (const item of jsonData) {
      const existingRows = await sql`
        SELECT 1 FROM source_data 
        WHERE project_id = ${projectId} AND original_data = ${item.data};
      `;
      
      if (existingRows.rows.length === 0) {
        const bbox = item.bbox || null;
        const pageNumber = item.page_number || 1;
        const actualPdfPage = pageNumber + pageOffset;
        const pdfUrl = pageUrlMap[actualPdfPage] || null;
        
        await sql`
          INSERT INTO source_data (project_id, original_data, source_url, page_number, bbox)
          VALUES (${projectId}, ${item.data}, ${pdfUrl}, ${pageNumber}, ${bbox});
        `;
        insertedCount++;
        if (pdfUrl) matchedCount++;
      }
    }

    revalidatePath('/');
    revalidatePath('/admin');
    
    return { 
      success: true, 
      message: `匯入 ${insertedCount} 筆，成功對應 ${matchedCount} 個 PDF (offset: ${pageOffset})` 
    };
    
  } catch (error) {
    console.error('儲存資料失敗:', error);
    return { success: false, error: error.message };
  }
}

// --- 更新專案名稱 ---
export async function updateProjectName(userId, projectId, newName) {
  try {
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return { success: false, error: '權限不足' };
    }

    if (!newName || !newName.trim()) {
      return { success: false, error: '專案名稱不能為空' };
    }

    // 檢查新名稱是否已存在
    const { rows: existingRows } = await sql`
      SELECT id FROM projects WHERE name = ${newName.trim()} AND id != ${projectId};
    `;

    if (existingRows.length > 0) {
      return { success: false, error: '此專案名稱已存在' };
    }

    // 更新專案名稱
    await sql`
      UPDATE projects
      SET name = ${newName.trim()}
      WHERE id = ${projectId};
    `;

    revalidatePath('/admin');
    return { success: true, message: '專案名稱已更新' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// --- 更新專案的 page_offset ---
export async function updateProjectOffset(userId, projectId, newOffset) {
  try {
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return { success: false, error: '權限不足' };
    }

    // 從 projects 表取得完整的 PDF URLs
    const { rows: projectRows } = await sql`
      SELECT pdf_urls FROM projects WHERE id = ${projectId};
    `;

    if (projectRows.length === 0) {
      return { success: false, error: '找不到專案' };
    }

    const pageUrlMap = projectRows[0].pdf_urls || {};
    
    if (Object.keys(pageUrlMap).length === 0) {
      return { success: false, error: '此專案沒有 PDF 資料，請重新上傳' };
    }

    // 取得所有 source_data
    const { rows: sourceData } = await sql`
      SELECT id, page_number
      FROM source_data 
      WHERE project_id = ${projectId}
      ORDER BY id;
    `;

    // 更新 offset
    await sql`UPDATE projects SET page_offset = ${newOffset} WHERE id = ${projectId};`;

    // 重新對應所有 PDF URLs
    let updatedCount = 0;
    for (const item of sourceData) {
      const actualPdfPage = item.page_number + newOffset;
      const newUrl = pageUrlMap[actualPdfPage] || null;
      
      await sql`
        UPDATE source_data 
        SET source_url = ${newUrl}
        WHERE id = ${item.id};
      `;
      
      if (newUrl) updatedCount++;
    }
    
    revalidatePath('/');
    revalidatePath('/admin');
    return { 
      success: true, 
      message: `已更新 ${updatedCount}/${sourceData.length} 筆資料的 PDF 對應` 
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// --- 修復專案的 PDF URLs ---
export async function repairProjectPdfs(userId, projectId) {
  try {
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return { success: false, error: '權限不足' };
    }

    // 收集所有現有的 PDF URLs
    const { rows: sourceData } = await sql`
      SELECT DISTINCT source_url 
      FROM source_data 
      WHERE project_id = ${projectId} AND source_url IS NOT NULL;
    `;

    const pageUrlMap = {};
    for (const item of sourceData) {
      // 改用更寬鬆的正則，匹配 _page_數字.pdf
      const match = item.source_url.match(/_page_(\d+)\.pdf$/i);
      if (match) {
        const pdfPageNum = parseInt(match[1], 10);
        pageUrlMap[pdfPageNum] = item.source_url;
      }
    }

    if (Object.keys(pageUrlMap).length === 0) {
      return { success: false, error: '找不到任何 PDF，請刪除專案重新上傳' };
    }

    // 儲存到 projects
    await sql`
      UPDATE projects 
      SET pdf_urls = ${JSON.stringify(pageUrlMap)}
      WHERE id = ${projectId};
    `;

    // 取得當前 offset 並重新對應
    const { rows: projectRows } = await sql`
      SELECT page_offset FROM projects WHERE id = ${projectId};
    `;
    const currentOffset = projectRows[0]?.page_offset || 0;

    const { rows: allSourceData } = await sql`
      SELECT id, page_number FROM source_data WHERE project_id = ${projectId};
    `;

    let updatedCount = 0;
    for (const item of allSourceData) {
      const actualPdfPage = item.page_number + currentOffset;
      const newUrl = pageUrlMap[actualPdfPage] || null;
      
      await sql`
        UPDATE source_data 
        SET source_url = ${newUrl}
        WHERE id = ${item.id};
      `;
      
      if (newUrl) updatedCount++;
    }

    revalidatePath('/');
    revalidatePath('/admin');
    return { 
      success: true, 
      message: `已修復並對應 ${updatedCount}/${allSourceData.length} 筆 PDF（收集到 ${Object.keys(pageUrlMap).length} 個 PDF）` 
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// --- 診斷專案 PDF 設定 ---
export async function diagnoseProject(userId, projectId) {
  try {
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return { success: false, error: '權限不足' };
    }

    const { rows: projectRows } = await sql`
      SELECT id, name, page_offset, pdf_urls FROM projects WHERE id = ${projectId};
    `;

    if (projectRows.length === 0) {
      return { success: false, error: '找不到專案' };
    }

    const project = projectRows[0];

    const { rows: sourceData } = await sql`
      SELECT id, page_number, source_url, original_data
      FROM source_data
      WHERE project_id = ${projectId}
      ORDER BY id
      LIMIT 5;
    `;

    const { rows: stats } = await sql`
      SELECT 
        COUNT(*) as total,
        COUNT(source_url) as has_url,
        COUNT(*) - COUNT(source_url) as no_url
      FROM source_data 
      WHERE project_id = ${projectId};
    `;

    return {
      success: true,
      data: {
        project: {
          id: project.id,
          name: project.name,
          page_offset: project.page_offset,
          pdf_urls_count: project.pdf_urls ? Object.keys(project.pdf_urls).length : 0,
          pdf_urls: project.pdf_urls
        },
        stats: stats[0],
        sample_data: sourceData
      }
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}
// --- 匯出專案的標註資料（包含使用者名稱）---
export async function exportProjectAnnotations(userId, projectId) {
  try {
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return { success: false, error: '權限不足' };
    }

    const { rows: annotations } = await sql`
      SELECT
        a.id,
        a.source_data_id,
        a.user_id,
        u.username,
        a.esg_type,
        a.promise_status,
        a.promise_string,
        a.verification_timeline,
        a.evidence_status,
        a.evidence_string,
        a.evidence_quality,
        a.status,
        a.created_at,
        a.updated_at,
        sd.original_data,
        sd.page_number
      FROM annotations a
      JOIN users u ON a.user_id = u.id
      JOIN source_data sd ON a.source_data_id = sd.id
      WHERE sd.project_id = ${projectId}
      ORDER BY a.created_at DESC;
    `;

    return { success: true, data: annotations };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============ 專案群組管理功能 ============

// --- 建立專案群組 ---
export async function createProjectGroup(userId, groupName, description = '') {
  try {
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return { success: false, error: '權限不足' };
    }

    const result = await sql`
      INSERT INTO project_groups (name, description)
      VALUES (${groupName}, ${description})
      RETURNING id, name, description;
    `;

    revalidatePath('/admin');
    return {
      success: true,
      message: `群組「${groupName}」建立成功`,
      group: result.rows[0]
    };
  } catch (error) {
    if (error.message.includes('unique')) {
      return { success: false, error: '群組名稱已存在' };
    }
    return { success: false, error: error.message };
  }
}

// --- 取得所有群組 ---
export async function getAllGroups(userId) {
  try {
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return { success: false, error: '權限不足' };
    }

    const { rows: groups } = await sql`
      SELECT
        pg.id,
        pg.name,
        pg.description,
        pg.created_at,
        COUNT(DISTINCT p.id) as project_count,
        COUNT(DISTINCT ugp.user_id) as user_count
      FROM project_groups pg
      LEFT JOIN projects p ON pg.id = p.group_id
      LEFT JOIN user_group_permissions ugp ON pg.id = ugp.group_id
      GROUP BY pg.id, pg.name, pg.description, pg.created_at
      ORDER BY pg.created_at DESC;
    `;

    return { success: true, groups };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// --- 分配使用者到群組 ---
export async function assignUserToGroup(adminUserId, userId, groupId) {
  try {
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${adminUserId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return { success: false, error: '權限不足' };
    }

    await sql`
      INSERT INTO user_group_permissions (user_id, group_id)
      VALUES (${userId}, ${groupId})
      ON CONFLICT (user_id, group_id) DO NOTHING;
    `;

    revalidatePath('/admin');
    return { success: true, message: '已成功分配使用者到群組' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// --- 從群組移除使用者 ---
export async function removeUserFromGroup(adminUserId, userId, groupId) {
  try {
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${adminUserId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return { success: false, error: '權限不足' };
    }

    await sql`
      DELETE FROM user_group_permissions
      WHERE user_id = ${userId} AND group_id = ${groupId};
    `;

    revalidatePath('/admin');
    return { success: true, message: '已從群組移除使用者' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// --- 分配專案到群組 ---
export async function assignProjectToGroup(userId, projectId, groupId) {
  try {
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return { success: false, error: '權限不足' };
    }

    // 如果 groupId 為 null，則表示移除群組設定
    if (groupId === null || groupId === '') {
      await sql`
        UPDATE projects
        SET group_id = NULL
        WHERE id = ${projectId};
      `;
      revalidatePath('/');
      revalidatePath('/admin');
      return { success: true, message: '已移除專案的群組設定' };
    }

    await sql`
      UPDATE projects
      SET group_id = ${groupId}
      WHERE id = ${projectId};
    `;

    revalidatePath('/');
    revalidatePath('/admin');
    return { success: true, message: '已成功分配專案到群組' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// --- 取得群組的使用者列表 ---
export async function getGroupUsers(userId, groupId) {
  try {
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return { success: false, error: '權限不足' };
    }

    const { rows: users } = await sql`
      SELECT u.id, u.username, u.role, ugp.created_at as assigned_at
      FROM users u
      JOIN user_group_permissions ugp ON u.id = ugp.user_id
      WHERE ugp.group_id = ${groupId}
      ORDER BY ugp.created_at DESC;
    `;

    return { success: true, users };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// --- 取得所有使用者（用於分配） ---
export async function getAllUsersForAssignment(userId) {
  try {
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return { success: false, error: '權限不足' };
    }

    const { rows: users } = await sql`
      SELECT id, username, role
      FROM users
      ORDER BY username;
    `;

    return { success: true, users };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// --- 刪除群組 ---
export async function deleteGroup(userId, groupId) {
  try {
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return { success: false, error: '權限不足' };
    }

    // 刪除群組會自動將關聯專案的 group_id 設為 NULL (ON DELETE SET NULL)
    // 並刪除所有相關的權限設定 (ON DELETE CASCADE)
    await sql`DELETE FROM project_groups WHERE id = ${groupId};`;

    revalidatePath('/');
    revalidatePath('/admin');
    return { success: true, message: '群組已刪除' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============ 公告管理功能 ============

// --- 建立公告 ---
export async function createAnnouncement(userId, { title, content, type = 'info', isActive = true }) {
  try {
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return { success: false, error: '權限不足' };
    }

    const result = await sql`
      INSERT INTO announcements (title, content, type, is_active, created_by)
      VALUES (${title}, ${content}, ${type}, ${isActive}, ${userId})
      RETURNING id, title, content, type, is_active, created_at;
    `;

    revalidatePath('/');
    revalidatePath('/admin');
    return {
      success: true,
      message: '公告建立成功',
      announcement: result.rows[0]
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// --- 取得所有公告（管理員用）---
export async function getAllAnnouncements(userId) {
  try {
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return { success: false, error: '權限不足' };
    }

    const { rows: announcements } = await sql`
      SELECT
        a.id,
        a.title,
        a.content,
        a.type,
        a.is_active,
        a.created_at,
        a.updated_at,
        u.username as created_by_username
      FROM announcements a
      LEFT JOIN users u ON a.created_by = u.id
      ORDER BY a.created_at DESC;
    `;

    return { success: true, announcements };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// --- 更新公告 ---
export async function updateAnnouncement(userId, announcementId, { title, content, type, isActive }) {
  try {
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return { success: false, error: '權限不足' };
    }

    await sql`
      UPDATE announcements
      SET
        title = ${title},
        content = ${content},
        type = ${type},
        is_active = ${isActive},
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ${announcementId};
    `;

    revalidatePath('/');
    revalidatePath('/admin');
    return { success: true, message: '公告已更新' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// --- 刪除公告 ---
export async function deleteAnnouncement(userId, announcementId) {
  try {
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return { success: false, error: '權限不足' };
    }

    await sql`DELETE FROM announcements WHERE id = ${announcementId};`;

    revalidatePath('/');
    revalidatePath('/admin');
    return { success: true, message: '公告已刪除' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// --- 切換公告啟用狀態 ---
export async function toggleAnnouncementStatus(userId, announcementId) {
  try {
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return { success: false, error: '權限不足' };
    }

    await sql`
      UPDATE announcements
      SET is_active = NOT is_active,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${announcementId};
    `;

    revalidatePath('/');
    revalidatePath('/admin');
    return { success: true, message: '公告狀態已更新' };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// ============ 原有功能 ============

// --- 批次上傳組別資料（包含 PDF 分頁處理）---
export async function batchUploadGroupData(userId, formData) {
  try {
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return { success: false, error: '權限不足' };
    }

    const results = {
      success: true,
      totalProjects: 0,
      successProjects: 0,
      failedProjects: 0,
      details: []
    };

    // 從 formData 取得所有檔案
    const files = formData.getAll('files');

    if (files.length === 0) {
      return { success: false, error: '未選擇任何檔案' };
    }

    // 整理檔案結構：按路徑分組成 { groupName: { companyName: { json, pdfs } } }
    const groupedData = {};

    for (const file of files) {
      const webkitPath = file.webkitRelativePath || file.name;
      const pathParts = webkitPath.split('/').filter(p => p);

      // 支援兩種結構：
      // 1. 根資料夾/組別/公司資料夾/檔案 (pathParts.length >= 4)
      // 2. 根資料夾/組別/檔案 (pathParts.length === 3)

      let groupName, companyName;

      if (pathParts.length >= 4) {
        // 結構：根/組別/公司/檔案
        groupName = pathParts[1];
        companyName = pathParts[2];
      } else if (pathParts.length === 3) {
        // 結構：根/組別/檔案 - 從檔名提取公司名稱
        groupName = pathParts[1];
        const fileName = pathParts[2];

        // 從檔名提取公司識別碼（例如：fubon_2881_esg_data.json -> fubon_2881）
        const match = fileName.match(/^([^_]+_\d+)/);
        if (match) {
          companyName = match[1];
        } else {
          // 如果無法匹配，使用檔名（去除副檔名）
          companyName = fileName.replace(/\.(json|pdf)$/, '');
        }
      } else {
        continue; // 跳過層級不足的檔案
      }

      if (!groupedData[groupName]) {
        groupedData[groupName] = {};
      }
      if (!groupedData[groupName][companyName]) {
        groupedData[groupName][companyName] = { json: null, pdfs: [] };
      }

      if (file.name.endsWith('.json')) {
        groupedData[groupName][companyName].json = file;
      } else if (file.name.endsWith('.pdf')) {
        groupedData[groupName][companyName].pdfs.push(file);
      }
    }

    // 處理每個組別的每家公司
    for (const [groupName, companies] of Object.entries(groupedData)) {
      for (const [companyName, { json, pdfs }] of Object.entries(companies)) {
        results.totalProjects++;
        const projectName = `${groupName}_${companyName}`;

        try {
          if (!json) {
            results.failedProjects++;
            results.details.push({
              projectName,
              success: false,
              error: '找不到 JSON 檔案'
            });
            continue;
          }

          if (pdfs.length === 0) {
            results.failedProjects++;
            results.details.push({
              projectName,
              success: false,
              error: '找不到 PDF 檔案'
            });
            continue;
          }

          // 讀取 JSON 資料
          const jsonText = await json.text();
          let jsonData = JSON.parse(jsonText);

          // 按照 page_number 排序
          jsonData = jsonData.sort((a, b) => {
            const pageA = parseInt(a.page_number) || 0;
            const pageB = parseInt(b.page_number) || 0;
            return pageA - pageB;
          });

          // 處理所有 PDF：分頁並上傳
          const pageUrlMap = {};

          for (const pdfFile of pdfs) {
            // 讀取 PDF
            const pdfArrayBuffer = await pdfFile.arrayBuffer();
            const pdfDoc = await PDFDocument.load(pdfArrayBuffer);
            const totalPages = pdfDoc.getPageCount();

            // 分割每一頁
            for (let i = 0; i < totalPages; i++) {
              const newPdf = await PDFDocument.create();
              const [copiedPage] = await newPdf.copyPages(pdfDoc, [i]);
              newPdf.addPage(copiedPage);

              const pdfBytes = await newPdf.save();
              const pageNumber = i + 1;
              const blob = new Blob([pdfBytes], { type: 'application/pdf' });

              // 上傳到 Vercel Blob（使用公司名稱_page_X.pdf 格式）
              const fileName = `${companyName}_page_${pageNumber}.pdf`;
              const { url } = await put(fileName, blob, {
                access: 'public',
              });

              pageUrlMap[pageNumber] = url;
            }
          }

          // 儲存到資料庫
          const saveResult = await saveProjectData(userId, {
            projectName,
            jsonData,
            pageUrlMap,
            startPage: 1
          });

          if (saveResult.success) {
            results.successProjects++;
            results.details.push({
              projectName,
              success: true,
              message: saveResult.message
            });
          } else {
            results.failedProjects++;
            results.details.push({
              projectName,
              success: false,
              error: saveResult.error
            });
          }

        } catch (error) {
          results.failedProjects++;
          results.details.push({
            projectName,
            success: false,
            error: error.message
          });
        }
      }
    }

    revalidatePath('/admin');
    return results;

  } catch (error) {
    console.error('批次上傳失敗:', error);
    return { success: false, error: error.message };
  }
}
