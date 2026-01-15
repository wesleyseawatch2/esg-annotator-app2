import { sql } from '@vercel/postgres';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function main() {
  try {
    const { rows } = await sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name='annotations' 
      ORDER BY column_name
    `;
    
    console.log('Annotations 表的列:');
    rows.forEach(row => console.log(`  - ${row.column_name}`));
    
  } catch (error) {
    console.error('錯誤:', error.message);
  }
}

main();
