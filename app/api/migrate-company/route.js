import { sql } from '@vercel/postgres';
import { readFileSync } from 'fs';
import { join } from 'path';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  try {
    // 讀取 SQL 遷移腳本
    const sqlFilePath = join(process.cwd(), 'scripts', 'add-company-management.sql');
    const migrationSQL = readFileSync(sqlFilePath, 'utf8');

    // 執行遷移
    await sql.query(migrationSQL);

    return Response.json({
      success: true,
      message: '公司管理資料表建立成功！'
    });
  } catch (error) {
    console.error('遷移失敗:', error);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
