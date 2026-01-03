import fs from 'fs';
import dotenv from 'dotenv';
import { sql } from '@vercel/postgres';

dotenv.config({ path: '.env.local' });

const CSV_PATH = String.raw`C:\Users\wesley\OneDrive\桌面\LAB\ai_cup\company_data_by_annotation_group\all\final_complete_pegatron_updated.csv`;

function normalizeText(text) {
  // 先統一空白字符
  let normalized = text.replace(/\s+/g, ' ').trim();
  // 去除所有符號，只保留中文、英文、數字
  normalized = normalized.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
  return normalized;
}

async function test() {
  // 取一筆未匹配的資料（從 ID 7461）
  const dbData = await sql`
    SELECT id, original_data
    FROM source_data
    WHERE id = 7461;
  `;

  if (dbData.rows.length === 0) {
    console.log('找不到 ID 7461');
    return;
  }

  const dbText = dbData.rows[0].original_data;
  console.log('資料庫文本 (前100字):');
  console.log(dbText.substring(0, 100));
  console.log('\n標準化後:');
  console.log(normalizeText(dbText).substring(0, 100));

  // 讀取 CSV
  const csvContent = fs.readFileSync(CSV_PATH, 'utf8');
  const lines = csvContent.split('\n');

  console.log(`\nCSV 總行數: ${lines.length}`);

  // 檢查是否存在
  const normalizedDbText = normalizeText(dbText);
  let found = false;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    // 簡單解析（取第一個欄位）
    const firstCommaIndex = line.indexOf(',');
    if (firstCommaIndex === -1) continue;

    let dataField = line;
    if (line.startsWith('"')) {
      // 處理引號包覆的情況
      const secondQuoteIndex = line.indexOf('"', 1);
      if (secondQuoteIndex !== -1) {
        dataField = line.substring(1, secondQuoteIndex);
      }
    } else {
      dataField = line.substring(0, firstCommaIndex);
    }

    const normalizedCsvText = normalizeText(dataField);

    if (normalizedCsvText === normalizedDbText) {
      console.log(`\n✅ 找到匹配！在第 ${i} 行`);
      console.log('CSV 文本 (前100字):');
      console.log(dataField.substring(0, 100));
      found = true;
      break;
    }
  }

  if (!found) {
    console.log('\n❌ CSV 中找不到此文本');
    console.log('\n可能原因:');
    console.log('1. CSV 中確實沒有這筆資料');
    console.log('2. CSV 解析邏輯有誤');
    console.log('3. 文本內容有其他差異（標點符號、特殊字符等）');
  }
}

test().then(() => process.exit(0)).catch(err => {
  console.error(err);
  process.exit(1);
});
