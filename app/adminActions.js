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

// ==================== 公司資料管理功能 ====================

// --- 掃描現有專案並建立公司記錄 ---
export async function scanAndCreateCompanyRecords(userId) {
  try {
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return { success: false, error: '權限不足' };
    }

    // 掃描所有專案，提取公司資訊
    const { rows: projects } = await sql`SELECT id, name FROM projects ORDER BY name;`;

    let createdCount = 0;
    let updatedCount = 0;

    for (const project of projects) {
      // 解析專案名稱: GroupName_CompanyCode
      const parts = project.name.split('_');
      if (parts.length < 2) continue;

      const groupName = parts[0];
      const companyCode = parts.slice(1).join('_'); // 公司代碼可能包含底線

      // 計算該專案的資料總筆數
      const { rows: stats } = await sql`
        SELECT COUNT(*) as total FROM source_data WHERE project_id = ${project.id};
      `;
      const totalRecords = parseInt(stats[0]?.total || 0);

      // 檢查公司是否已存在
      const { rows: existing } = await sql`
        SELECT id, total_records FROM companies
        WHERE code = ${companyCode} AND group_name = ${groupName};
      `;

      if (existing.length === 0) {
        // 建立新公司記錄
        await sql`
          INSERT INTO companies (code, name, group_name, total_records)
          VALUES (${companyCode}, ${companyCode}, ${groupName}, ${totalRecords});
        `;
        createdCount++;
      } else {
        // 更新現有公司的資料筆數
        await sql`
          UPDATE companies
          SET total_records = ${totalRecords},
              updated_at = NOW()
          WHERE id = ${existing[0].id};
        `;
        updatedCount++;
      }
    }

    revalidatePath('/admin');
    return {
      success: true,
      message: `掃描完成！建立 ${createdCount} 筆新公司記錄，更新 ${updatedCount} 筆現有記錄。`
    };
  } catch (error) {
    console.error('掃描公司記錄失敗:', error);
    return { success: false, error: error.message };
  }
}

// --- 取得所有公司及其資料狀況 ---
export async function getAllCompanies(userId) {
  try {
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return { success: false, error: '權限不足' };
    }

    const { rows: companies } = await sql`
      SELECT
        c.id,
        c.code,
        c.name,
        c.group_name,
        c.total_records,
        c.assigned_records,
        c.created_at,
        c.updated_at,
        (SELECT COUNT(*) FROM company_data_assignments WHERE company_id = c.id) as assignment_count
      FROM companies c
      ORDER BY c.group_name, c.code;
    `;

    return { success: true, companies };
  } catch (error) {
    console.error('取得公司列表失敗:', error);
    return { success: false, error: error.message };
  }
}

// --- 檢查資料範圍是否已被分配 ---
async function checkRangeOverlap(companyId, startRecord, endRecord) {
  const { rows: overlaps } = await sql`
    SELECT
      cda.id,
      cda.start_record,
      cda.end_record,
      p.name as project_name
    FROM company_data_assignments cda
    JOIN projects p ON cda.project_id = p.id
    WHERE cda.company_id = ${companyId}
      AND NOT (cda.end_record < ${startRecord} OR cda.start_record > ${endRecord});
  `;

  return overlaps;
}

