// 檔案路徑: app/api/get-project-pdf-urls/route.js
import { sql } from '@vercel/postgres';
import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const { projectId } = await request.json();

    if (!projectId) {
      return NextResponse.json({ error: '缺少專案 ID' }, { status: 400 });
    }

    // 取得專案的 pdf_urls
    const { rows } = await sql`
      SELECT pdf_urls
      FROM projects
      WHERE id = ${projectId};
    `;

    if (rows.length === 0) {
      return NextResponse.json({ error: '找不到該專案' }, { status: 404 });
    }

    return NextResponse.json({ pdfUrls: rows[0].pdf_urls });
  } catch (error) {
    console.error('取得 PDF URLs 錯誤:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
