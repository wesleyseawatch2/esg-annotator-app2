// 檔案路徑: app/api/batch-auto-align/route.js
import { sql } from '@vercel/postgres';
import { NextResponse } from 'next/server';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

// 設定 PDF.js worker - 在 Node.js 環境中使用 canvas
if (typeof window === 'undefined') {
  // 在伺服器端，我們需要設定 workerSrc 到實際的 worker 檔案
  // 或者使用 disableWorker 選項來避免使用 worker
  pdfjsLib.GlobalWorkerOptions.workerSrc = null;
}

export async function POST(request) {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const sendProgress = (data) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const { projectId, userId } = await request.json();

        // 驗證使用者是否為 admin
        const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
        if (userRows.length === 0 || userRows[0].role !== 'admin') {
          sendProgress({ type: 'error', message: '權限不足，僅管理員可執行批次對齊' });
          controller.close();
          return;
        }

        // 取得專案資訊
        const { rows: projectRows } = await sql`
          SELECT id, name, pdf_urls FROM projects WHERE id = ${projectId};
        `;

        if (projectRows.length === 0) {
          sendProgress({ type: 'error', message: '找不到該專案' });
          controller.close();
          return;
        }

        const project = projectRows[0];
        const pdfUrls = project.pdf_urls;

        if (!pdfUrls || Object.keys(pdfUrls).length === 0) {
          sendProgress({ type: 'error', message: '專案沒有 PDF 檔案' });
          controller.close();
          return;
        }

        // 取得所有資料
        const { rows: dataRows } = await sql`
          SELECT id, original_data, page_number, source_url
          FROM source_data
          WHERE project_id = ${projectId}
          ORDER BY page_number ASC, id ASC;
        `;

        if (dataRows.length === 0) {
          sendProgress({ type: 'error', message: '專案沒有資料' });
          controller.close();
          return;
        }

        sendProgress({
          type: 'start',
          totalItems: dataRows.length,
          message: `開始批次對齊 ${dataRows.length} 筆資料...`
        });

        let processedCount = 0;
        let alignedCount = 0;
        let skippedCount = 0;
        let errorCount = 0;
        const details = [];

        // 預先載入所有 PDF 文本（優化效能）
        sendProgress({ type: 'status', message: '預先載入 PDF 文本...' });
        const pdfTextCache = {};
        const totalPages = Object.keys(pdfUrls).length;

        for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
          const pdfUrl = pdfUrls[pageNum];
          if (!pdfUrl) continue;

          try {
            sendProgress({
              type: 'status',
              message: `正在載入第 ${pageNum}/${totalPages} 頁 PDF...`
            });

            // 先用 fetch 獲取 PDF 資料
            const pdfResponse = await fetch(pdfUrl);
            if (!pdfResponse.ok) {
              throw new Error(`HTTP error! status: ${pdfResponse.status}`);
            }
            const pdfArrayBuffer = await pdfResponse.arrayBuffer();

            // 使用 ArrayBuffer 載入 PDF（更適合 Node.js 環境）
            const loadingTask = pdfjsLib.getDocument({
              data: pdfArrayBuffer,
              useSystemFonts: true,
              disableFontFace: false,
              useWorkerFetch: false,
              isEvalSupported: false,
              // 禁用 worker 以避免 Node.js 環境問題
              disableWorker: true,
              verbosity: 0,
            });
            const pdf = await loadingTask.promise;
            const page = await pdf.getPage(1);
            const textContent = await page.getTextContent();

            const pageText = textContent.items
              .map(item => item.str)
              .join(' ')
              .replace(/\s+/g, ' ')
              .trim()
              .toLowerCase();

            pdfTextCache[pageNum] = pageText;

            // 發送調試訊息
            sendProgress({
              type: 'debug',
              message: `第 ${pageNum} 頁載入成功，文本長度: ${pageText.length}`,
              pageNum,
              textLength: pageText.length,
              textPreview: pageText.substring(0, 100)
            });
          } catch (err) {
            console.error(`載入第 ${pageNum} 頁時發生錯誤:`, err);
            sendProgress({
              type: 'pdf-load-error',
              pageNum,
              error: err.message,
              stack: err.stack
            });
            pdfTextCache[pageNum] = '';
          }
        }

        sendProgress({ type: 'status', message: '開始比對資料...' });

        // 處理每筆資料
        for (const dataItem of dataRows) {
          processedCount++;

          sendProgress({
            type: 'progress',
            current: processedCount,
            total: dataRows.length,
            message: `處理第 ${processedCount}/${dataRows.length} 筆 (ID: ${dataItem.id})...`
          });

          try {
            const targetText = dataItem.original_data.replace(/\s+/g, ' ').trim().toLowerCase();
            let bestMatch = { pageNumber: null, similarity: 0 };

            // 搜尋範圍：當前頁前後 20 頁
            const searchRange = 20;
            const currentPage = dataItem.page_number;
            const startPage = Math.max(1, currentPage - searchRange);
            const endPage = Math.min(totalPages, currentPage + searchRange);

            // 搜尋最佳匹配
            for (let pageNum = startPage; pageNum <= endPage; pageNum++) {
              const pageText = pdfTextCache[pageNum];
              if (!pageText) continue;

              let similarity = 0;

              // 重要：檢查「資料庫文本」是否在「PDF 文本」中
              // 如果 PDF 包含資料庫的文本 = 找到正確頁面
              if (pageText.includes(targetText)) {
                similarity = 100; // PDF 完全包含資料庫文本
              } else {
                // 計算相似度：看有多少資料庫文本的字符出現在 PDF 中
                const targetChars = new Set(targetText.split(''));
                const pageChars = new Set(pageText.split(''));
                const intersection = new Set([...targetChars].filter(x => pageChars.has(x)));
                similarity = (intersection.size / targetChars.size) * 100;
              }

              if (similarity > bestMatch.similarity) {
                bestMatch = { pageNumber: pageNum, similarity };
              }

              // 如果找到完全匹配（100%），提前結束
              if (similarity === 100) break;
            }

            // 調試訊息：顯示最佳匹配結果（包含文本長度）
            sendProgress({
              type: 'debug',
              id: dataItem.id,
              currentPage: dataItem.page_number,
              bestMatchPage: bestMatch.pageNumber,
              similarity: bestMatch.similarity.toFixed(1),
              targetTextLength: targetText.length,
              targetTextPreview: targetText.substring(0, 100)
            });

            // 如果找到匹配且與當前頁碼不同，則更新（降低門檻到 50%）
            if (bestMatch.pageNumber && bestMatch.pageNumber !== dataItem.page_number && bestMatch.similarity >= 50) {
              const newPdfUrl = pdfUrls[bestMatch.pageNumber];

              await sql`
                UPDATE source_data
                SET page_number = ${bestMatch.pageNumber}, source_url = ${newPdfUrl}
                WHERE id = ${dataItem.id};
              `;

              alignedCount++;
              details.push({
                id: dataItem.id,
                oldPage: dataItem.page_number,
                newPage: bestMatch.pageNumber,
                similarity: bestMatch.similarity.toFixed(1)
              });

              sendProgress({
                type: 'aligned',
                id: dataItem.id,
                oldPage: dataItem.page_number,
                newPage: bestMatch.pageNumber,
                similarity: bestMatch.similarity.toFixed(1)
              });
            } else if (!bestMatch.pageNumber || bestMatch.similarity < 50) {
              skippedCount++;
              sendProgress({
                type: 'skipped',
                id: dataItem.id,
                reason: `找不到足夠相似的頁面 (最佳匹配: ${bestMatch.pageNumber || 'N/A'}, 相似度: ${bestMatch.similarity.toFixed(1)}%)`
              });
            } else {
              // 頁碼已經正確
              skippedCount++;
              sendProgress({
                type: 'skipped',
                id: dataItem.id,
                reason: '頁碼已正確'
              });
            }

          } catch (error) {
            errorCount++;
            sendProgress({
              type: 'item-error',
              id: dataItem.id,
              error: error.message
            });
          }
        }

        // 完成
        sendProgress({
          type: 'complete',
          totalItems: dataRows.length,
          alignedCount,
          skippedCount,
          errorCount,
          details
        });

        controller.close();

      } catch (error) {
        console.error('批次對齊錯誤:', error);
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
