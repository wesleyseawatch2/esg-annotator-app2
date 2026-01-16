// 驗證上傳的資料
// 使用方式: node scripts/verify-uploaded-data.js

import dotenv from 'dotenv';
import { sql } from '@vercel/postgres';

// 載入 .env.local 檔案
dotenv.config({ path: '.env.local' });

const projectsToVerify = [
  {
    projectName: '組1_非資訊相關大學生_金融產業_第五周進度(kgi_2883, yuanta_2885)',
    expectedCount: 39,
    companyCode: 'kgi_2883'
  },
  {
    projectName: '組4_資訊相關碩士生_金融產業_第五周進度(taishin_2887)',
    expectedCount: 22,
    companyCode: 'taishin_2887'
  }
];

async function verifyProject(projectName, expectedCount, companyCode) {
  console.log(`\n========================================`);
  console.log(`驗證專案: ${projectName}`);
  console.log(`========================================\n`);

  try {
    // 1. 檢查專案是否存在
    const projectResult = await sql`
      SELECT id, name, page_offset, pdf_urls FROM projects WHERE name = ${projectName};
    `;

    if (projectResult.rows.length === 0) {
      console.log(`✗ 找不到專案: ${projectName}`);
      return { success: false, error: '專案不存在' };
    }

    const project = projectResult.rows[0];
    const projectId = project.id;
    const pdfUrls = project.pdf_urls || {};

    console.log(`✓ 專案存在 (ID: ${projectId})`);
    console.log(`  - 頁面偏移: ${project.page_offset}`);
    console.log(`  - PDF 頁數: ${Object.keys(pdfUrls).length}`);

    // 2. 檢查 source_data 數量
    const dataCountResult = await sql`
      SELECT COUNT(*) as count FROM source_data WHERE project_id = ${projectId};
    `;

    const actualCount = parseInt(dataCountResult.rows[0].count);
    console.log(`\n✓ Source Data 數量: ${actualCount} 筆`);

    if (actualCount < expectedCount) {
      console.log(`  ⚠ 警告: 預期 ${expectedCount} 筆，實際只有 ${actualCount} 筆`);
    } else if (actualCount === expectedCount) {
      console.log(`  ✓ 符合預期: ${expectedCount} 筆`);
    } else {
      console.log(`  ℹ 資訊: 預期 ${expectedCount} 筆，實際有 ${actualCount} 筆 (可能包含其他來源的資料)`);
    }

    // 3. 檢查標註進度
    const annotationResult = await sql`
      SELECT
        COUNT(DISTINCT a.source_data_id) as annotated_count,
        COUNT(DISTINCT sd.id) as total_count
      FROM source_data sd
      LEFT JOIN annotations a ON sd.id = a.source_data_id
      WHERE sd.project_id = ${projectId};
    `;

    const annotatedCount = parseInt(annotationResult.rows[0].annotated_count);
    const totalCount = parseInt(annotationResult.rows[0].total_count);
    const progress = totalCount > 0 ? ((annotatedCount / totalCount) * 100).toFixed(1) : 0;

    console.log(`\n標註進度:`);
    console.log(`  - 已標註: ${annotatedCount} / ${totalCount}`);
    console.log(`  - 進度: ${progress}%`);

    // 4. 檢查資料範例
    const sampleResult = await sql`
      SELECT
        sd.id,
        sd.page_number,
        sd.source_url,
        LEFT(sd.original_data, 100) as data_preview,
        CASE WHEN a.id IS NOT NULL THEN 'Yes' ELSE 'No' END as has_annotation
      FROM source_data sd
      LEFT JOIN annotations a ON sd.id = a.source_data_id
      WHERE sd.project_id = ${projectId}
      ORDER BY sd.page_number
      LIMIT 5;
    `;

    console.log(`\n資料範例 (前 5 筆):`);
    sampleResult.rows.forEach((row, index) => {
      console.log(`\n  ${index + 1}. ID: ${row.id}`);
      console.log(`     頁面: ${row.page_number}`);
      console.log(`     已標註: ${row.has_annotation}`);
      console.log(`     PDF URL: ${row.source_url ? '✓ 有' : '✗ 無'}`);
      console.log(`     內容預覽: ${row.data_preview}...`);
    });

    // 5. 檢查是否有缺少 PDF URL 的資料
    const missingPdfResult = await sql`
      SELECT COUNT(*) as count FROM source_data
      WHERE project_id = ${projectId} AND source_url IS NULL;
    `;

    const missingPdfCount = parseInt(missingPdfResult.rows[0].count);
    if (missingPdfCount > 0) {
      console.log(`\n⚠ 警告: 有 ${missingPdfCount} 筆資料缺少 PDF URL`);
    } else {
      console.log(`\n✓ 所有資料都有 PDF URL`);
    }

    // 6. 檢查頁面編號分布
    const pageDistResult = await sql`
      SELECT
        MIN(page_number) as min_page,
        MAX(page_number) as max_page,
        COUNT(DISTINCT page_number) as unique_pages
      FROM source_data
      WHERE project_id = ${projectId};
    `;

    const pageDist = pageDistResult.rows[0];
    console.log(`\n頁面分布:`);
    console.log(`  - 最小頁碼: ${pageDist.min_page}`);
    console.log(`  - 最大頁碼: ${pageDist.max_page}`);
    console.log(`  - 不同頁面數: ${pageDist.unique_pages}`);

    console.log(`\n========================================`);
    console.log(`驗證完成 ✓`);
    console.log(`========================================\n`);

    return {
      success: true,
      projectId,
      actualCount,
      expectedCount,
      annotatedCount,
      totalCount,
      progress,
      missingPdfCount
    };

  } catch (error) {
    console.error(`\n✗ 驗證失敗: ${error.message}\n`);
    return { success: false, error: error.message };
  }
}

