// 檔案路徑: app/adminActions.js
'use server';
import { sql } from '@vercel/postgres';
import { revalidatePath } from 'next/cache';

// --- 刪除專案 ---
export async function deleteProject(userId, projectId) {
  try {
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return { success: false, error: '權限不足' };
    }

    await sql`DELETE FROM annotations WHERE source_data_id IN (SELECT id FROM source_data WHERE project_id = ${projectId});`;
    await sql`DELETE FROM source_data WHERE project_id = ${projectId};`;
    await sql`DELETE FROM projects WHERE id = ${projectId};`;
    
    revalidatePath('/admin');
    return { success: true };
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