// --- 分配公司的特定資料範圍到新專案 ---
export async function assignCompanyDataToNewProject(
  userId,
  companyId,
  newProjectName,
  groupId,
  startRecord,
  endRecord
) {
  try {
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return { success: false, error: '權限不足' };
    }

    // 驗證輸入
    if (startRecord < 1 || endRecord < startRecord) {
      return { success: false, error: '無效的資料範圍' };
    }

    if (!newProjectName || newProjectName.trim() === '') {
      return { success: false, error: '請輸入新專案名稱' };
    }

    // 驗證公司存在
    const { rows: companyRows } = await sql`
      SELECT id, code, group_name, total_records FROM companies WHERE id = ${companyId};
    `;
    if (companyRows.length === 0) {
      return { success: false, error: '公司不存在' };
    }
    const company = companyRows[0];

    // 檢查範圍是否超出總記錄數
    if (endRecord > company.total_records) {
      return {
        success: false,
        error: `結束記錄 (${endRecord}) 超出公司總記錄數 (${company.total_records})`
      };
    }

    // 檢查專案名稱是否已存在
    const { rows: existingProject } = await sql`
      SELECT id FROM projects WHERE name = ${newProjectName.trim()};
    `;
    if (existingProject.length > 0) {
      return { success: false, error: '專案名稱已存在，請使用其他名稱' };
    }

    // 檢查範圍是否與現有分配重疊
    const overlaps = await checkRangeOverlap(companyId, startRecord, endRecord);
    if (overlaps.length > 0) {
      const overlapInfo = overlaps.map(o =>
        `${o.start_record}-${o.end_record} (${o.project_name})`
      ).join(', ');
      return {
        success: false,
        error: `資料範圍重疊！已分配的範圍：${overlapInfo}`
      };
    }

    // 查詢來源專案（用公司代碼和組別查找）
    const sourceProjectName = `${company.group_name}_${company.code}`;
    const { rows: sourceProjectRows } = await sql`
      SELECT id, pdf_urls, page_offset FROM projects WHERE name = ${sourceProjectName};
    `;

    if (sourceProjectRows.length === 0) {
      return { success: false, error: `找不到來源專案: ${sourceProjectName}` };
    }
    const sourceProject = sourceProjectRows[0];

    // 取得指定範圍的 source_data
    const recordCount = endRecord - startRecord + 1;
    const { rows: sourceDataRows } = await sql`
      SELECT * FROM source_data
      WHERE project_id = ${sourceProject.id}
      ORDER BY id
      LIMIT ${recordCount} OFFSET ${startRecord - 1};
    `;

    if (sourceDataRows.length === 0) {
      return { success: false, error: '找不到指定範圍的資料' };
    }

    // 建立新專案
    const { rows: newProjectRows } = await sql`
      INSERT INTO projects (name, page_offset, pdf_urls, group_id)
      VALUES (
        ${newProjectName.trim()},
        ${sourceProject.page_offset},
        ${sourceProject.pdf_urls},
        ${groupId || null}
      )
      RETURNING id;
    `;
    const newProjectId = newProjectRows[0].id;

    // 複製 source_data 到新專案
    for (const sourceData of sourceDataRows) {
      await sql`
        INSERT INTO source_data (project_id, original_data, source_url, page_number, bbox)
        VALUES (
          ${newProjectId},
          ${sourceData.original_data},
          ${sourceData.source_url},
          ${sourceData.page_number},
          ${sourceData.bbox}
        );
      `;
    }

    // 建立分配記錄
    await sql`
      INSERT INTO company_data_assignments
        (company_id, project_id, start_record, end_record, record_count)
      VALUES (${companyId}, ${newProjectId}, ${startRecord}, ${endRecord}, ${recordCount});
    `;

    // 更新公司已分配記錄數
    const { rows: totalAssigned } = await sql`
      SELECT SUM(record_count) as total
      FROM company_data_assignments
      WHERE company_id = ${companyId};
    `;

    await sql`
      UPDATE companies
      SET assigned_records = ${totalAssigned[0]?.total || 0},
          updated_at = NOW()
      WHERE id = ${companyId};
    `;

    revalidatePath('/admin');
    return {
      success: true,
      message: `成功建立新專案「${newProjectName}」並分配 ${recordCount} 筆資料 (${startRecord}-${endRecord})`,
      projectId: newProjectId
    };
  } catch (error) {
    console.error('分配資料到新專案失敗:', error);
    return { success: false, error: error.message };
  }
}