async function main() {
  console.log('\n');
  console.log('========================================');
  console.log('  資料驗證工具');
  console.log('========================================');
  console.log(`開始時間: ${new Date().toLocaleString('zh-TW')}`);
  console.log(`驗證 ${projectsToVerify.length} 個專案\n`);

  const results = [];

  for (const project of projectsToVerify) {
    const result = await verifyProject(
      project.projectName,
      project.expectedCount,
      project.companyCode
    );
    results.push({ ...project, ...result });
  }

  // 總結報告
  console.log('\n');
  console.log('========================================');
  console.log('  驗證總結報告');
  console.log('========================================\n');

  let totalDataCount = 0;
  let totalAnnotatedCount = 0;
  let successCount = 0;

  results.forEach((result, index) => {
    console.log(`${index + 1}. ${result.projectName}`);
    if (result.success) {
      console.log(`   ✓ 驗證通過`);
      console.log(`   - 資料數量: ${result.actualCount} 筆 (預期: ${result.expectedCount})`);
      console.log(`   - 標註進度: ${result.annotatedCount}/${result.totalCount} (${result.progress}%)`);
      if (result.missingPdfCount > 0) {
        console.log(`   - ⚠ 缺少 PDF URL: ${result.missingPdfCount} 筆`);
      }
      totalDataCount += result.actualCount;
      totalAnnotatedCount += result.annotatedCount;
      successCount++;
    } else {
      console.log(`   ✗ 驗證失敗: ${result.error}`);
    }
    console.log('');
  });

  console.log('----------------------------------------');
  console.log(`驗證結果:`);
  console.log(`  - 成功專案: ${successCount}/${projectsToVerify.length}`);
  console.log(`  - 總資料數: ${totalDataCount} 筆`);
  console.log(`  - 已標註: ${totalAnnotatedCount} 筆`);
  console.log('----------------------------------------');
  console.log(`結束時間: ${new Date().toLocaleString('zh-TW')}`);
  console.log('========================================\n');
}

// 執行主程式
main().catch(error => {
  console.error('執行錯誤:', error);
  process.exit(1);
});
