// 修復 annotations 資料表的唯一性約束
// 目的：允許同一使用者對同一筆資料有多個版本的標註（用於重標註功能）
//
// 修改前: UNIQUE(source_data_id, user_id)
// 修改後: UNIQUE(source_data_id, user_id, version)

import dotenv from 'dotenv';
import { sql } from '@vercel/postgres';

// 載入環境變數
dotenv.config({ path: '.env.local' });

async function migrate() {
  try {
    console.log('開始修復 annotations 資料表的唯一性約束...\n');

    // 步驟 1: 檢查現有約束
    console.log('步驟 1/5: 檢查現有約束...');
    const { rows: constraints } = await sql`
      SELECT conname, contype
      FROM pg_constraint
      WHERE conrelid = 'annotations'::regclass
      AND contype = 'u'
    `;

    console.log('現有唯一性約束:', constraints);

    // 步驟 2: 確保所有現有記錄都有 version 欄位
    console.log('\n步驟 2/5: 更新現有記錄的 version 欄位...');
    const { rowCount: updatedRows } = await sql`
      UPDATE annotations
      SET version = 1
      WHERE version IS NULL
    `;
    console.log(`✓ 更新了 ${updatedRows} 筆記錄的 version 為 1`);

    // 步驟 3: 刪除舊的唯一性約束
    console.log('\n步驟 3/5: 刪除舊的唯一性約束...');
    const oldConstraintName = constraints.find(c =>
      c.conname.includes('source_data_id') && c.conname.includes('user_id')
    )?.conname || 'annotations_source_data_id_user_id_key';

    try {
      await sql.query(`ALTER TABLE annotations DROP CONSTRAINT IF EXISTS ${oldConstraintName}`);
      console.log(`✓ 刪除約束: ${oldConstraintName}`);
    } catch (error) {
      console.log(`⚠ 約束可能不存在: ${error.message}`);
    }

    // 步驟 4: 新增新的唯一性約束 (包含 version)
    console.log('\n步驟 4/5: 新增新的唯一性約束...');
    await sql`
      ALTER TABLE annotations
      ADD CONSTRAINT annotations_source_data_id_user_id_version_key
      UNIQUE (source_data_id, user_id, version)
    `;
    console.log('✓ 新增約束: UNIQUE(source_data_id, user_id, version)');

    // 步驟 5: 驗證結果
    console.log('\n步驟 5/5: 驗證新約束...');
    const { rows: newConstraints } = await sql`
      SELECT conname, contype
      FROM pg_constraint
      WHERE conrelid = 'annotations'::regclass
      AND contype = 'u'
    `;
    console.log('新的唯一性約束:', newConstraints);

    console.log('\n✅ 遷移完成！');
    console.log('\n重要提醒:');
    console.log('1. annotations 表現在允許同一使用者對同一資料有多個版本');
    console.log('2. 唯一性約束已改為: UNIQUE(source_data_id, user_id, version)');
    console.log('3. 重標註功能現在可以正確插入新版本的標註記錄');
    console.log('4. 需要更新 app/actions.js 中的 saveAnnotation 函數的 ON CONFLICT 邏輯');

  } catch (error) {
    console.error('\n❌ 遷移失敗:', error.message);
    console.error('\n詳細錯誤:', error);
    process.exit(1);
  }
}

migrate();
