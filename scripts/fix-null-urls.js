// 修復 NULL source_url - 補成 公司簡寫_股票代號_page_頁碼.pdf 格式
// 使用方式: node scripts/fix-null-urls.js

import dotenv from 'dotenv';
import { sql } from '@vercel/postgres';

dotenv.config({ path: '.env.local' });

// Vercel Blob Storage 基礎 URL
const BLOB_BASE_URL = 'https://hsxn1sjvkgtdpixe.public.blob.vercel-storage.com';

// 從專案名稱提取公司代碼
function extractCompanyCode(projectName) {
  // 專案名稱格式範例:
  // "組1_非資訊相關大學生_金融產業_ffhc_2892"
  // "組1_非資訊相關大學生_金融產業_第五周進度(kgi_2883, yuanta_2885)"

  // 嘗試匹配 公司_數字 格式
  const matches = projectName.match(/([a-z]+)_(\d+)/gi);

  if (matches && matches.length > 0) {
    // 如果有多個公司代碼（如合併專案），返回第一個
    return matches[0];
  }

  return null;
}

async function fixNullUrls(dryRun = true) {
  console.log('\n========================================');
  console.log('  修復 NULL source_url');
  console.log('========================================');
  console.log(`模式: ${dryRun ? '預覽模式 (不會實際更新)' : '執行模式 (會實際更新資料庫)'}\n`);

  try {
    // 取得所有 NULL source_url 的記錄
    const nullRecords = await sql`
      SELECT
        sd.id,
        sd.project_id,
        p.name as project_name,
        sd.page_number,
        sd.original_data,
        p.page_offset
      FROM source_data sd
      JOIN projects p ON sd.project_id = p.id
      WHERE sd.source_url IS NULL
      ORDER BY p.name, sd.page_number;
    `;

    console.log(`找到 ${nullRecords.rows.length} 筆 NULL source_url 記錄\n`);

    if (nullRecords.rows.length === 0) {
      console.log('✓ 沒有需要修復的記錄！');
      return;
    }

    let successCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    const failedRecords = [];

    // 按專案分組顯示
    const projectGroups = {};
    for (const record of nullRecords.rows) {
      if (!projectGroups[record.project_name]) {
        projectGroups[record.project_name] = [];
      }
      projectGroups[record.project_name].push(record);
    }

    console.log('處理進度:\n');
    console.log('='.repeat(100));

    for (const [projectName, records] of Object.entries(projectGroups)) {
      const companyCode = extractCompanyCode(projectName);

      console.log(`\n專案: ${projectName}`);
      console.log(`  提取的公司代碼: ${companyCode || '無法提取'}`);
      console.log(`  待處理記錄數: ${records.length}`);

      if (!companyCode) {
        console.log(`  ⚠️  無法從專案名稱提取公司代碼，跳過此專案`);
        skippedCount += records.length;
        failedRecords.push(...records.map(r => ({
          ...r,
          reason: '無法提取公司代碼'
        })));
        continue;
      }

      for (const record of records) {
        const actualPage = record.page_number + record.page_offset;
        const newUrl = `${BLOB_BASE_URL}/${companyCode}_page_${actualPage}.pdf`;

        if (dryRun) {
          console.log(`  [預覽] ID ${record.id}: page ${record.page_number} -> ${newUrl}`);
          successCount++;
        } else {
          try {
            await sql`
              UPDATE source_data
              SET source_url = ${newUrl}
              WHERE id = ${record.id};
            `;
            console.log(`  [更新] ID ${record.id}: page ${record.page_number} -> ${newUrl}`);
            successCount++;
          } catch (error) {
            console.error(`  [錯誤] ID ${record.id}: ${error.message}`);
            failedCount++;
            failedRecords.push({
              ...record,
              reason: error.message
            });
          }
        }
      }
    }

    // 結果統計
    console.log('\n' + '='.repeat(100));
    console.log('\n📊 處理結果統計:\n');
    console.log(`總記錄數: ${nullRecords.rows.length}`);
    console.log(`成功處理: ${successCount} 筆`);
    console.log(`失敗: ${failedCount} 筆`);
    console.log(`跳過: ${skippedCount} 筆`);

    if (failedRecords.length > 0) {
      console.log('\n\n⚠️  失敗/跳過的記錄:\n');
      failedRecords.slice(0, 20).forEach(record => {
        console.log(`  - ID ${record.id} (專案: ${record.project_name})`);
        console.log(`    原因: ${record.reason}`);
      });

      if (failedRecords.length > 20) {
        console.log(`  ... 還有 ${failedRecords.length - 20} 筆記錄未顯示`);
      }
    }

    if (dryRun) {
      console.log('\n\n💡 提示:');
      console.log('   這是預覽模式，沒有實際更新資料庫。');
      console.log('   如果確認無誤，請執行: node scripts/fix-null-urls.js --execute');
    } else {
      console.log('\n\n✅ 資料庫已更新完成！');
    }

    console.log('\n========================================\n');

  } catch (error) {
    console.error('錯誤:', error.message);
    throw error;
  }
}

// 檢查命令列參數
const args = process.argv.slice(2);
const executeMode = args.includes('--execute') || args.includes('-e');

fixNullUrls(!executeMode)
  .then(() => process.exit(0))
  .catch(error => {
    console.error('執行失敗:', error);
    process.exit(1);
  });
