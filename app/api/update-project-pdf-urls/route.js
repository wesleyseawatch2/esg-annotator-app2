// 檔案路徑: app/api/update-project-pdf-urls/route.js
import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export async function POST(request) {
  try {
    const { projectId, pdfUrls } = await request.json();

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: '請提供 projectId' },
        { status: 400 }
      );
    }

    if (!pdfUrls || typeof pdfUrls !== 'object') {
      return NextResponse.json(
        { success: false, error: 'pdfUrls 必須是一個物件' },
        { status: 400 }
      );
    }

    // 檢查專案是否存在
    const { rows: projects } = await sql`
      SELECT id, name, page_offset FROM projects WHERE id = ${projectId};
    `;

    if (projects.length === 0) {
      return NextResponse.json(
        { success: false, error: '找不到該專案' },
        { status: 404 }
      );
    }

    const project = projects[0];
    const pageOffset = project.page_offset || 0;

    // 更新 projects 表的 pdf_urls
    await sql`
      UPDATE projects
      SET pdf_urls = ${JSON.stringify(pdfUrls)}
      WHERE id = ${projectId};
    `;

    // 更新所有 source_data 的 source_url
    const { rows: sourceData } = await sql`
      SELECT id, page_number FROM source_data
      WHERE project_id = ${projectId};
    `;

    let updatedCount = 0;
    let skippedCount = 0;

    for (const item of sourceData) {
      const actualPdfPage = item.page_number + pageOffset;
      const pdfUrl = pdfUrls[actualPdfPage];

      if (pdfUrl) {
        await sql`
          UPDATE source_data
          SET source_url = ${pdfUrl}
          WHERE id = ${item.id};
        `;
        updatedCount++;
      } else {
        await sql`
          UPDATE source_data
          SET source_url = NULL
          WHERE id = ${item.id};
        `;
        skippedCount++;
      }
    }

    return NextResponse.json({
      success: true,
      message: `成功更新專案 "${project.name}"`,
      updatedCount,
      skippedCount,
      totalSourceData: sourceData.length,
      pageCount: Object.keys(pdfUrls).length
    });

  } catch (error) {
    console.error('更新 PDF URLs 時發生錯誤:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
