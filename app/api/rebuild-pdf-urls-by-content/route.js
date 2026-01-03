// 檔案路徑: app/api/rebuild-pdf-urls-by-content/route.js
// 基於 PDF 內容匹配來重建 PDF URLs
import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { list } from '@vercel/blob';

// 計算文字相似度（使用 Levenshtein Distance）
function calculateSimilarity(str1, str2) {
  // 正規化文字：移除多餘空白、換行符號
  const normalize = (str) => str.replace(/\s+/g, ' ').trim().toLowerCase();

  const a = normalize(str1);
  const b = normalize(str2);

  // 如果其中一個為空，相似度為 0
  if (!a || !b) return 0;

  // 檢查包含關係（子字串匹配）
  if (a.includes(b) || b.includes(a)) {
    return 0.9; // 高相似度，表示部分匹配
  }

  // 使用 Levenshtein Distance 計算編輯距離
  const matrix = [];
  const n = a.length;
  const m = b.length;

  // 初始化矩陣
  for (let i = 0; i <= n; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= m; j++) {
    matrix[0][j] = j;
  }

  // 填充矩陣
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a.charAt(i - 1) === b.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // 替換
          matrix[i][j - 1] + 1,     // 插入
          matrix[i - 1][j] + 1      // 刪除
        );
      }
    }
  }

  const distance = matrix[n][m];
  const maxLength = Math.max(n, m);

  // 轉換為相似度分數 (0-1)
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
  const matchResults = [];
  const totalPdfs = pdfBlobs.length;

  console.log(`[Content Match] 開始搜尋匹配，目標文字長度: ${targetText.length} 字元`);
  console.log(`[Content Match] 搜尋範圍: ${totalPdfs} 個 PDF 檔案`);

  let processedCount = 0;
  for (const blob of pdfBlobs) {
    processedCount++;
    const percentage = ((processedCount / totalPdfs) * 100).toFixed(1);
    console.log(`[Content Match] 進度: ${processedCount}/${totalPdfs} (${percentage}%) - 正在處理: ${blob.pathname}`);

    const pdfText = await extractTextFromPDF(blob.url);

    if (!pdfText) {
      console.log(`[Content Match] ✗ PDF 提取失敗: ${blob.pathname}`);
      matchResults.push({
        pathname: blob.pathname,
        score: 0,
        reason: 'PDF 提取失敗'
      });
      continue;
    }

    const similarity = calculateSimilarity(targetText, pdfText);
    console.log(`[Content Match] 相似度: ${similarity.toFixed(4)} - ${blob.pathname}`);

    matchResults.push({
      pathname: blob.pathname,
      score: similarity,
      pdfTextLength: pdfText.length
    });

    if (similarity > bestScore) {
      bestScore = similarity;
      bestMatch = {
        blob,
        score: similarity,
        pdfText: pdfText.substring(0, 200) // 只保存前 200 字元用於調試
      };
      console.log(`[Content Match] 🎯 發現新的最佳匹配! 分數: ${bestScore.toFixed(4)}, 檔案: ${blob.pathname}`);
    }
  }

  // 排序結果（由高到低）
  matchResults.sort((a, b) => b.score - a.score);

  console.log(`[Content Match] 最佳匹配分數: ${bestScore.toFixed(4)}`);
  console.log(`[Content Match] 前 5 名結果:`, matchResults.slice(0, 5));

  // 只有相似度超過閾值才返回
  if (bestScore >= threshold) {
    return {
      match: bestMatch,
      allResults: matchResults
    };
  }

  return {
    match: null,
    allResults: matchResults,
    reason: `最佳分數 ${bestScore.toFixed(4)} 低於閾值 ${threshold}`
  };
}

