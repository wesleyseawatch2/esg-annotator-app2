/**
 * 替換所有專案的 data 和 url page 對應
 *
 * 此腳本會：
 * 1. 備份現有的 source_data 和 projects 資料
 * 2. 讀取新的 CSV 檔案
 * 3. 根據 _company_key 分組資料
 * 4. 更新每個專案的 source_data (original_data, source_url, page_number)
 * 5. 重建每個專案的 pdf_urls 對應表
 */

import fs from 'fs';
import dotenv from 'dotenv';
import { sql } from '@vercel/postgres';

// 載入環境變數
dotenv.config({ path: '.env.local' });

const CSV_PATH = String.raw`C:\Users\wesley\OneDrive\桌面\LAB\ai_cup\company_data_by_annotation_group\all\final_complete_pegatron_updated.csv`;
const BACKUP_DIR = './backups';
const BACKUP_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');

// 確保備份目錄存在
if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/**
 * 解析 CSV 內容為物件陣列
 */
function parseCSV(content) {
  const lines = content.trim().split('\n');
  const header = lines[0].replace(/^\uFEFF/, '').split(','); // 移除 BOM

  const data = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

    // 簡單的 CSV 解析（假設欄位不包含逗號，若有引號需要更複雜的解析）
    const values = parseCSVLine(line);
    const obj = {};

    header.forEach((key, idx) => {
      obj[key.trim()] = values[idx] ? values[idx].trim() : '';
    });

    data.push(obj);
  }

  return data;
}

/**
 * 解析單行 CSV（處理引號內的逗號）
 */
function parseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  result.push(current);
  return result;
}

/**
 * 備份資料表
 */
async function backupTables() {
  console.log('📦 開始備份資料...');

  // 備份 source_data
  const sourceDataResult = await sql`
    SELECT * FROM source_data ORDER BY id;
  `;
  const sourceDataBackup = {
    timestamp: BACKUP_TIMESTAMP,
    table: 'source_data',
    rowCount: sourceDataResult.rows.length,
    data: sourceDataResult.rows
  };

  const sourceDataPath = `${BACKUP_DIR}/source_data_backup_${BACKUP_TIMESTAMP}.json`;
  fs.writeFileSync(sourceDataPath, JSON.stringify(sourceDataBackup, null, 2));
  console.log(`✅ source_data 已備份: ${sourceDataPath} (${sourceDataResult.rows.length} 筆)`);

  // 備份 projects (只備份 pdf_urls)
  const projectsResult = await sql`
    SELECT id, name, pdf_urls, page_offset FROM projects ORDER BY id;
  `;
  const projectsBackup = {
    timestamp: BACKUP_TIMESTAMP,
    table: 'projects',
    rowCount: projectsResult.rows.length,
    data: projectsResult.rows
  };

  const projectsPath = `${BACKUP_DIR}/projects_backup_${BACKUP_TIMESTAMP}.json`;
  fs.writeFileSync(projectsPath, JSON.stringify(projectsBackup, null, 2));
  console.log(`✅ projects 已備份: ${projectsPath} (${projectsResult.rows.length} 筆)`);

  return {
    sourceDataPath,
    projectsPath,
    sourceDataCount: sourceDataResult.rows.length,
    projectsCount: projectsResult.rows.length
  };
}

/**
 * 根據 _company_key 分組資料
 */
function groupByCompany(csvData) {
  const grouped = {};

  csvData.forEach(row => {
    const companyKey = row._company_key;
    if (!companyKey) {
      console.warn('⚠️  發現沒有 _company_key 的資料:', row.data.substring(0, 50));
      return;
    }

    if (!grouped[companyKey]) {
      grouped[companyKey] = [];
    }

    grouped[companyKey].push(row);
  });

  return grouped;
}

/**
 * 建立 PDF URLs 對應表
 */
function buildPdfUrlsMap(companyData) {
  const pdfUrlsMap = {};

  companyData.forEach(row => {
    const pageNum = parseInt(row.page_number);
    const url = row.URL;

    if (!isNaN(pageNum) && url) {
      pdfUrlsMap[pageNum] = url;
    }
  });

  return pdfUrlsMap;
}

/**
 * 根據公司代號查找專案
 */
async function findProjectByCompanyKey(companyKey) {
  // 先查詢所有專案
  const allProjects = await sql`
    SELECT id, name, page_offset FROM projects;
  `;

  // 先嘗試完全匹配
  let project = allProjects.rows.find(p => p.name === companyKey);

  // 如果沒有完全匹配，嘗試部分匹配
  if (!project) {
    const matchingProjects = allProjects.rows.filter(p =>
      p.name.includes(`_${companyKey}`) || p.name.endsWith(companyKey)
    );

    if (matchingProjects.length === 1) {
      project = matchingProjects[0];
    } else if (matchingProjects.length > 1) {
      console.warn(`⚠️  公司 ${companyKey} 有多個匹配的專案，跳過:`);
      matchingProjects.forEach(p => console.warn(`     - ${p.name}`));
      return null;
    }
  }

  return project;
}

/**
 * 更新專案資料
 */
