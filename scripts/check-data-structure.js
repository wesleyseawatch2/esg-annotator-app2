// 檢查新上傳資料的結構
import dotenv from 'dotenv';
import { sql } from '@vercel/postgres';

dotenv.config({ path: '.env.local' });

async function checkDataStructure() {
  console.log('\n========================================');
  console.log('  檢查資料結構');
  console.log('========================================\n');

  // 先檢查資料表結構
  console.log('【資料表】source_data 表結構:\n');
  const tableInfo = await sql`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'source_data'
    ORDER BY ordinal_position;
  `;

  tableInfo.rows.forEach(col => {
    console.log(`  - ${col.column_name}`);
    console.log(`    類型: ${col.data_type}`);
    console.log(`    可為空: ${col.is_nullable}`);
    if (col.column_default) console.log(`    預設值: ${col.column_default}`);
    console.log('');
  });

  // 1. 檢查組1的最新資料
  console.log('\n【組1】kgi_2883 最新 5 筆資料結構:\n');
  const kgiData = await sql`
    SELECT
      sd.id,
      sd.project_id,
      sd.original_data,
      sd.source_url,
      sd.page_number,
      sd.bbox,
      p.name as project_name
    FROM source_data sd
    JOIN projects p ON sd.project_id = p.id
    WHERE p.name = '組1_非資訊相關大學生_金融產業_第五周進度(kgi_2883, yuanta_2885)'
    ORDER BY sd.id DESC
    LIMIT 5;
  `;

  kgiData.rows.forEach((row, index) => {
    console.log(`${index + 1}. ID: ${row.id}`);
    console.log(`   專案: ${row.project_name}`);
    console.log(`   頁碼: ${row.page_number}`);
    console.log(`   PDF URL: ${row.source_url ? '有 ✓' : '無 ✗'}`);
    console.log(`   bbox: ${row.bbox ? '有 ✓' : '無 ✗'}`);
    console.log(`   : ${row.}`);
    console.log(`   資料預覽: ${row.original_data.substring(0, 100)}...`);
    console.log('');
  });

  // 2. 檢查組4的最新資料
  console.log('\n【組4】taishin_2887 最新 5 筆資料結構:\n');
  const taishinData = await sql`
    SELECT
      sd.id,
      sd.project_id,
      sd.original_data,
      sd.source_url,
      sd.page_number,
      sd.bbox,
      sd.,
      p.name as project_name
    FROM source_data sd
    JOIN projects p ON sd.project_id = p.id
    WHERE p.name = '組4_資訊相關碩士生_金融產業_第五周進度(taishin_2887)'
    ORDER BY sd.id DESC
    LIMIT 5;
  `;

  taishinData.rows.forEach((row, index) => {
    console.log(`${index + 1}. ID: ${row.id}`);
    console.log(`   專案: ${row.project_name}`);
    console.log(`   頁碼: ${row.page_number}`);
    console.log(`   PDF URL: ${row.source_url ? '有 ✓' : '無 ✗'}`);
    console.log(`   bbox: ${row.bbox ? '有 ✓' : '無 ✗'}`);
    console.log(`   : ${row.}`);
    console.log(`   資料預覽: ${row.original_data.substring(0, 100)}...`);
    console.log('');
  });

  // 3. 比較舊資料的結構（取第一筆作為參考）
  console.log('\n【參考】組1 舊資料（第一筆）結構:\n');
  const oldKgiData = await sql`
    SELECT
      sd.id,
      sd.project_id,
      sd.original_data,
      sd.source_url,
      sd.page_number,
      sd.bbox,
      sd.,
      p.name as project_name
    FROM source_data sd
    JOIN projects p ON sd.project_id = p.id
    WHERE p.name = '組1_非資訊相關大學生_金融產業_第五周進度(kgi_2883, yuanta_2885)'
    ORDER BY sd.id ASC
    LIMIT 3;
  `;

  oldKgiData.rows.forEach((row, index) => {
    console.log(`${index + 1}. ID: ${row.id}`);
    console.log(`   專案: ${row.project_name}`);
    console.log(`   頁碼: ${row.page_number}`);
    console.log(`   PDF URL: ${row.source_url ? '有 ✓' : '無 ✗'}`);
    console.log(`   bbox: ${row.bbox ? '有 ✓' : '無 ✗'}`);
    console.log(`   : ${row.}`);
    console.log(`   資料預覽: ${row.original_data.substring(0, 100)}...`);
    console.log('');
  });

  // 4. 檢查 source_data 表的欄位結構
  console.log('\n【資料表】source_data 表結構:\n');
  const tableInfo = await sql`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_name = 'source_data'
    ORDER BY ordinal_position;
  `;

  tableInfo.rows.forEach(col => {
    console.log(`  - ${col.column_name}`);
    console.log(`    類型: ${col.data_type}`);
    console.log(`    可為空: ${col.is_nullable}`);
    console.log(`    預設值: ${col.column_default || 'NULL'}`);
    console.log('');
  });

  // 5. 統計各專案的資料分布
  console.log('\n【統計】各專案資料數量:\n');
  const stats = await sql`
    SELECT
      p.id,
      p.name,
      COUNT(sd.id) as total_count,
      COUNT(CASE WHEN sd.source_url IS NOT NULL THEN 1 END) as with_pdf,
      COUNT(CASE WHEN sd.source_url IS NULL THEN 1 END) as without_pdf,
      COUNT(CASE WHEN sd.bbox IS NOT NULL THEN 1 END) as with_bbox,
      COUNT(CASE WHEN sd. = true THEN 1 END) as _count
    FROM projects p
    LEFT JOIN source_data sd ON p.id = sd.project_id
    WHERE p.name IN (
      '組1_非資訊相關大學生_金融產業_第五周進度(kgi_2883, yuanta_2885)',
      '組4_資訊相關碩士生_金融產業_第五周進度(taishin_2887)'
    )
    GROUP BY p.id, p.name
    ORDER BY p.id;
  `;

  stats.rows.forEach(row => {
    console.log(`專案: ${row.name}`);
    console.log(`  - 總資料數: ${row.total_count}`);
    console.log(`  - 有 PDF URL: ${row.with_pdf}`);
    console.log(`  - 無 PDF URL: ${row.without_pdf}`);
    console.log(`  - 有 bbox: ${row.with_bbox}`);
    console.log(`  - 已跳過: ${row._count}`);
    console.log('');
  });

  console.log('========================================\n');
}

checkDataStructure().catch(console.error);
