// 檔案路徑: app/api/migrate-groups/route.js
import { sql } from '@vercel/postgres';
import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const { userId } = await request.json();

    // 驗證管理員權限
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return NextResponse.json({ success: false, error: '權限不足' }, { status: 403 });
    }

    // 1. 建立專案群組表
    await sql`
      CREATE TABLE IF NOT EXISTS project_groups (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        description TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 2. 在 projects 表增加 group_id 欄位
    await sql`
      ALTER TABLE projects
      ADD COLUMN IF NOT EXISTS group_id INTEGER REFERENCES project_groups(id) ON DELETE SET NULL;
    `;

    // 3. 建立使用者-群組權限表（多對多關聯）
    await sql`
      CREATE TABLE IF NOT EXISTS user_group_permissions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        group_id INTEGER NOT NULL REFERENCES project_groups(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, group_id)
      );
    `;

    // 4. 建立索引以提升查詢效能
    await sql`CREATE INDEX IF NOT EXISTS idx_projects_group_id ON projects(group_id);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_user_group_permissions_user_id ON user_group_permissions(user_id);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_user_group_permissions_group_id ON user_group_permissions(group_id);`;

    // 5. 插入預設群組（可選）
    await sql`
      INSERT INTO project_groups (name, description)
      VALUES
        ('預設群組', '所有使用者都可以看到的專案'),
        ('管理員專用', '僅管理員可見的專案')
      ON CONFLICT (name) DO NOTHING;
    `;

    return NextResponse.json({
      success: true,
      message: '資料庫遷移成功！已建立專案群組表和權限表'
    });

  } catch (error) {
    console.error('資料庫遷移失敗:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