export async function POST(request) {
  try {
    const { projectId, similarityThreshold = 0.7 } = await request.json();

    if (!projectId) {
      return NextResponse.json(
        { success: false, error: '請提供 projectId' },
        { status: 400 }
      );
    }

    // 取得專案資訊
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
    const projectName = project.name;
    const pageOffset = project.page_offset || 0;

    console.log(`[Rebuild by Content] 開始處理專案: ${projectName} (ID: ${projectId})`);
    console.log(`[Rebuild by Content] Page Offset: ${pageOffset}`);
    console.log(`[Rebuild by Content] 相似度閾值: ${similarityThreshold}`);

    // 從專案名稱提取關鍵字（例如 cathay_2882）
    const nameParts = projectName.split('_').filter(part => part.trim());
    const possibleKeys = [];

    // 生成可能的匹配關鍵字
    if (nameParts.length >= 2) {
      possibleKeys.push(nameParts.slice(-2).join('_')); // 最後兩部分
      possibleKeys.push(nameParts.slice(-1)[0]); // 最後一部分
      if (nameParts.length >= 3) {
        possibleKeys.push(nameParts.slice(-3).join('_')); // 最後三部分
      }
    } else {
      possibleKeys.push(projectName);
    }

    console.log(`[Rebuild by Content] 專案關鍵字: ${possibleKeys.join(', ')}`);

    // 列出所有 Blob 檔案
    let allBlobs = [];
    try {
      let cursor;
      let hasMore = true;
      let pageCount = 0;

      while (hasMore && pageCount < 10) {
        const listResult = cursor
          ? await list({ limit: 1000, cursor })
          : await list({ limit: 1000 });

        allBlobs = allBlobs.concat(listResult.blobs);
        cursor = listResult.cursor;
        hasMore = listResult.hasMore || false;
        pageCount++;
      }

      console.log(`[Rebuild by Content] Blob 總數: ${allBlobs.length}`);
    } catch (blobError) {
      console.error('[Rebuild by Content] 列出 Blob 失敗:', blobError);
      return NextResponse.json(
        { success: false, error: `無法存取 Vercel Blob: ${blobError.message}` },
        { status: 500 }
      );
    }

    // 找出屬於這個專案的 PDF 檔案
    let projectPdfs = [];

    for (const key of possibleKeys) {
      projectPdfs = allBlobs.filter(blob => {
        const pathname = blob.pathname;
        return pathname.includes(key) && pathname.endsWith('.pdf');
      });

      if (projectPdfs.length > 0) {
        console.log(`[Rebuild by Content] 使用關鍵字 "${key}" 找到 ${projectPdfs.length} 個 PDF`);
        break;
      }
    }

    if (projectPdfs.length === 0) {
      return NextResponse.json({
        success: false,
        error: `在 Vercel Blob 中找不到專案 "${projectName}" 的 PDF 檔案`,
        suggestion: '請確認專案名稱是否正確，或 PDF 檔案是否使用不同的命名規則'
      });
    }

    // 取得所有 source_data
    const { rows: sourceDataList } = await sql`
      SELECT id, original_data, page_number, bbox
      FROM source_data
      WHERE project_id = ${projectId}
      ORDER BY page_number;
    `;

    console.log(`[Rebuild by Content] Source Data 總數: ${sourceDataList.length}`);

    // 開始匹配每筆資料
    const pageUrlMap = {};
    const matchLog = [];
    let successCount = 0;
    let failCount = 0;
    const totalSourceData = sourceDataList.length;

    for (let i = 0; i < sourceDataList.length; i++) {
      const sourceData = sourceDataList[i];
      const targetText = sourceData.original_data;
      const jsonPageNumber = sourceData.page_number;
      const overallProgress = ((i + 1) / totalSourceData * 100).toFixed(1);

      console.log(`\n========================================`);
      console.log(`[Rebuild by Content] 📊 總體進度: ${i + 1}/${totalSourceData} (${overallProgress}%)`);
      console.log(`[Rebuild by Content] 🔍 處理 Source Data ID: ${sourceData.id}, Page: ${jsonPageNumber}`);
      console.log(`[Rebuild by Content] 目前成功: ${successCount} 筆, 失敗: ${failCount} 筆`);
      console.log(`========================================`);

      // 搜尋最佳匹配
      const { match, allResults, reason } = await findBestMatchingPage(
        targetText,
        projectPdfs,
        similarityThreshold
      );

      if (match) {
        // 從檔案名稱提取頁碼
        const pathname = match.blob.pathname;
        const pageMatch = pathname.match(/page[_-](\d+)\.pdf$/i) ||
                         pathname.match(/[_-]?p?(\d+)\.pdf$/i);

        if (pageMatch) {
          const pdfPageNumber = parseInt(pageMatch[1]);

          // 更新 pageUrlMap
          pageUrlMap[pdfPageNumber] = match.blob.url;

          // 更新 source_data 的 source_url
          await sql`
            UPDATE source_data
            SET source_url = ${match.blob.url}
            WHERE id = ${sourceData.id};
          `;

          matchLog.push({
            sourceDataId: sourceData.id,
            jsonPageNumber,
            matchedPdfPage: pdfPageNumber,
            matchedFile: pathname,
            similarity: match.score,
            status: 'success'
          });

          successCount++;
          console.log(`[Rebuild by Content] ✓ 匹配成功: PDF Page ${pdfPageNumber}, 相似度 ${match.score.toFixed(4)}`);
        } else {
          // 找到內容但無法提取頁碼
          matchLog.push({
            sourceDataId: sourceData.id,
            jsonPageNumber,
            matchedFile: pathname,
            similarity: match.score,
            status: 'no_page_number',
            error: '無法從檔案名稱提取頁碼'
          });

          failCount++;
          console.log(`[Rebuild by Content] ✗ 無法提取頁碼: ${pathname}`);
        }
      } else {
        // 找不到匹配
        await sql`
          UPDATE source_data
          SET source_url = NULL
          WHERE id = ${sourceData.id};
        `;

        matchLog.push({
          sourceDataId: sourceData.id,
          jsonPageNumber,
          status: 'no_match',
          reason: reason || '找不到匹配的內容',
          topResults: allResults.slice(0, 3)
        });

        failCount++;
        console.log(`[Rebuild by Content] ✗ 找不到匹配: ${reason || '未知原因'}`);
      }
    }

    // 更新 projects 的 pdf_urls
    await sql`
      UPDATE projects
      SET pdf_urls = ${JSON.stringify(pageUrlMap)}
      WHERE id = ${projectId};
    `;

    const matchRate = ((successCount / sourceDataList.length) * 100).toFixed(2);
    console.log(`\n========================================`);
    console.log(`[Rebuild by Content] ✅ 處理完成！`);
    console.log(`[Rebuild by Content] 📊 總體統計:`);
    console.log(`[Rebuild by Content]    - 總筆數: ${sourceDataList.length}`);
    console.log(`[Rebuild by Content]    - 成功: ${successCount} 筆`);
    console.log(`[Rebuild by Content]    - 失敗: ${failCount} 筆`);
    console.log(`[Rebuild by Content]    - 成功率: ${matchRate}%`);
    console.log(`[Rebuild by Content]    - 匹配到的 PDF 頁數: ${Object.keys(pageUrlMap).length}`);
    console.log(`========================================\n`);

    return NextResponse.json({
      success: true,
      projectName,
      summary: {
        totalSourceData: sourceDataList.length,
        successCount,
        failCount,
        matchRate: ((successCount / sourceDataList.length) * 100).toFixed(2) + '%'
      },
      pageUrlMap,
      pageCount: Object.keys(pageUrlMap).length,
      matchLog,
      message: `成功匹配 ${successCount} 筆資料，失敗 ${failCount} 筆`
    });

  } catch (error) {
    console.error('[Rebuild by Content] 發生錯誤:', error);
    return NextResponse.json(
      { success: false, error: error.message, stack: error.stack },
      { status: 500 }
    );
  }
}
