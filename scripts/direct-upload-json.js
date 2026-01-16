// 直接上傳 JSON 標註資料到資料庫的腳本
// 使用方式: node scripts/direct-upload-json.js

import dotenv from 'dotenv';
import { sql } from '@vercel/postgres';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 載入 .env.local 檔案
dotenv.config({ path: '.env.local' });

// 上傳配置
const uploads = [
  {
    jsonPath: 'C:\\Users\\wesley\\OneDrive\\桌面\\LAB\\ai_cup\\output\\llm_anotation\\data_annotation_result2\\kgi_2883_39samples.json',
    projectName: '組1_非資訊相關大學生_金融產業_第五周進度(kgi_2883, yuanta_2885)',
    companyCode: 'kgi_2883'
  },
  {
    jsonPath: 'C:\\Users\\wesley\\OneDrive\\桌面\\LAB\\ai_cup\\output\\llm_anotation\\data_annotation_result2\\taishin_2887_22samples.json',
    projectName: '組4_資訊相關碩士生_金融產業_第五周進度(taishin_2887)',
    companyCode: 'taishin_2887'
  }
];

async function uploadJsonData(jsonPath, projectName, companyCode) {
  console.log(`\n========================================`);
  console.log(`處理專案: ${projectName}`);
  console.log(`公司代碼: ${companyCode}`);
  console.log(`JSON 檔案: ${jsonPath}`);
  console.log(`========================================\n`);

  try {
    // 讀取 JSON 檔案
    if (!fs.existsSync(jsonPath)) {
      throw new Error(`找不到檔案: ${jsonPath}`);
    }

    const jsonContent = fs.readFileSync(jsonPath, 'utf-8');
    const jsonData = JSON.parse(jsonContent);

    console.log(`✓ 成功讀取 JSON 檔案，共 ${jsonData.length} 筆資料`);

    // 檢查專案是否存在
    const projectResult = await sql`
      SELECT id, pdf_urls, page_offset FROM projects WHERE name = ${projectName};
    `;

    if (projectResult.rows.length === 0) {
      throw new Error(`找不到專案: ${projectName}\n請先確認專案名稱是否正確`);
    }

    const project = projectResult.rows[0];
    const projectId = project.id;
    const pdfUrls = project.pdf_urls || {};
    const pageOffset = project.page_offset || 0;

    console.log(`✓ 找到專案 (ID: ${projectId})`);
    console.log(`  - PDF 頁數: ${Object.keys(pdfUrls).length}`);
    console.log(`  - 頁面偏移: ${pageOffset}`);

    // 插入資料
    let insertedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (let i = 0; i < jsonData.length; i++) {
      const item = jsonData[i];

      try {
        // 檢查是否已存在相同資料
        const existingRows = await sql`
          SELECT id FROM source_data
          WHERE project_id = ${projectId} AND original_data = ${item.data};
        `;

        if (existingRows.rows.length > 0) {
          skippedCount++;
          console.log(`  [${i + 1}/${jsonData.length}] 跳過重複資料`);
          continue;
        }

        // 準備資料
        const bbox = item.bbox || null;
        const pageNumber = item.page_number || 1;
        const actualPdfPage = pageNumber + pageOffset;
        const pdfUrl = pdfUrls[actualPdfPage] || null;

        // 插入資料
        await sql`
          INSERT INTO source_data (project_id, original_data, source_url, page_number, bbox)
          VALUES (${projectId}, ${item.data}, ${pdfUrl}, ${pageNumber}, ${bbox});
        `;

        insertedCount++;
        console.log(`  [${i + 1}/${jsonData.length}] ✓ 插入資料 (頁面: ${pageNumber})`);

      } catch (error) {
        errorCount++;
        console.error(`  [${i + 1}/${jsonData.length}] ✗ 錯誤: ${error.message}`);
      }
    }

    // 統計結果
    console.log(`\n----------------------------------------`);
    console.log(`上傳完成!`);
    console.log(`  - 總共: ${jsonData.length} 筆`);
    console.log(`  - 新增: ${insertedCount} 筆`);
    console.log(`  - 跳過: ${skippedCount} 筆 (已存在)`);
    console.log(`  - 錯誤: ${errorCount} 筆`);
    console.log(`----------------------------------------\n`);

    return {
      success: true,
      total: jsonData.length,
      inserted: insertedCount,
      skipped: skippedCount,
      errors: errorCount
    };

  } catch (error) {
    console.error(`\n✗ 處理失敗: ${error.message}\n`);
    return {
      success: false,
      error: error.message
    };
  }
}

async function main() {
  console.log('\n');
  console.log('========================================');
  console.log('  JSON 資料直接上傳工具');
  console.log('========================================');
  console.log(`開始時間: ${new Date().toLocaleString('zh-TW')}`);
  console.log(`處理 ${uploads.length} 個上傳任務\n`);

  const results = [];

  for (const upload of uploads) {
    const result = await uploadJsonData(
      upload.jsonPath,
      upload.projectName,
      upload.companyCode
    );
    results.push({ ...upload, ...result });
  }

  // 總結報告
  console.log('\n');
  console.log('========================================');
  console.log('  上傳總結報告');
  console.log('========================================');

  let totalInserted = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let successCount = 0;

  results.forEach((result, index) => {
    console.log(`\n${index + 1}. ${result.projectName}`);
    if (result.success) {
      console.log(`   ✓ 成功`);
      console.log(`   - 新增: ${result.inserted} 筆`);
      console.log(`   - 跳過: ${result.skipped} 筆`);
      console.log(`   - 錯誤: ${result.errors} 筆`);
      totalInserted += result.inserted;
      totalSkipped += result.skipped;
      totalErrors += result.errors;
      successCount++;
    } else {
      console.log(`   ✗ 失敗: ${result.error}`);
    }
  });

  console.log(`\n----------------------------------------`);
  console.log(`總計:`);
  console.log(`  - 成功任務: ${successCount}/${uploads.length}`);
  console.log(`  - 新增資料: ${totalInserted} 筆`);
  console.log(`  - 跳過資料: ${totalSkipped} 筆`);
  console.log(`  - 錯誤資料: ${totalErrors} 筆`);
  console.log(`----------------------------------------`);
  console.log(`結束時間: ${new Date().toLocaleString('zh-TW')}`);
  console.log('========================================\n');
}

// 執行主程式
main().catch(error => {
  console.error('執行錯誤:', error);
  process.exit(1);
});
