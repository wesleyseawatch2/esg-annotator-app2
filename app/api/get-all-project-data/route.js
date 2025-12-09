// 檔案路徑: app/api/get-all-project-data/route.js
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
      return NextResponse.json({ error: '權限不足，僅管理員可執行此操作' }, { status: 403 });
    }

    // 取得所有資料
    const { rows } = await sql`
      SELECT id, original_data, page_number, source_url
      FROM source_data
      WHERE project_id = ${projectId}
      ORDER BY page_number ASC, id ASC;
    `;

    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error('取得專案資料錯誤:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
