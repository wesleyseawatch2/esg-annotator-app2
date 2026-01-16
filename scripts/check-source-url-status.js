// 檢查 source_data 表的 source_url 狀況
// 使用方式: node scripts/check-source-url-status.js

import dotenv from 'dotenv';
import { sql } from '@vercel/postgres';

dotenv.config({ path: '.env.local' });

async function checkSourceUrlStatus() {
  console.log('\n========================================');
  console.log('  source_url 狀況檢查');
  console.log('========================================\n');

  try {
    // 1. 整體統計
    console.log('📊 整體統計:\n');

    const totalResult = await sql`SELECT COUNT(*) as count FROM source_data`;
    const total = parseInt(totalResult.rows[0].count);

    const nullResult = await sql`SELECT COUNT(*) as count FROM source_data WHERE source_url IS NULL`;
    const nullCount = parseInt(nullResult.rows[0].count);

    const emptyResult = await sql`SELECT COUNT(*) as count FROM source_data WHERE source_url = ''`;
    const emptyCount = parseInt(emptyResult.rows[0].count);

    const validResult = await sql`SELECT COUNT(*) as count FROM source_data WHERE source_url IS NOT NULL AND source_url != ''`;
    const validCount = parseInt(validResult.rows[0].count);

    console.log(`總記錄數: ${total.toLocaleString()}`);
    console.log(`NULL URLs: ${nullCount.toLocaleString()} (${(nullCount/total*100).toFixed(2)}%)`);
    console.log(`空字串 URLs: ${emptyCount.toLocaleString()} (${(emptyCount/total*100).toFixed(2)}%)`);
    console.log(`有效 URLs: ${validCount.toLocaleString()} (${(validCount/total*100).toFixed(2)}%)`);

    // 2. URL 格式統計
    console.log('\n\n🔗 URL 格式統計:\n');

    const urlPatternsResult = await sql`
      SELECT
        CASE
          WHEN source_url IS NULL THEN 'NULL'
          WHEN source_url = '' THEN 'Empty String'
          WHEN source_url LIKE 'https://%.public.blob.vercel-storage.com/%' THEN 'Vercel Blob'
          WHEN source_url LIKE 'http://%' OR source_url LIKE 'https://%' THEN 'Other URL'
          ELSE 'Unknown Format'
        END as url_type,
        COUNT(*) as count
      FROM source_data
      GROUP BY url_type
      ORDER BY count DESC;
    `;

    urlPatternsResult.rows.forEach(row => {
      const percentage = (parseInt(row.count) / total * 100).toFixed(2);
      console.log(`${row.url_type}: ${parseInt(row.count).toLocaleString()} (${percentage}%)`);
    });

    // 3. 按專案統計
    console.log('\n\n📁 按專案統計 (只顯示有問題的專案):\n');

    const projectStatsResult = await sql`
      SELECT
        p.name as project_name,
        COUNT(*) as total_records,
        COUNT(CASE WHEN sd.source_url IS NULL THEN 1 END) as null_urls,
        COUNT(CASE WHEN sd.source_url = '' THEN 1 END) as empty_urls,
        COUNT(CASE WHEN sd.source_url IS NOT NULL AND sd.source_url != '' THEN 1 END) as valid_urls
      FROM source_data sd
      JOIN projects p ON sd.project_id = p.id
      GROUP BY p.name, p.id
      HAVING COUNT(CASE WHEN sd.source_url IS NULL OR sd.source_url = '' THEN 1 END) > 0
      ORDER BY null_urls DESC, empty_urls DESC;
    `;

    if (projectStatsResult.rows.length === 0) {
      console.log('✓ 所有專案的 source_url 都正常！');
    } else {
      console.log('專案名稱 | 總數 | NULL | 空字串 | 有效');
      console.log('-'.repeat(80));

      projectStatsResult.rows.forEach(row => {
        const nullPct = (parseInt(row.null_urls) / parseInt(row.total_records) * 100).toFixed(1);
        const emptyPct = (parseInt(row.empty_urls) / parseInt(row.total_records) * 100).toFixed(1);
        const validPct = (parseInt(row.valid_urls) / parseInt(row.total_records) * 100).toFixed(1);

        console.log(`${row.project_name}`);
        console.log(`  總數: ${row.total_records}, NULL: ${row.null_urls} (${nullPct}%), 空字串: ${row.empty_urls} (${emptyPct}%), 有效: ${row.valid_urls} (${validPct}%)`);
      });
    }

    // 4. 檢查 projects 表的 pdf_urls
    console.log('\n\n📄 專案 PDF URLs 配置檢查:\n');

    const projectPdfResult = await sql`
      SELECT
        name,
        page_offset,
        CASE
          WHEN pdf_urls IS NULL THEN 'NULL'
          WHEN pdf_urls::text = '{}' THEN 'Empty Object'
          ELSE 'Has URLs'
        END as pdf_urls_status,
        pdf_urls::text as pdf_urls_json
      FROM projects
      ORDER BY name;
    `;

    const projectsByStatus = {};
    projectPdfResult.rows.forEach(row => {
      const status = row.pdf_urls_status;
      if (!projectsByStatus[status]) {
        projectsByStatus[status] = [];
      }
      projectsByStatus[status].push(row.name);
    });

    Object.entries(projectsByStatus).forEach(([status, projects]) => {
      console.log(`\n${status}: ${projects.length} 個專案`);
      if (status !== 'Has URLs') {
        projects.forEach(name => console.log(`  - ${name}`));
      }
    });

    // 5. 範例資料
    console.log('\n\n📝 範例 source_url 資料:\n');

    const samplesResult = await sql`
      SELECT
        p.name as project_name,
        sd.original_data,
        sd.page_number,
        sd.source_url,
        CASE
          WHEN sd.source_url IS NULL THEN 'NULL'
          WHEN sd.source_url = '' THEN 'Empty'
          ELSE 'Valid'
        END as url_status
      FROM source_data sd
      JOIN projects p ON sd.project_id = p.id
      ORDER BY
        CASE
          WHEN sd.source_url IS NULL THEN 1
          WHEN sd.source_url = '' THEN 2
          ELSE 3
        END,
        p.name
      LIMIT 10;
    `;

    samplesResult.rows.forEach((row, idx) => {
      console.log(`\n範例 ${idx + 1}:`);
      console.log(`  專案: ${row.project_name}`);
      console.log(`  頁碼: ${row.page_number}`);
      console.log(`  資料: ${row.original_data.substring(0, 50)}...`);
      console.log(`  URL 狀態: ${row.url_status}`);
      if (row.source_url) {
        console.log(`  URL: ${row.source_url.substring(0, 80)}...`);
      }
    });

    console.log('\n========================================');
    console.log('檢查完成');
    console.log('========================================\n');

  } catch (error) {
    console.error('錯誤:', error.message);
    throw error;
  }
}

checkSourceUrlStatus()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('執行失敗:', error);
    process.exit(1);
  });
