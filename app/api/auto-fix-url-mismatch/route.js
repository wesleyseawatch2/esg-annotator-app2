// 檔案路徑: app/api/auto-fix-url-mismatch/route.js
import { sql } from '@vercel/postgres';
import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const { projectId, userId } = await request.json();

    if (!projectId) {
      return NextResponse.json({ error: '缺少專案 ID' }, { status: 400 });
    }

    // 驗證使用者是否為 admin
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return NextResponse.json({ error: '權限不足' }, { status: 403 });
    }

    // 取得專案資訊
    const { rows: projectRows } = await sql`
      SELECT id, name, pdf_urls FROM projects WHERE id = ${projectId};
    `;

    if (projectRows.length === 0) {
      return NextResponse.json({ error: '找不到該專案' }, { status: 404 });
    }

    const project = projectRows[0];
    const pdfUrls = project.pdf_urls;

    // 取得所有資料
    const { rows: dataRows } = await sql`
      SELECT id, original_data, page_number, source_url
      FROM source_data
      WHERE project_id = ${projectId}
      ORDER BY id ASC;
    `;

    // 找出並修復所有 URL 不匹配的資料
    const fixed = [];
    const errors = [];

    for (const dataItem of dataRows) {
      const expectedUrl = pdfUrls[dataItem.page_number];

      // 如果 URL 不匹配，自動修復
      if (dataItem.source_url !== expectedUrl) {
        try {
          if (!expectedUrl) {
            errors.push({
              id: dataItem.id,
              page_number: dataItem.page_number,
              error: `第 ${dataItem.page_number} 頁的 PDF URL 不存在`
            });
            continue;
          }

          // 更新 source_url
          await sql`
            UPDATE source_data
            SET source_url = ${expectedUrl}
            WHERE id = ${dataItem.id};
          `;

          fixed.push({
            id: dataItem.id,
            page_number: dataItem.page_number,
            old_url: dataItem.source_url,
            new_url: expectedUrl,
            data_preview: dataItem.original_data.substring(0, 50)
          });

        } catch (err) {
          errors.push({
            id: dataItem.id,
            page_number: dataItem.page_number,
            error: err.message
          });
        }
      }
    }

    return NextResponse.json({
      success: true,
      total: dataRows.length,
      fixed_count: fixed.length,
      error_count: errors.length,
      fixed: fixed,
      errors: errors
    });

  } catch (error) {
    console.error('自動修復錯誤:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
