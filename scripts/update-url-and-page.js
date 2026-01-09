/**
 * 根據 CSV 更新 source_data 的 URL 和 page_number
 *
 * 邏輯：
 * 1. 備份現有的 source_data 和 projects 資料
 * 2. 讀取 CSV 並根據 _company_key 分組
 * 3. 對每個專案：
 *    - 根據 original_data 匹配 CSV 的 data
 *    - 只更新匹配到的 source_url 和 page_number
 *    - 保留沒匹配到的資料不變
 * 4. 重建 projects.pdf_urls 對應表
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
 * 解析 CSV 內容
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

function parseCSV(content) {
  const lines = content.trim().split('\n');
  const header = lines[0].replace(/^\uFEFF/, '').split(',');
  const data = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;

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
 * 根據 _company_key 分組
 */
function groupByCompany(csvData) {
  const grouped = {};
  csvData.forEach(row => {
    const companyKey = row._company_key;
    if (!companyKey) return;
    if (!grouped[companyKey]) grouped[companyKey] = [];
    grouped[companyKey].push(row);
  });
  return grouped;
}

/**
 * 備份資料表
 */
async function backupTables() {
  console.log('📦 開始備份資料...');

  const sourceDataResult = await sql`SELECT * FROM source_data ORDER BY id;`;
  const sourceDataBackup = {
    timestamp: BACKUP_TIMESTAMP,
    table: 'source_data',
    rowCount: sourceDataResult.rows.length,
    data: sourceDataResult.rows
  };

  const sourceDataPath = `${BACKUP_DIR}/source_data_backup_${BACKUP_TIMESTAMP}.json`;
  fs.writeFileSync(sourceDataPath, JSON.stringify(sourceDataBackup, null, 2));
  console.log(`✅ source_data 已備份: ${sourceDataPath} (${sourceDataResult.rows.length} 筆)`);

  const projectsResult = await sql`SELECT id, name, pdf_urls, page_offset FROM projects ORDER BY id;`;
  const projectsBackup = {
    timestamp: BACKUP_TIMESTAMP,
    table: 'projects',
    rowCount: projectsResult.rows.length,
    data: projectsResult.rows
  };

  const projectsPath = `${BACKUP_DIR}/projects_backup_${BACKUP_TIMESTAMP}.json`;
  fs.writeFileSync(projectsPath, JSON.stringify(projectsBackup, null, 2));
  console.log(`✅ projects 已備份: ${projectsPath} (${projectsResult.rows.length} 筆)`);

  return { sourceDataPath, projectsPath };
}

/**
 * 根據公司代號查找專案（排除進度專案）
 */