// --- 分配公司的特定資料範圍到現有專案（合併） ---
export async function assignCompanyDataToExistingProject(
  userId,
  companyId,
  existingProjectId,
  startRecord,
  endRecord
) {
  try {
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return { success: false, error: '權限不足' };
    }

    // 驗證輸入
    if (startRecord < 1 || endRecord < startRecord) {
      return { success: false, error: '無效的資料範圍' };
    }

    // 驗證公司存在
    const { rows: companyRows } = await sql`
      SELECT id, code, group_name, total_records FROM companies WHERE id = ${companyId};
    `;
    if (companyRows.length === 0) {
      return { success: false, error: '公司不存在' };
    }
    const company = companyRows[0];

    // 檢查範圍是否超出總記錄數
    if (endRecord > company.total_records) {
      return {
        success: false,
        error: `結束記錄 (${endRecord}) 超出公司總記錄數 (${company.total_records})`
      };
    }

    // 驗證目標專案存在
    const { rows: targetProjectRows } = await sql`
      SELECT id, name FROM projects WHERE id = ${existingProjectId};
    `;
    if (targetProjectRows.length === 0) {
      return { success: false, error: '目標專案不存在' };
    }
    const targetProject = targetProjectRows[0];

    // 檢查範圍是否與現有分配重疊
    const overlaps = await checkRangeOverlap(companyId, startRecord, endRecord);
    if (overlaps.length > 0) {
      const overlapInfo = overlaps.map(o =>
        `${o.start_record}-${o.end_record} (${o.project_name})`
      ).join(', ');
      return {
        success: false,
        error: `資料範圍重疊！已分配的範圍：${overlapInfo}`
      };
    }

    // 查詢來源專案
    const sourceProjectName = `${company.group_name}_${company.code}`;
    const { rows: sourceProjectRows } = await sql`
      SELECT id FROM projects WHERE name = ${sourceProjectName};
    `;

    if (sourceProjectRows.length === 0) {
      return { success: false, error: `找不到來源專案: ${sourceProjectName}` };
    }
    const sourceProject = sourceProjectRows[0];

    // 取得指定範圍的 source_data
    const recordCount = endRecord - startRecord + 1;
    const { rows: sourceDataRows } = await sql`
      SELECT * FROM source_data
      WHERE project_id = ${sourceProject.id}
      ORDER BY id
      LIMIT ${recordCount} OFFSET ${startRecord - 1};
    `;

    if (sourceDataRows.length === 0) {
      return { success: false, error: '找不到指定範圍的資料' };
    }

    // 複製 source_data 到目標專案
    for (const sourceData of sourceDataRows) {
      await sql`
        INSERT INTO source_data (project_id, original_data, source_url, page_number, bbox)
        VALUES (
          ${existingProjectId},
          ${sourceData.original_data},
          ${sourceData.source_url},
          ${sourceData.page_number},
          ${sourceData.bbox}
        );
      `;
    }

    // 建立分配記錄
    await sql`
      INSERT INTO company_data_assignments
        (company_id, project_id, start_record, end_record, record_count)
      VALUES (${companyId}, ${existingProjectId}, ${startRecord}, ${endRecord}, ${recordCount});
    `;

    // 更新公司已分配記錄數
    const { rows: totalAssigned } = await sql`
      SELECT SUM(record_count) as total
      FROM company_data_assignments
      WHERE company_id = ${companyId};
    `;

    await sql`
      UPDATE companies
      SET assigned_records = ${totalAssigned[0]?.total || 0},
          updated_at = NOW()
      WHERE id = ${companyId};
    `;

    revalidatePath('/admin');
    return {
      success: true,
      message: `成功將 ${recordCount} 筆資料 (${startRecord}-${endRecord}) 合併到專案「${targetProject.name}」`
    };
  } catch (error) {
    console.error('合併資料到現有專案失敗:', error);
    return { success: false, error: error.message };
  }
}

// --- 取得公司的分配詳情 ---
export async function getCompanyAssignmentDetails(userId, companyId) {
  try {
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return { success: false, error: '權限不足' };
    }

    const { rows: assignments } = await sql`
      SELECT
        cda.id,
        cda.start_record,
        cda.end_record,
        cda.record_count,
        p.id as project_id,
        p.name as project_name,
        cda.assigned_at
      FROM company_data_assignments cda
      JOIN projects p ON cda.project_id = p.id
      WHERE cda.company_id = ${companyId}
      ORDER BY cda.start_record;
    `;

    return { success: true, assignments };
  } catch (error) {
    console.error('取得分配詳情失敗:', error);
    return { success: false, error: error.message };
  }
}

// --- 移除分配 (撤銷) ---
export async function removeCompanyDataAssignment(userId, assignmentId) {
  try {
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return { success: false, error: '權限不足' };
    }

    // 取得分配資訊
    const { rows: assignment } = await sql`
      SELECT company_id, record_count, start_record, end_record
      FROM company_data_assignments
      WHERE id = ${assignmentId};
    `;

    if (assignment.length === 0) {
      return { success: false, error: '分配記錄不存在' };
    }

    const { company_id, record_count, start_record, end_record } = assignment[0];

    // 刪除分配記錄
    await sql`DELETE FROM company_data_assignments WHERE id = ${assignmentId};`;

    // 更新公司已分配記錄數
    const { rows: remainingCount } = await sql`
      SELECT SUM(record_count) as total
      FROM company_data_assignments
      WHERE company_id = ${company_id};
    `;

    await sql`
      UPDATE companies
      SET assigned_records = ${remainingCount[0]?.total || 0},
          updated_at = NOW()
      WHERE id = ${company_id};
    `;

    revalidatePath('/admin');
    return {
      success: true,
      message: `已撤銷分配，釋放 ${record_count} 筆資料 (${start_record}-${end_record})`
    };
  } catch (error) {
    console.error('移除分配失敗:', error);
    return { success: false, error: error.message };
  }
}

