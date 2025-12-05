// 執行公告功能資料庫遷移
// 使用方式: node scripts/migrate-add-announcements.js

import { sql } from '@vercel/postgres';

async function migrate() {
  try {
    console.log('開始執行公告功能資料庫遷移...');

    // 建立 announcements 表
    await sql`
      CREATE TABLE IF NOT EXISTS announcements (
        id SERIAL PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        content TEXT NOT NULL,
        type VARCHAR(20) DEFAULT 'info',
        is_active BOOLEAN DEFAULT TRUE,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;
    console.log('✓ 建立 announcements 表');

    // 建立索引
    await sql`CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements(is_active);`;
    console.log('✓ 建立 is_active 索引');

    await sql`CREATE INDEX IF NOT EXISTS idx_announcements_created_at ON announcements(created_at DESC);`;
    console.log('✓ 建立 created_at 索引');

    console.log('\n✅ 公告功能資料庫遷移完成！');
    console.log('\n說明：');
    console.log('- type 類型: info(一般訊息/藍色), warning(警告/橘色), success(成功/綠色), error(錯誤/紅色)');
    console.log('- is_active: TRUE=顯示公告, FALSE=隱藏公告');
    console.log('\n現在可以在管理後台使用公告管理功能了！');

  } catch (error) {
    console.error('❌ 遷移失敗:', error);
    throw error;
  }
}

migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
