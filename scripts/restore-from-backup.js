/**
 * 從備份還原資料
 *
 * 使用方式:
 * node scripts/restore-from-backup.js <備份時間戳>
 *
 * 例如:
 * node scripts/restore-from-backup.js 2026-01-03T10-30-45-123Z
 */

import fs from 'fs';
import dotenv from 'dotenv';
import { sql } from '@vercel/postgres';

// 載入環境變數
dotenv.config({ path: '.env.local' });

const BACKUP_DIR = './backups';

async function restoreSourceData(backupData) {
  console.log('\n📦 還原 source_data...');

  // 先刪除所有現有資料
  const deleteResult = await sql`DELETE FROM source_data;`;
  console.log(`   已刪除現有資料: ${deleteResult.rowCount} 筆`);

  // 插入備份資料
  let restoredCount = 0;
  for (const row of backupData) {
    await sql`
      INSERT INTO source_data (id, project_id, original_data, source_url, page_number, bbox)
      VALUES (
        ${row.id},
        ${row.project_id},
        ${row.original_data},
        ${row.source_url},
        ${row.page_number},
        ${row.bbox ? JSON.stringify(row.bbox) : null}::jsonb
      );
    `;
    restoredCount++;
  }

  // 更新序列
  await sql`
    SELECT setval('source_data_id_seq', (SELECT MAX(id) FROM source_data));
  `;

  console.log(`   ✅ 已還原 ${restoredCount} 筆資料`);
  return restoredCount;
}

async function restoreProjects(backupData) {
  console.log('\n📦 還原 projects (pdf_urls 和 page_offset)...');

  let restoredCount = 0;
  for (const row of backupData) {
    await sql`
      UPDATE projects
      SET
        pdf_urls = ${row.pdf_urls ? JSON.stringify(row.pdf_urls) : null}::jsonb,
        page_offset = ${row.page_offset}
      WHERE id = ${row.id};
    `;
    restoredCount++;
  }

  console.log(`   ✅ 已還原 ${restoredCount} 個專案的 pdf_urls 和 page_offset`);
  return restoredCount;
}

async function main() {
  const timestamp = process.argv[2];

  if (!timestamp) {
    console.error('❌ 請提供備份時間戳');
    console.error('\n使用方式:');
    console.error('  node scripts/restore-from-backup.js <備份時間戳>');
    console.error('\n可用的備份:');

    if (fs.existsSync(BACKUP_DIR)) {
      const files = fs.readdirSync(BACKUP_DIR);
      const backups = new Set();

      files.forEach(file => {
        const match = file.match(/_([\d-TZ]+)\.json$/);
        if (match) {
          backups.add(match[1]);
        }
      });

      Array.from(backups).sort().reverse().forEach(ts => {
        console.error(`  - ${ts}`);
      });
    }

    process.exit(1);
  }

  const sourceDataPath = `${BACKUP_DIR}/source_data_backup_${timestamp}.json`;
  const projectsPath = `${BACKUP_DIR}/projects_backup_${timestamp}.json`;

  // 檢查備份檔案是否存在
  if (!fs.existsSync(sourceDataPath)) {
    console.error(`❌ 找不到備份檔案: ${sourceDataPath}`);
    process.exit(1);
  }

  if (!fs.existsSync(projectsPath)) {
    console.error(`❌ 找不到備份檔案: ${projectsPath}`);
    process.exit(1);
  }

  console.log('🔄 開始從備份還原資料\n');
  console.log(`📅 備份時間戳: ${timestamp}`);
  console.log(`📁 source_data 備份: ${sourceDataPath}`);
  console.log(`📁 projects 備份: ${projectsPath}`);

  try {
    // 讀取備份檔案
    const sourceDataBackup = JSON.parse(fs.readFileSync(sourceDataPath, 'utf8'));
    const projectsBackup = JSON.parse(fs.readFileSync(projectsPath, 'utf8'));

    console.log(`\n📊 備份資訊:`);
    console.log(`   source_data: ${sourceDataBackup.rowCount} 筆`);
    console.log(`   projects: ${projectsBackup.rowCount} 個`);

    // 詢問確認
    console.log('\n⚠️  警告: 此操作將會覆蓋現有資料！');
    console.log('即將執行還原操作...\n');

    // 開始還原
    const sourceDataCount = await restoreSourceData(sourceDataBackup.data);
    const projectsCount = await restoreProjects(projectsBackup.data);

    console.log('\n' + '='.repeat(60));
    console.log('✨ 還原完成！');
    console.log('='.repeat(60));
    console.log(`✅ source_data: ${sourceDataCount} 筆`);
    console.log(`✅ projects: ${projectsCount} 個`);

  } catch (error) {
    console.error('\n❌ 還原過程發生錯誤:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

main().then(() => {
  console.log('\n程式執行完畢');
  process.exit(0);
}).catch(error => {
  console.error('程式執行失敗:', error);
  process.exit(1);
});
