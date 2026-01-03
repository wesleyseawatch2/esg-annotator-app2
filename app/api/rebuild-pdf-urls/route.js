// 檔案路徑: app/api/rebuild-pdf-urls/route.js
import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { list } from '@vercel/blob';

// 計算文字相似度（使用 Levenshtein Distance）
function calculateSimilarity(str1, str2) {
  const normalize = (str) => str.replace(/\s+/g, ' ').trim().toLowerCase();
  const a = normalize(str1);
  const b = normalize(str2);

  if (!a || !b) return 0;
  if (a.includes(b) || b.includes(a)) return 0.9;

  const matrix = [];
  const n = a.length;
  const m = b.length;

  for (let i = 0; i <= n; i++) matrix[i] = [i];
  for (let j = 0; j <= m; j++) matrix[0][j] = j;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a.charAt(i - 1) === b.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  const distance = matrix[n][m];
  const maxLength = Math.max(n, m);
  return 1 - (distance / maxLength);
}

// 從 PDF 中提取文字
async function extractTextFromPDF(pdfUrl) {
  try {
    const response = await fetch(pdfUrl);
    const arrayBuffer = await response.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // 動態導入 pdfjs-dist
    const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');

    // 在 Node.js 環境中禁用 worker - 設定為一個虛擬路徑
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/build/pdf.worker.mjs';

    // 載入 PDF 文件
    const loadingTask = pdfjsLib.getDocument({
      data: uint8Array,
      useSystemFonts: true,
      isEvalSupported: false,
      verbosity: 0, // 禁用警告訊息
      standardFontDataUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.296/standard_fonts/',
      cMapUrl: 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.296/cmaps/',
      cMapPacked: true,
      stopAtErrors: false // 即使載入 CMap 失敗也繼續
    });

    const pdfDocument = await loadingTask.promise;
    const numPages = pdfDocument.numPages;

    // 提取所有頁面的文字
    let fullText = '';
    for (let pageNum = 1; pageNum <= numPages; pageNum++) {
      const page = await pdfDocument.getPage(pageNum);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');
      fullText += pageText + '\n';
    }

    return fullText;
  } catch (error) {
    console.error(`[PDF Extract] 提取失敗 ${pdfUrl}:`, error.message);
    return null;
  }
}

// 在 PDF 中搜尋最匹配的頁面
async function findBestMatchingPage(targetText, pdfBlobs, threshold = 0.7) {
  let bestMatch = null;
  let bestScore = 0;

  for (const blob of pdfBlobs) {
    const pdfText = await extractTextFromPDF(blob.url);
    if (!pdfText) continue;

    const similarity = calculateSimilarity(targetText, pdfText);
    if (similarity > bestScore) {
      bestScore = similarity;
      bestMatch = { blob, score: similarity };
    }
  }

  return bestScore >= threshold ? bestMatch : null;
}

