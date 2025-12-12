// 檔案路徑: scripts/check-db.js
import { sql } from '@vercel/postgres';
import * as dotenv from 'dotenv';

// 載入環境變數
dotenv.config({ path: '.env.local' });

async function check() {
  try {
    console.log('正在檢查資料庫結構...');

    // 查詢 annotations 表的所有欄位
    const { rows } = await sql`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'annotations';
    `;

    // 檢查是否有 is_marked 欄位
    const hasIsMarked = rows.some(row => row.column_name === 'is_marked');

    if (hasIsMarked) {
      console.log('✅ 驗證成功！`annotations` 表中已包含 `is_marked` 欄位。');
      console.log('欄位列表:', rows.map(r => r.column_name).join(', '));
    } else {
      console.error('❌ 驗證失敗！找不到 `is_marked` 欄位。請重新執行 migration。');
    }

    process.exit(0);
  } catch (error) {
    console.error('檢查時發生錯誤:', error);
    process.exit(1);
  }
}

check();