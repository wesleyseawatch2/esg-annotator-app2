// 檔案路徑: app/api/check-pdf-issues/route.js
import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export async function POST(request) {
  try {
    // 取得所有專案
    const { rows: projects } = await sql`
      SELECT
        id,
        name,
        pdf_urls,
        page_offset,
        created_at
      FROM projects
      ORDER BY created_at DESC;
    `;

    const issues = [];

    for (const project of projects) {
      const projectIssues = {
        projectId: project.id,
        projectName: project.name,
        pageOffset: project.page_offset,
        problems: []
      };

      // 檢查 1: pdf_urls 是否存在
      if (!project.pdf_urls) {
        projectIssues.problems.push({
          type: 'MISSING_PDF_URLS',
          message: 'pdf_urls 欄位為空'
        });
      } else {
        // 檢查 2: pdf_urls 是否為有效的 JSON 物件
        let pdfUrlMap;
        try {
          pdfUrlMap = typeof project.pdf_urls === 'string'
            ? JSON.parse(project.pdf_urls)
            : project.pdf_urls;
        } catch (e) {
          projectIssues.problems.push({
            type: 'INVALID_PDF_URLS_JSON',
            message: 'pdf_urls 不是有效的 JSON 格式'
          });
        }

        if (pdfUrlMap) {
          // 檢查 3: pdf_urls 是否為空物件
          const urlCount = Object.keys(pdfUrlMap).length;
          if (urlCount === 0) {
            projectIssues.problems.push({
              type: 'EMPTY_PDF_URLS',
              message: 'pdf_urls 物件為空，沒有任何 PDF 頁面'
            });
          }

          // 檢查 4: URL 格式是否正確
          const invalidUrls = [];
          for (const [page, url] of Object.entries(pdfUrlMap)) {
            if (!url) {
              invalidUrls.push({ page, issue: 'URL 為 null 或空值' });
            } else if (!url.startsWith('http')) {
              invalidUrls.push({ page, issue: `無效的 URL 格式: ${url.substring(0, 50)}...` });
            }
          }

          if (invalidUrls.length > 0) {
            projectIssues.problems.push({
              type: 'INVALID_URLS',
              message: `有 ${invalidUrls.length} 個無效的 URL`,
              details: invalidUrls.slice(0, 5) // 只顯示前 5 個
            });
          }
        }
      }

      // 檢查 5: source_data 中的 source_url 問題
      const { rows: sourceData } = await sql`
        SELECT
          id,
          page_number,
          source_url
        FROM source_data
        WHERE project_id = ${project.id};
      `;

      const nullUrls = sourceData.filter(sd => !sd.source_url);
      if (nullUrls.length > 0) {
        projectIssues.problems.push({
          type: 'NULL_SOURCE_URLS',
          message: `有 ${nullUrls.length} 筆資料的 source_url 為空`,
          affectedCount: nullUrls.length,
          totalCount: sourceData.length,
          details: nullUrls.map(item => ({
            sourceDataId: item.id,
            pageNumber: item.page_number
          }))
        });
      }

      // 檢查 6: source_url 與 pdf_urls 不匹配
      if (project.pdf_urls && sourceData.length > 0) {
        let pdfUrlMap;
        try {
          pdfUrlMap = typeof project.pdf_urls === 'string'
            ? JSON.parse(project.pdf_urls)
            : project.pdf_urls;

          const pageOffset = project.page_offset || 0;
          const mismatches = [];

          for (const sd of sourceData) {
            const expectedPage = sd.page_number + pageOffset;
            const expectedUrl = pdfUrlMap[expectedPage];

            if (expectedUrl && sd.source_url !== expectedUrl) {
              mismatches.push({
                sourceDataId: sd.id,
                pageNumber: sd.page_number,
                expectedPage,
                currentUrl: sd.source_url ? sd.source_url.substring(0, 60) + '...' : 'null',
                expectedUrl: expectedUrl.substring(0, 60) + '...'
              });
            }
          }

          if (mismatches.length > 0) {
            projectIssues.problems.push({
              type: 'URL_MISMATCH',
              message: `有 ${mismatches.length} 筆資料的 URL 與預期不符`,
              affectedCount: mismatches.length,
              details: mismatches.slice(0, 3) // 只顯示前 3 個
            });
          }
        } catch (e) {
          // JSON 解析錯誤已經在前面檢查過了
        }
      }

      // 只記錄有問題的專案
      if (projectIssues.problems.length > 0) {
        issues.push(projectIssues);
      }
    }

    // 統計總覽
    const summary = {
      totalProjects: projects.length,
      projectsWithIssues: issues.length,
      projectsHealthy: projects.length - issues.length,
      issueTypes: {}
    };

    // 統計問題類型
    issues.forEach(project => {
      project.problems.forEach(problem => {
        summary.issueTypes[problem.type] = (summary.issueTypes[problem.type] || 0) + 1;
      });
    });

    return NextResponse.json({
      success: true,
      summary,
      issues
    });

  } catch (error) {
    console.error('檢查 PDF 問題時發生錯誤:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
