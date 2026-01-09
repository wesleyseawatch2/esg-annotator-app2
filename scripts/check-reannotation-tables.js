// 檢查重標註功能的資料表是否存在
import { sql } from '@vercel/postgres';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function checkTables() {
  try {
    console.log('檢查重標註功能資料表...\n');

    const tablesToCheck = [
      'reannotation_rounds',
      'reannotation_tasks',
      'agreement_scores_cache',
      'reannotation_audit_log'
    ];

    const columnsToCheck = [
      'reannotation_round',
      'version',
      'persist_answer',
      'reannotation_comment'
    ];

    // 檢查資料表是否存在
    console.log('=== 檢查資料表 ===');
    for (const table of tablesToCheck) {
      const { rows } = await sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_schema = 'public'
          AND table_name = ${table}
        );
      `;
      const exists = rows[0].exists;
      console.log(`${exists ? '✓' : '✗'} ${table}: ${exists ? '已存在' : '不存在'}`);
    }

    // 檢查 annotations 表的欄位
    console.log('\n=== 檢查 annotations 表欄位 ===');
    for (const column of columnsToCheck) {
      const { rows } = await sql`
        SELECT EXISTS (
          SELECT FROM information_schema.columns
          WHERE table_schema = 'public'
          AND table_name = 'annotations'
          AND column_name = ${column}
        );
      `;
      const exists = rows[0].exists;
      console.log(`${exists ? '✓' : '✗'} ${column}: ${exists ? '已存在' : '不存在'}`);
    }

    console.log('\n=== 檢查完成 ===');

  } catch (error) {
    console.error('❌ 檢查失敗:', error.message);
    process.exit(1);
  }
}

checkTables();
