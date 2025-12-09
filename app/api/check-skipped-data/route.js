// 檔案路徑: app/api/check-skipped-data/route.js
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

    // 檢查每筆資料的 page_number 和 source_url 是否匹配
    const mismatches = [];

    for (const dataItem of dataRows) {
      const expectedUrl = pdfUrls[dataItem.page_number];

      if (dataItem.source_url !== expectedUrl) {
        mismatches.push({
          id: dataItem.id,
          page_number: dataItem.page_number,
          current_url: dataItem.source_url,
          expected_url: expectedUrl,
          data_preview: dataItem.original_data.substring(0, 100)
        });
      }
    }

    return NextResponse.json({
      total: dataRows.length,
      mismatches: mismatches,
      mismatch_count: mismatches.length
    });

  } catch (error) {
    console.error('檢查資料錯誤:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
