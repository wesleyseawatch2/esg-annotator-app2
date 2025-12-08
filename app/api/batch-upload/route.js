// 檔案路徑: app/api/batch-upload/route.js
import { sql } from '@vercel/postgres';
import { put } from '@vercel/blob';
import { PDFDocument } from 'pdf-lib';
import { NextResponse } from 'next/server';

export async function POST(request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendProgress = (data) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const formData = await request.formData();
        const userId = formData.get('userId');
        const files = formData.getAll('files');

        // 驗證權限
        const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
        if (userRows.length === 0 || userRows[0].role !== 'admin') {
          sendProgress({ type: 'error', message: '權限不足' });
          controller.close();
          return;
        }

        if (files.length === 0) {
          sendProgress({ type: 'error', message: '未選擇任何檔案' });
          controller.close();
          return;
        }

        // 整理檔案結構
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

        // 計算總專案數
        let totalProjects = 0;
        for (const companies of Object.values(groupedData)) {
          totalProjects += Object.keys(companies).length;
        }

        sendProgress({
          type: 'start',
          totalProjects,
          message: `找到 ${totalProjects} 個專案，開始處理...`
        });

        let processedCount = 0;
        let successCount = 0;
        let failedCount = 0;
        const details = [];

        // 處理每個專案
        for (const [groupName, companies] of Object.entries(groupedData)) {
          for (const [companyName, { json, pdfs }] of Object.entries(companies)) {
            processedCount++;
            const projectName = `${groupName}_${companyName}`;

            sendProgress({
              type: 'progress',
              current: processedCount,
              total: totalProjects,
              projectName,
              message: `正在處理 ${projectName}...`
            });

            try {
              if (!json) {
                failedCount++;
                details.push({ projectName, success: false, error: '找不到 JSON 檔案' });
                sendProgress({
                  type: 'project-failed',
                  projectName,
                  error: '找不到 JSON 檔案'
                });
                continue;
              }

              if (pdfs.length === 0) {
                failedCount++;
                details.push({ projectName, success: false, error: '找不到 PDF 檔案' });
                sendProgress({
                  type: 'project-failed',
                  projectName,
                  error: '找不到 PDF 檔案'
                });
                continue;
              }

              // 讀取 JSON
              const jsonText = await json.text();
              let jsonData = JSON.parse(jsonText);
              jsonData = jsonData.sort((a, b) => {
                const pageA = parseInt(a.page_number) || 0;
                const pageB = parseInt(b.page_number) || 0;
                return pageA - pageB;
              });

              sendProgress({
                type: 'processing-pdf',
                projectName,
                message: `處理 ${pdfs.length} 個 PDF 檔案...`
              });

              // 處理 PDF
              const pageUrlMap = {};
              let totalPdfPages = 0;
              let uploadedPages = 0;
              const skippedPdfs = [];

              for (const pdfFile of pdfs) {
                try {
                  const pdfArrayBuffer = await pdfFile.arrayBuffer();
                  // 載入時保留所有資源，包括字體
                  const pdfDoc = await PDFDocument.load(pdfArrayBuffer, {
                    updateMetadata: false,
                    ignoreEncryption: true
                  });
                  const pdfPageCount = pdfDoc.getPageCount();
                  totalPdfPages += pdfPageCount;

                  for (let i = 0; i < pdfPageCount; i++) {
                    const newPdf = await PDFDocument.create();
                    const [copiedPage] = await newPdf.copyPages(pdfDoc, [i]);
                    newPdf.addPage(copiedPage);

                    // 保存時使用選項來保留字體和資源
                    const pdfBytes = await newPdf.save({
                      useObjectStreams: false,  // 避免對象流壓縮導致字體丟失
                      addDefaultPage: false,     // 不添加默認頁面
                      objectsPerTick: Infinity   // 一次性處理所有對象
                    });

                    const pageNumber = i + 1;
                    const blob = new Blob([pdfBytes], { type: 'application/pdf' });

                    // 使用公司名稱_page_X.pdf 格式（例如：yuanta_2885_page_1.pdf）
                    const fileName = `${companyName}_page_${pageNumber}.pdf`;
                    const { url } = await put(fileName, blob, { access: 'public' });

                    pageUrlMap[pageNumber] = url;
                    uploadedPages++;

                    sendProgress({
                      type: 'uploading-page',
                      projectName,
                      currentPage: uploadedPages,
                      totalPages: totalPdfPages,
                      message: `上傳頁面 ${uploadedPages}/${totalPdfPages}`
                    });
                  }
                } catch (pdfError) {
                  console.error(`處理 PDF ${pdfFile.name} 時發生錯誤:`, pdfError);
                  skippedPdfs.push(pdfFile.name);
                  sendProgress({
                    type: 'pdf-error',
                    projectName,
                    fileName: pdfFile.name,
                    error: pdfError.message
                  });
                  // 繼續處理其他 PDF
                }
              }

              sendProgress({
                type: 'saving-database',
                projectName,
                message: '儲存到資料庫...'
              });

              // 儲存到資料庫
              const pageOffset = 0;
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
                }
              }

              successCount++;
              let message = `匯入 ${insertedCount} 筆資料，${uploadedPages} 頁 PDF`;
              if (skippedPdfs.length > 0) {
                message += ` (跳過 ${skippedPdfs.length} 個無效 PDF)`;
              }
              details.push({ projectName, success: true, message });

              sendProgress({
                type: 'project-success',
                projectName,
                message
              });

            } catch (error) {
              failedCount++;
              details.push({ projectName, success: false, error: error.message });
              sendProgress({
                type: 'project-failed',
                projectName,
                error: error.message
              });
            }
          }
        }

        // 完成
        sendProgress({
          type: 'complete',
          totalProjects,
          successProjects: successCount,
          failedProjects: failedCount,
          details
        });

        controller.close();

      } catch (error) {
        sendProgress({ type: 'error', message: error.message });
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