export async function POST(request) {
  try {
    const { projectId, useContentMatching = false, similarityThreshold = 0.7 } = await request.json();

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: '請提供 projectId' },
        { status: 400 }
      );
    }

    // 取得專案資訊
    const { rows: projects } = await sql`
      SELECT id, name FROM projects WHERE id = ${projectId};
    `;

    if (projects.length === 0) {
      return NextResponse.json(
        { success: false, error: '找不到該專案' },
        { status: 404 }
      );
    }

    const project = projects[0];
    const projectName = project.name;

    console.log(`[Rebuild PDF URLs] 開始處理專案: ${projectName} (ID: ${projectId})`);

    // 列出所有 Blob 檔案（處理分頁）
    let blobs = [];
    try {
      let cursor;
      let hasMore = true;
      let pageCount = 0;

      // 處理分頁，確保取得所有檔案
      while (hasMore && pageCount < 10) { // 最多 10 頁，防止無限循環
        const listResult = cursor
          ? await list({ limit: 1000, cursor })
          : await list({ limit: 1000 });

        blobs = blobs.concat(listResult.blobs);
        cursor = listResult.cursor;
        hasMore = listResult.hasMore || false;
        pageCount++;

        console.log(`[Rebuild PDF URLs] 第 ${pageCount} 頁: 找到 ${listResult.blobs.length} 個檔案`);
      }

      console.log(`[Rebuild PDF URLs] 總共找到 ${blobs.length} 個 Blob 檔案`);
    } catch (blobError) {
      console.error('[Rebuild PDF URLs] 列出 Blob 失敗:', blobError);
      return NextResponse.json(
        { success: false, error: `無法存取 Vercel Blob: ${blobError.message}` },
        { status: 500 }
      );
    }

    // 找出屬於這個專案的 PDF 檔案
    // 檔案名稱格式通常是: {projectName}_page_{pageNumber}.pdf
    // 但可能專案名稱有前綴，所以我們需要智能匹配

    // 嘗試多種匹配策略
    let projectPdfs = [];

    // 策略 1: 完整專案名稱匹配
    projectPdfs = blobs.filter(blob => {
      const pathname = blob.pathname;
      return pathname.includes(projectName) && pathname.endsWith('.pdf');
    });

    // 策略 2: 如果找不到，嘗試用專案名稱的最後一部分（去掉前綴）
    if (projectPdfs.length === 0) {
      // 分割專案名稱，取最後的關鍵部分
      // 例如: "組2_非資訊相關學士生_半導體產業_rt_2379" -> ["rt", "2379"]
      const nameParts = projectName.split('_').filter(part => part.trim());
      const possibleKeys = [];

      // 生成可能的匹配關鍵字
      // 例如: "rt_2379", "2379", 最後2-3個部分組合
      if (nameParts.length >= 2) {
        possibleKeys.push(nameParts.slice(-2).join('_')); // 最後兩部分
        possibleKeys.push(nameParts.slice(-1)[0]); // 最後一部分
        if (nameParts.length >= 3) {
          possibleKeys.push(nameParts.slice(-3).join('_')); // 最後三部分
        }
      }

      console.log(`[Rebuild PDF URLs] 嘗試用關鍵字匹配: ${possibleKeys.join(', ')}`);

      // 用每個關鍵字嘗試匹配
      for (const key of possibleKeys) {
        projectPdfs = blobs.filter(blob => {
          const pathname = blob.pathname;
          return pathname.includes(key) && pathname.endsWith('.pdf');
        });

        if (projectPdfs.length > 0) {
          console.log(`[Rebuild PDF URLs] 使用關鍵字 "${key}" 找到 ${projectPdfs.length} 個檔案`);
          break;
        }
      }
    }

    console.log(`[Rebuild PDF URLs] 找到 ${projectPdfs.length} 個匹配的 PDF 檔案`);
    console.log(`[Rebuild PDF URLs] 使用內容匹配模式: ${useContentMatching ? '是' : '否'}`);

    if (projectPdfs.length === 0) {
      // 提供更多診斷資訊
      const allPdfFiles = blobs.filter(b => b.pathname.endsWith('.pdf')).map(b => b.pathname);
      console.log('[Rebuild PDF URLs] 所有 PDF 檔案:', allPdfFiles.slice(0, 10));

      return NextResponse.json({
        success: false,
        error: `在 Vercel Blob 中找不到專案 "${projectName}" 的 PDF 檔案`,
        suggestion: '請確認專案名稱是否正確，或 PDF 檔案是否使用不同的命名規則',
        debugInfo: {
          projectName,
          totalBlobCount: blobs.length,
          totalPdfCount: allPdfFiles.length,
          samplePdfNames: allPdfFiles.slice(0, 5)
        }
      });
    }

    // 取得 source_data 以便重建 source_url
    const { rows: sourceData } = await sql`
      SELECT id, page_number, original_data FROM source_data
      WHERE project_id = ${projectId}
      ORDER BY page_number;
    `;

    // 取得專案的 page_offset
    const { rows: projectData } = await sql`
      SELECT page_offset FROM projects WHERE id = ${projectId};
    `;
    const pageOffset = projectData[0]?.page_offset || 0;

    const pageUrlMap = {};
    let updatedCount = 0;
    let skippedCount = 0;
    const matchLog = [];

    if (useContentMatching) {
      // === 新邏輯：基於內容匹配 ===
      console.log(`[Rebuild PDF URLs] 開始內容匹配，共 ${sourceData.length} 筆資料`);

      for (const item of sourceData) {
        const targetText = item.original_data;

        // 搜尋最佳匹配
        const match = await findBestMatchingPage(targetText, projectPdfs, similarityThreshold);

        if (match) {
          // 從檔案名稱提取頁碼
          const pathname = match.blob.pathname;
          const pageMatch = pathname.match(/page[_-](\d+)\.pdf$/i) ||
                           pathname.match(/[_-]?p?(\d+)\.pdf$/i);

          if (pageMatch) {
            const pdfPageNumber = parseInt(pageMatch[1]);
            pageUrlMap[pdfPageNumber] = match.blob.url;

            // 更新 source_data
            await sql`
              UPDATE source_data
              SET source_url = ${match.blob.url}
              WHERE id = ${item.id};
            `;

            matchLog.push({
              sourceDataId: item.id,
              jsonPageNumber: item.page_number,
              matchedPdfPage: pdfPageNumber,
              similarity: match.score,
              status: 'success'
            });

            updatedCount++;
            console.log(`[Content Match] ✓ ID ${item.id}: Page ${pdfPageNumber}, 相似度 ${match.score.toFixed(4)}`);
          } else {
            matchLog.push({
              sourceDataId: item.id,
              jsonPageNumber: item.page_number,
              status: 'no_page_number',
              error: '無法從檔案名稱提取頁碼'
            });
            skippedCount++;
          }
        } else {
          // 找不到匹配
          await sql`
            UPDATE source_data
            SET source_url = NULL
            WHERE id = ${item.id};
          `;

          matchLog.push({
            sourceDataId: item.id,
            jsonPageNumber: item.page_number,
            status: 'no_match'
          });

          skippedCount++;
          console.log(`[Content Match] ✗ ID ${item.id}: 找不到匹配`);
        }
      }

      // 更新 projects 的 pdf_urls
      await sql`
        UPDATE projects
        SET pdf_urls = ${JSON.stringify(pageUrlMap)}
        WHERE id = ${projectId};
      `;

      return NextResponse.json({
        success: true,
        method: 'content_matching',
        projectName,
        summary: {
          totalSourceData: sourceData.length,
          successCount: updatedCount,
          failCount: skippedCount,
          matchRate: ((updatedCount / sourceData.length) * 100).toFixed(2) + '%'
        },
        pageUrlMap,
        pageCount: Object.keys(pageUrlMap).length,
        matchLog: matchLog.slice(0, 20), // 只返回前 20 筆詳細日誌
        message: `使用內容匹配成功處理 ${updatedCount} 筆資料，失敗 ${skippedCount} 筆`
      });

    } else {
      // === 原邏輯：基於檔案名稱匹配 ===
      const unrecognizedFiles = [];

      for (const blob of projectPdfs) {
        const pathname = blob.pathname;

        // 嘗試匹配 page_{number}.pdf 格式
        const pageMatch = pathname.match(/page[_-](\d+)\.pdf$/i);

        if (pageMatch) {
          const pageNumber = parseInt(pageMatch[1]);
          pageUrlMap[pageNumber] = blob.url;
        } else {
          // 嘗試其他可能的格式: p{number}.pdf, {number}.pdf
          const altMatch = pathname.match(/[_-]?p?(\d+)\.pdf$/i);
          if (altMatch) {
            const pageNumber = parseInt(altMatch[1]);
            pageUrlMap[pageNumber] = blob.url;
          } else {
            unrecognizedFiles.push(pathname);
          }
        }
      }

      const pageCount = Object.keys(pageUrlMap).length;

      console.log(`[Rebuild PDF URLs] 成功識別 ${pageCount} 個頁面`);
      if (unrecognizedFiles.length > 0) {
        console.log(`[Rebuild PDF URLs] 無法識別的檔案 (${unrecognizedFiles.length}):`, unrecognizedFiles.slice(0, 5));
      }

      if (pageCount === 0) {
        return NextResponse.json({
          success: false,
          error: '無法從檔案名稱中識別頁碼',
          foundFiles: projectPdfs.map(b => b.pathname).slice(0, 10),
          suggestion: '檔案名稱必須包含 page_1.pdf 或 p1.pdf 等格式'
        });
      }

      // 更新資料庫中的 pdf_urls
      await sql`
        UPDATE projects
        SET pdf_urls = ${JSON.stringify(pageUrlMap)}
        WHERE id = ${projectId};
      `;

      // 更新每筆 source_data 的 source_url
      for (const item of sourceData) {
        const actualPdfPage = item.page_number + pageOffset;
        const pdfUrl = pageUrlMap[actualPdfPage];

        if (pdfUrl) {
          await sql`
            UPDATE source_data
            SET source_url = ${pdfUrl}
            WHERE id = ${item.id};
          `;
          updatedCount++;
        } else {
          // 如果找不到對應的 PDF 頁面，設為 null
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
        method: 'filename_matching',
        projectName,
        pageCount,
        pageRange: `${Math.min(...Object.keys(pageUrlMap).map(Number))} - ${Math.max(...Object.keys(pageUrlMap).map(Number))}`,
        sourceDataUpdated: updatedCount,
        sourceDataSkipped: skippedCount,
        totalSourceData: sourceData.length,
        unrecognizedFiles: unrecognizedFiles.length > 0 ? unrecognizedFiles : undefined,
        message: `成功重建 ${pageCount} 個頁面的 PDF URLs，更新了 ${updatedCount} 筆資料`
      });
    }

  } catch (error) {
    console.error('重建 PDF URLs 時發生錯誤:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
