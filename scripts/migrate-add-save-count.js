// 執行資料庫遷移：添加 save_count 欄位
import { sql } from '@vercel/postgres';
import * as dotenv from 'dotenv';

// 載入環境變數
dotenv.config({ path: '.env.local' });

async function migrate() {
  try {
    console.log('開始執行資料庫遷移...');

    // 1. 添加 save_count 欄位
    await sql`
      ALTER TABLE annotations
      ADD COLUMN IF NOT EXISTS save_count INTEGER DEFAULT 0;
    `;
    console.log('✓ 成功添加 save_count 欄位');

    // 2. 為現有資料初始化 save_count (根據 audit log)
    await sql`
      UPDATE annotations a
      SET save_count = (
          SELECT COUNT(DISTINCT DATE_TRUNC('second', changed_at))
          FROM reannotation_audit_log r
          WHERE r.source_data_id = a.source_data_id
          AND r.user_id = a.user_id
      )
      WHERE EXISTS (
          SELECT 1
          FROM reannotation_audit_log r
          WHERE r.source_data_id = a.source_data_id
          AND r.user_id = a.user_id
      );
    `;
    console.log('✓ 成功初始化已有重標註記錄的資料');

    // 3. 為沒有重標註記錄的資料設定 save_count = 1
    await sql`
      UPDATE annotations
      SET save_count = 1
      WHERE save_count = 0 AND status = 'completed';
    `;
    console.log('✓ 成功初始化初次標註的資料');

    // 4. 建立索引
    await sql`
      CREATE INDEX IF NOT EXISTS idx_annotations_save_count ON annotations(save_count);
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
