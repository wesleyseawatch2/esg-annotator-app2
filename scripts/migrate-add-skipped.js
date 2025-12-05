// 執行資料庫遷移：添加 skipped 欄位
import { sql } from '@vercel/postgres';
import * as dotenv from 'dotenv';

// 載入環境變數
dotenv.config({ path: '.env.local' });

async function migrate() {
  try {
    console.log('開始執行資料庫遷移...');

    // 添加 skipped 欄位
    await sql`
      ALTER TABLE annotations
      ADD COLUMN IF NOT EXISTS skipped BOOLEAN DEFAULT FALSE;
    `;
    console.log('✓ 成功添加 skipped 欄位');

    // 建立索引
    await sql`
      CREATE INDEX IF NOT EXISTS idx_annotations_skipped ON annotations(skipped);
    `;
    console.log('✓ 成功建立索引');

    console.log('資料庫遷移完成！');
    process.exit(0);
  } catch (error) {
    console.error('資料庫遷移失敗:', error);
    process.exit(1);
  }
}

migrate();