async function findProjectByCompanyKey(companyKey) {
  const allProjects = await sql`SELECT id, name, page_offset FROM projects;`;

  // 先嘗試完全匹配
  let project = allProjects.rows.find(p => p.name === companyKey);

  if (!project) {
    // 部分匹配，但排除包含「進度」的專案
    const matchingProjects = allProjects.rows.filter(p => {
      const nameMatches = p.name.includes(`_${companyKey}`) || p.name.endsWith(companyKey);
      const isProgressProject = p.name.includes('進度');
      return nameMatches && !isProgressProject;
    });

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
 * 標準化文本（移除/統一空白字符，用於匹配）
 */
function normalizeText(text) {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * 計算兩個字串的相似度（使用 Levenshtein 距離）
 * 返回 0-1 之間的相似度分數
 */
function calculateSimilarity(str1, str2) {
  const len1 = str1.length;
  const len2 = str2.length;

  // 如果其中一個是空字串
  if (len1 === 0) return len2 === 0 ? 1 : 0;
  if (len2 === 0) return 0;

  // 使用較短字串的包含關係作為快速判斷
  const shorter = len1 < len2 ? str1 : str2;
  const longer = len1 < len2 ? str2 : str1;

  if (longer.includes(shorter)) {
    return shorter.length / longer.length;
  }

  // Levenshtein 距離矩陣
  const matrix = [];
  for (let i = 0; i <= len2; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= len1; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= len2; i++) {
    for (let j = 1; j <= len1; j++) {
      if (str2[i - 1] === str1[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // 替換
          matrix[i][j - 1] + 1,     // 插入
          matrix[i - 1][j] + 1      // 刪除
        );
      }
    }
  }

  const distance = matrix[len2][len1];
  const maxLen = Math.max(len1, len2);
  return 1 - (distance / maxLen);
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
 * 更新單個專案
 */
async function updateProject(companyKey, companyData) {
  console.log(`\n🔄 處理公司: ${companyKey}`);

  // 查找專案
  const project = await findProjectByCompanyKey(companyKey);
  if (!project) {
    console.warn(`⚠️  找不到對應專案，跳過: ${companyKey}`);
    return { success: false, reason: 'project_not_found' };
  }

  const projectId = project.id;
  console.log(`   匹配專案: ${project.name} (ID: ${projectId})`);
  console.log(`   page_offset: ${project.page_offset}`);

  // 取得該專案所有 source_data
  const existingData = await sql`
    SELECT id, original_data, source_url, page_number
    FROM source_data
    WHERE project_id = ${projectId}
    ORDER BY id;
  `;

  console.log(`   現有資料: ${existingData.rows.length} 筆`);
  console.log(`   CSV 資料: ${companyData.length} 筆`);

  // 建立 CSV data 的快速查找表（使用標準化文本作為 key）
  const csvDataMap = new Map();
  companyData.forEach(row => {
    const normalizedText = normalizeText(row.data);
    csvDataMap.set(normalizedText, {
      url: row.URL,
      page: parseInt(row.page_number),
      originalText: row.data
    });
  });

  // 逐筆匹配並更新（使用模糊匹配）
  let matchedCount = 0;
  let updatedCount = 0;
  let notFoundCount = 0;
  const SIMILARITY_THRESHOLD = 0.5; // 50% 相似度門檻

  for (const dbRow of existingData.rows) {
    // 使用標準化文本進行模糊匹配
    const normalizedDbText = normalizeText(dbRow.original_data);

    // 先嘗試精確匹配（更快）
    let csvMatch = csvDataMap.get(normalizedDbText);
    let bestSimilarity = 1.0;

    // 如果沒有精確匹配，使用模糊匹配
    if (!csvMatch) {
      bestSimilarity = 0;
      for (const [csvText, csvData] of csvDataMap.entries()) {
        const similarity = calculateSimilarity(normalizedDbText, csvText);
        if (similarity > SIMILARITY_THRESHOLD && similarity > bestSimilarity) {
          bestSimilarity = similarity;
          csvMatch = csvData;
        }
      }
    }

    if (csvMatch) {
      matchedCount++;

      // 檢查是否需要更新
      const needsUpdate =
        dbRow.source_url !== csvMatch.url ||
        dbRow.page_number !== csvMatch.page;

      if (needsUpdate) {
        await sql`
          UPDATE source_data
          SET source_url = ${csvMatch.url},
              page_number = ${csvMatch.page}
          WHERE id = ${dbRow.id};
        `;
        updatedCount++;
      }
    } else {
      notFoundCount++;
    }
  }

  console.log(`   ✅ 匹配: ${matchedCount} 筆`);
  console.log(`   ✅ 更新: ${updatedCount} 筆`);
  if (notFoundCount > 0) {
    console.log(`   ⚠️  未匹配 (保持不變): ${notFoundCount} 筆`);
  }

  // 重建 pdf_urls
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
    existingCount: existingData.rows.length,
    csvCount: companyData.length,
    matchedCount,
    updatedCount,
    notFoundCount,
    pdfUrlsCount: Object.keys(pdfUrlsMap).length
  };
}

/**
 * 主程式
 */
async function main() {
  console.log('🚀 開始更新 URL 和 page_number\n');
  console.log(`📄 CSV 檔案: ${CSV_PATH}\n`);

  try {
    // 1. 備份
    const backupInfo = await backupTables();
    console.log('\n' + '='.repeat(60));

    // 2. 讀取 CSV
    console.log('\n📖 讀取 CSV...');
    const csvContent = fs.readFileSync(CSV_PATH, 'utf8');
    const csvData = parseCSV(csvContent);
    console.log(`✅ 已讀取 ${csvData.length} 筆資料`);

    // 3. 分組
    console.log('\n📊 根據 _company_key 分組...');
    const groupedData = groupByCompany(csvData);
    const companyKeys = Object.keys(groupedData);
    console.log(`✅ 找到 ${companyKeys.length} 個公司`);

    // 4. 更新每個專案
    console.log('\n' + '='.repeat(60));
    console.log('開始更新專案資料...');
    console.log('='.repeat(60));

    const results = [];
    for (const companyKey of companyKeys) {
      const result = await updateProject(companyKey, groupedData[companyKey]);
      results.push({ companyKey, ...result });
    }

    // 5. 摘要報告
    console.log('\n' + '='.repeat(60));
    console.log('📋 執行摘要');
    console.log('='.repeat(60));

    const successResults = results.filter(r => r.success);
    const failedResults = results.filter(r => !r.success);

    console.log(`\n✅ 成功更新: ${successResults.length} 個專案`);
    console.log(`❌ 失敗/跳過: ${failedResults.length} 個專案`);

    if (failedResults.length > 0) {
      console.log('\n失敗的專案:');
      failedResults.forEach(r => {
        console.log(`  - ${r.companyKey}: ${r.reason}`);
      });
    }

    console.log('\n成功更新的專案詳情:');
    successResults.forEach(r => {
      console.log(`  - ${r.companyKey} → ${r.projectName}:`);
      console.log(`      資料庫資料: ${r.existingCount} 筆`);
      console.log(`      CSV 資料: ${r.csvCount} 筆`);
      console.log(`      匹配: ${r.matchedCount} 筆`);
      console.log(`      實際更新: ${r.updatedCount} 筆`);
      if (r.notFoundCount > 0) {
        console.log(`      未匹配 (保持不變): ${r.notFoundCount} 筆`);
      }
      console.log(`      PDF 頁面: ${r.pdfUrlsCount} 頁`);
    });

    const totalMatched = successResults.reduce((sum, r) => sum + r.matchedCount, 0);
    const totalUpdated = successResults.reduce((sum, r) => sum + r.updatedCount, 0);

    console.log('\n總計:');
    console.log(`  匹配: ${totalMatched} 筆`);
    console.log(`  更新: ${totalUpdated} 筆`);

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

main().then(() => {
  console.log('\n程式執行完畢');
  process.exit(0);
}).catch(error => {
  console.error('程式執行失敗:', error);
  process.exit(1);
});
