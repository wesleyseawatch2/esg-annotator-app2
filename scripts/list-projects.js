import { sql } from '@vercel/postgres';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function main() {
  try {
    // 查詢前10個專案及其標註數據
    const { rows: projects } = await sql`
      SELECT id, name 
      FROM projects 
      ORDER BY id 
      LIMIT 10
    `;

    console.log('專案列表:\n');

    for (const project of projects) {
      // 計算每個專案的標註數據
      const { rows: counts } = await sql`
        SELECT 
          COUNT(*) as total_annotations,
          COUNT(DISTINCT user_id) as distinct_users,
          COUNT(DISTINCT source_data_id) as distinct_items,
          COUNT(CASE WHEN version = 1 THEN 1 END) as initial_annotations,
          COUNT(CASE WHEN version > 1 OR reannotation_round > 0 THEN 1 END) as reannotation_count
        FROM annotations a
        JOIN source_data sd ON a.source_data_id = sd.id
        WHERE sd.project_id = ${project.id}
      `;

      const data = counts[0] || {};
      console.log(`${project.id}: ${project.name}`);
      console.log(`   總標註: ${data.total_annotations || 0}, 標註者: ${data.distinct_users || 0}, 項目: ${data.distinct_items || 0}`);
      console.log(`   初次標注: ${data.initial_annotations || 0}, 重新標注: ${data.reannotation_count || 0}`);
      console.log('');
    }
    process.exit(0);
  } catch (error) {
    console.error('錯誤:', error.message);
    process.exit(1);
  }
}

main();
