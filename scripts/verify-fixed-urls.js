// 驗證修復後的 URL
// 使用方式: node scripts/verify-fixed-urls.js

import dotenv from 'dotenv';
import { sql } from '@vercel/postgres';

dotenv.config({ path: '.env.local' });

async function verifyFixedUrls() {
  console.log('\n========================================');
  console.log('  驗證修復後的 URL');
  console.log('========================================\n');

  try {
    // 檢查之前修復的記錄（使用我們知道的 ID）
    const sampleIds = [8931, 8956, 12480, 12476, 12525, 10320, 5113, 6266];

    console.log(`檢查 ${sampleIds.length} 筆之前是 NULL 的記錄:\n`);
    console.log('='.repeat(100));

    for (const id of sampleIds) {
      const result = await sql`
        SELECT
          sd.id,
          p.name as project_name,
          sd.page_number,
          sd.source_url,
          sd.original_data
        FROM source_data sd
        JOIN projects p ON sd.project_id = p.id
        WHERE sd.id = ${id};
      `;

      if (result.rows.length > 0) {
        const record = result.rows[0];
        const urlStatus = record.source_url ? '✓' : '✗';

        console.log(`\nID ${record.id} ${urlStatus}`);
        console.log(`  專案: ${record.project_name}`);
        console.log(`  頁碼: ${record.page_number}`);
        console.log(`  URL: ${record.source_url || 'NULL'}`);
        console.log(`  資料: ${record.original_data.substring(0, 80)}...`);
      }
    }

    console.log('\n' + '='.repeat(100));

    // 統計檢查
    const stats = await sql`
      SELECT
        COUNT(*) as total,
        COUNT(CASE WHEN source_url IS NULL THEN 1 END) as null_count,
        COUNT(CASE WHEN source_url IS NOT NULL THEN 1 END) as valid_count
      FROM source_data;
    `;

    const { total, null_count, valid_count } = stats.rows[0];

    console.log('\n\n📊 整體統計:');
    console.log(`  - 總記錄數: ${parseInt(total).toLocaleString()}`);
    console.log(`  - NULL URLs: ${parseInt(null_count).toLocaleString()} (${(parseInt(null_count)/parseInt(total)*100).toFixed(2)}%)`);
    console.log(`  - 有效 URLs: ${parseInt(valid_count).toLocaleString()} (${(parseInt(valid_count)/parseInt(total)*100).toFixed(2)}%)`);

    if (parseInt(null_count) === 0) {
      console.log('\n✅ 完美！所有記錄都有 source_url！');
    } else {
      console.log(`\n⚠️  仍有 ${null_count} 筆記錄缺少 source_url`);
    }

    console.log('\n========================================\n');

  } catch (error) {
    console.error('錯誤:', error.message);
    throw error;
  }
}

verifyFixedUrls()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('執行失敗:', error);
    process.exit(1);
  });