async function updateProject(companyKey, companyData) {
  console.log(`\n🔄 處理公司: ${companyKey}`);

  // 查詢專案
  const project = await findProjectByCompanyKey(companyKey);

  if (!project) {
    console.warn(`⚠️  找不到對應專案，跳過: ${companyKey}`);
    return { success: false, reason: 'project_not_found' };
  }

  const projectId = project.id;
  console.log(`   匹配專案: ${project.name}`);

  console.log(`   專案 ID: ${projectId}, 現有 page_offset: ${project.page_offset}`);

  // 1. 刪除舊的 source_data
  const deleteResult = await sql`
    DELETE FROM source_data WHERE project_id = ${projectId};
  `;
  console.log(`   ✅ 已刪除舊資料: ${deleteResult.rowCount} 筆`);

  // 2. 插入新的 source_data
  let insertedCount = 0;
  for (const row of companyData) {
    const pageNum = parseInt(row.page_number);
    if (isNaN(pageNum)) {
      console.warn(`   ⚠️  頁碼無效，跳過: ${row.page_number}`);
      continue;
    }

    await sql`
      INSERT INTO source_data (project_id, original_data, source_url, page_number)
      VALUES (
        ${projectId},
        ${row.data},
        ${row.URL},
        ${pageNum}
      );
    `;
    insertedCount++;
  }
  console.log(`   ✅ 已插入新資料: ${insertedCount} 筆`);

  // 3. 重建 pdf_urls
  const pdfUrlsMap = buildPdfUrlsMap(companyData);
  await sql`
    UPDATE projects
    SET pdf_urls = ${JSON.stringify(pdfUrlsMap)}::jsonb
    WHERE id = ${projectId};
  `;
  console.log(`   ✅ 已更新 pdf_urls: ${Object.keys(pdfUrlsMap).length} 個頁面`);

  return {
    success: true,
    projectId,
    projectName: project.name,
    deletedCount: deleteResult.rowCount,
    insertedCount,
    pdfUrlsCount: Object.keys(pdfUrlsMap).length
  };
}

/**
 * 主要執行流程
 */
async function main() {
  console.log('🚀 開始替換所有專案的資料\n');
  console.log(`📄 CSV 檔案: ${CSV_PATH}`);

  try {
    // 1. 備份資料
    const backupInfo = await backupTables();
    console.log('\n' + '='.repeat(60));

    // 2. 讀取 CSV
    console.log('\n📖 讀取 CSV 檔案...');
    const csvContent = fs.readFileSync(CSV_PATH, 'utf8');
    const csvData = parseCSV(csvContent);
    console.log(`✅ 已讀取 ${csvData.length} 筆資料`);

    // 3. 根據 _company_key 分組
    console.log('\n📊 根據 _company_key 分組...');
    const groupedData = groupByCompany(csvData);
    const companyKeys = Object.keys(groupedData);
    console.log(`✅ 找到 ${companyKeys.length} 個公司`);

    // 顯示每個公司的資料筆數
    console.log('\n公司資料統計:');
    companyKeys.forEach(key => {
      console.log(`  - ${key}: ${groupedData[key].length} 筆`);
    });

    // 4. 更新每個專案
    console.log('\n' + '='.repeat(60));
    console.log('開始更新專案資料...');
    console.log('='.repeat(60));

    const results = [];
    for (const companyKey of companyKeys) {
      const result = await updateProject(companyKey, groupedData[companyKey]);
      results.push({
        companyKey,
        projectName: result.projectName,
        ...result
      });
    }

    // 5. 產生摘要報告
    console.log('\n' + '='.repeat(60));
    console.log('📋 執行摘要');
    console.log('='.repeat(60));

    const successCount = results.filter(r => r.success).length;
    const failedCount = results.filter(r => !r.success).length;

    console.log(`\n✅ 成功更新: ${successCount} 個專案`);
    console.log(`❌ 失敗/跳過: ${failedCount} 個專案`);

    if (failedCount > 0) {
      console.log('\n失敗的專案:');
      results.filter(r => !r.success).forEach(r => {
        console.log(`  - ${r.companyKey}: ${r.reason}`);
      });
    }

    console.log('\n成功更新的專案詳情:');
    results.filter(r => r.success).forEach(r => {
      console.log(`  - ${r.companyKey} → ${r.projectName}:`);
      console.log(`      專案 ID: ${r.projectId}`);
      console.log(`      刪除舊資料: ${r.deletedCount} 筆`);
      console.log(`      插入新資料: ${r.insertedCount} 筆`);
      console.log(`      PDF 頁面: ${r.pdfUrlsCount} 頁`);
    });

    console.log('\n' + '='.repeat(60));
    console.log('✨ 全部完成！');
    console.log('='.repeat(60));
    console.log(`\n📦 備份位置:`);
    console.log(`   - ${backupInfo.sourceDataPath}`);
    console.log(`   - ${backupInfo.projectsPath}`);

  } catch (error) {
    console.error('\n❌ 執行過程發生錯誤:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

// 執行主程式
main().then(() => {
  console.log('\n程式執行完畢');
  process.exit(0);
}).catch(error => {
  console.error('程式執行失敗:', error);
  process.exit(1);
});
