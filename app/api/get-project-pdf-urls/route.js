// 檔案路徑: app/api/get-project-pdf-urls/route.js
import { sql } from '@vercel/postgres';
import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const { projectId } = await request.json();

    if (!projectId) {
      return NextResponse.json({
        success: false,
        error: '缺少專案 ID'
      }, { status: 400 });
    }

    // 取得專案的 pdf_urls 和 page_offset
    const { rows } = await sql`
      SELECT pdf_urls, page_offset, name
      FROM projects
      WHERE id = ${projectId};
    `;

    if (rows.length === 0) {
      return NextResponse.json({
        success: false,
        error: '找不到該專案'
      }, { status: 404 });
    }

    const project = rows[0];

    return NextResponse.json({
      success: true,
      pdfUrls: project.pdf_urls || {},
      pageOffset: project.page_offset || 0,
      projectName: project.name
    });
  } catch (error) {
    console.error('取得 PDF URLs 錯誤:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