// --- 取得可用的資料範圍 (未被分配的範圍) ---
export async function getAvailableRanges(userId, companyId) {
  try {
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return { success: false, error: '權限不足' };
    }

    // 取得公司總記錄數
    const { rows: companyRows } = await sql`
      SELECT total_records FROM companies WHERE id = ${companyId};
    `;
    if (companyRows.length === 0) {
      return { success: false, error: '公司不存在' };
    }
    const totalRecords = companyRows[0].total_records;

    // 取得已分配的範圍
    const { rows: assignments } = await sql`
      SELECT start_record, end_record
      FROM company_data_assignments
      WHERE company_id = ${companyId}
      ORDER BY start_record;
    `;

    // 計算可用範圍
    const availableRanges = [];
    let currentStart = 1;

    for (const assignment of assignments) {
      if (currentStart < assignment.start_record) {
        availableRanges.push({
          start: currentStart,
          end: assignment.start_record - 1,
          count: assignment.start_record - currentStart
        });
      }
      currentStart = assignment.end_record + 1;
    }

    // 檢查最後一個範圍
    if (currentStart <= totalRecords) {
      availableRanges.push({
        start: currentStart,
        end: totalRecords,
        count: totalRecords - currentStart + 1
      });
    }

    return { success: true, availableRanges, totalRecords };
  } catch (error) {
    console.error('取得可用範圍失敗:', error);
    return { success: false, error: error.message };
  }
}

// ==================== 標註一致性分析功能 ====================

// --- 計算專案的標註一致性 ---
export async function calculateAnnotationAgreement(userId, projectId) {
  try {
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return { success: false, error: '權限不足' };
    }

    const response = await fetch('/api/calculate-agreement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, projectId })
    });

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('計算一致性失敗:', error);
    return { success: false, error: error.message };
  }
}

// --- 匯出一致性分析報告（CSV 格式）---
export async function exportAgreementReport(userId, projectId) {
  try {
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return { success: false, error: '權限不足' };
    }

    // 呼叫一致性計算 API
    const response = await fetch('/api/calculate-agreement', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, projectId })
    });

    const result = await response.json();
    if (!result.success) {
      return result;
    }

    const { data } = result;

    // 準備 Global Summary CSV
    const globalHeaders = ['Task', 'TaskName', 'Global_Alpha', 'Quality'];
    const globalRows = data.globalResults.map(r => [
      r.task,
      r.taskName,
      r.alpha.toFixed(4),
      r.quality
    ]);

    const globalCSV = [
      globalHeaders.join(','),
      ...globalRows.map(row => row.join(','))
    ].join('\n');

    // 準備 Detailed CSV
    const detailedHeaders = [
      'source_data_id',
      'original_data',
      'promise_status_score',
      'verification_timeline_score',
      'evidence_status_score',
      'evidence_quality_score',
      'has_inconsistency',
      ...data.annotators.flatMap(ann => [
        `promise_status_${ann}`,
        `verification_timeline_${ann}`,
        `evidence_status_${ann}`,
        `evidence_quality_${ann}`
      ])
    ];

    const detailedRows = data.detailedResults.map(item => {
      const row = [
        item.source_data_id,
        `"${(item.original_data || '').replace(/"/g, '""')}"`,
        item.promise_status_score.toFixed(3),
        item.verification_timeline_score.toFixed(3),
        item.evidence_status_score.toFixed(3),
        item.evidence_quality_score.toFixed(3),
        item.hasInconsistency ? '是' : '否'
      ];

      // 新增每位標註者的資料
      data.annotators.forEach(ann => {
        const annotatorData = item.annotators.find(a => a.name === ann);
        if (annotatorData) {
          row.push(
            `"${annotatorData.promise_status || ''}"`,
            `"${annotatorData.verification_timeline || ''}"`,
            `"${annotatorData.evidence_status || ''}"`,
            `"${annotatorData.evidence_quality || ''}"`
          );
        } else {
          row.push('', '', '', '');
        }
      });

      return row.join(',');
    });

    const detailedCSV = [
      detailedHeaders.join(','),
      ...detailedRows
    ].join('\n');

    return {
      success: true,
      globalCSV,
      detailedCSV,
      projectName: data.projectName
    };
  } catch (error) {
    console.error('匯出一致性報告失敗:', error);
    return { success: false, error: error.message };
  }
}
