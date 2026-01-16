// 分析 NULL source_url 的原因
// 使用方式: node scripts/analyze-null-urls.js

import dotenv from 'dotenv';
import { sql } from '@vercel/postgres';

dotenv.config({ path: '.env.local' });

async function analyzeNullUrls() {
  console.log('\n========================================');
  console.log('  分析 NULL source_url 的原因');
  console.log('========================================\n');

  try {
    // 取得有 NULL URL 的記錄
    const nullRecords = await sql`
      SELECT
        sd.id,
        sd.project_id,
        p.name as project_name,
        sd.page_number,
        sd.original_data,
        p.page_offset,
        p.pdf_urls
      FROM source_data sd
      JOIN projects p ON sd.project_id = p.id
      WHERE sd.source_url IS NULL
      ORDER BY p.name, sd.page_number
      LIMIT 20;
    `;

    console.log(`找到 ${nullRecords.rows.length} 筆 NULL URL 記錄\n`);
    console.log('逐筆分析:\n');
    console.log('='.repeat(100));

    for (const record of nullRecords.rows) {
      const actualPdfPage = record.page_number + record.page_offset;
      const pdfUrls = record.pdf_urls || {};
      const availablePages = Object.keys(pdfUrls).map(p => parseInt(p)).sort((a, b) => a - b);
      const hasUrl = pdfUrls[actualPdfPage] !== undefined;

      console.log(`\n專案: ${record.project_name}`);
      console.log(`  - source_data.id: ${record.id}`);
      console.log(`  - page_number: ${record.page_number}`);
      console.log(`  - page_offset: ${record.page_offset}`);
      console.log(`  - 計算出的實際頁碼 (page_number + page_offset): ${actualPdfPage}`);
      console.log(`  - pdf_urls 中可用的頁碼: [${availablePages.join(', ')}]`);
      console.log(`  - pdf_urls[${actualPdfPage}] 是否存在: ${hasUrl ? '✓ 是' : '✗ 否'}`);

      if (hasUrl) {
        console.log(`  ⚠️  問題: pdf_urls 有對應頁碼，但 source_url 是 NULL！`);
        console.log(`     這可能是資料插入時的邏輯錯誤。`);
      } else {
        console.log(`  ⚠️  問題: pdf_urls 缺少頁碼 ${actualPdfPage}`);

        // 檢查是否頁碼超出範圍
        if (availablePages.length > 0) {
          const minPage = Math.min(...availablePages);
          const maxPage = Math.max(...availablePages);
          console.log(`     PDF 頁碼範圍: ${minPage} - ${maxPage}`);

          if (actualPdfPage < minPage) {
            console.log(`     原因: 實際頁碼 ${actualPdfPage} 小於最小可用頁碼 ${minPage}`);
          } else if (actualPdfPage > maxPage) {
            console.log(`     原因: 實際頁碼 ${actualPdfPage} 大於最大可用頁碼 ${maxPage}`);
          } else {
            console.log(`     原因: 實際頁碼 ${actualPdfPage} 在範圍內但缺失`);
          }
        }
      }

      console.log(`  - 資料內容: ${record.original_data.substring(0, 80)}...`);
      console.log('-'.repeat(100));
    }

    // 統計分析
    console.log('\n\n📊 統計分析:\n');

    // 按專案分組統計
    const projectStats = {};
    for (const record of nullRecords.rows) {
      const projectName = record.project_name;
      if (!projectStats[projectName]) {
        projectStats[projectName] = {
          total: 0,
          pageNumbers: [],
          pageOffset: record.page_offset,
          availablePages: Object.keys(record.pdf_urls || {}).map(p => parseInt(p)).sort((a, b) => a - b)
        };
      }
      projectStats[projectName].total++;
      projectStats[projectName].pageNumbers.push(record.page_number);
    }

    Object.entries(projectStats).forEach(([projectName, stats]) => {
      console.log(`\n${projectName}:`);
      console.log(`  - NULL 記錄數: ${stats.total}`);
      console.log(`  - page_offset: ${stats.pageOffset}`);
      console.log(`  - source_data 中的 page_number: [${stats.pageNumbers.slice(0, 10).join(', ')}${stats.pageNumbers.length > 10 ? '...' : ''}]`);

      const actualPages = stats.pageNumbers.map(p => p + stats.pageOffset);
      console.log(`  - 計算出的實際頁碼: [${actualPages.slice(0, 10).join(', ')}${actualPages.length > 10 ? '...' : ''}]`);

      if (stats.availablePages.length > 0) {
        const minAvail = Math.min(...stats.availablePages);
        const maxAvail = Math.max(...stats.availablePages);
        console.log(`  - pdf_urls 可用範圍: ${minAvail} - ${maxAvail} (共 ${stats.availablePages.length} 頁)`);

        const minActual = Math.min(...actualPages);
        const maxActual = Math.max(...actualPages);

        if (minActual < minAvail || maxActual > maxAvail) {
          console.log(`  ⚠️  實際頁碼範圍 ${minActual} - ${maxActual} 超出了可用範圍！`);
        }
      }
    });

    // 建議修復方案
    console.log('\n\n💡 建議修復方案:\n');
    console.log('1. 如果 pdf_urls 有對應頁碼但 source_url 是 NULL:');
    console.log('   → 執行更新腳本，從 pdf_urls 填充 source_url');
    console.log('');
    console.log('2. 如果 pdf_urls 缺少對應頁碼:');
    console.log('   → 檢查 page_offset 是否設定正確');
    console.log('   → 檢查 PDF 檔案是否完整上傳');
    console.log('   → 可能需要重新上傳缺失的 PDF 頁面');

    console.log('\n========================================');
    console.log('分析完成');
    console.log('========================================\n');

  } catch (error) {
    console.error('錯誤:', error.message);
    throw error;
  }
}

analyzeNullUrls()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('執行失敗:', error);
    process.exit(1);
  });
