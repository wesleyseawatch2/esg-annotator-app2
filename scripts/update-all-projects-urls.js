/**
更新所有專案的 URL 和 page_number（包含進度專案）
邏輯：
從專案名稱中提取所有公司代號（4位數字）
找出 CSV 中對應的所有公司資料並合併
使用模糊匹配（相似度 >50%）更新 source_url 和 page_number
重建 projects.pdf_urls 對應表
同時將 local_file:// 轉換為 Vercel Blob Storage URL
*/
import fs from 'fs';
import dotenv from 'dotenv';
import { sql } from '@vercel/postgres';

dotenv.config({ path: '.env.local' });

const CSV_PATH = String.raw`C:\Users\wesley\OneDrive\桌面\LAB\ai_cup\company_data_by_annotation_group\all\final_complete_pegatron_updated.csv`;
const BACKUP_DIR = './backups';
const BACKUP_TIMESTAMP = new Date().toISOString().replace(/[:.]/g, '-');
const SIMILARITY_THRESHOLD = 0.4; // 40% 相似度門檻

// ✅ 新增：Vercel Blob Storage 的前綴 URL
const STORAGE_BASE_URL = 'https://hsxn1sjvkgtdpixe.public.blob.vercel-storage.com/';

if (!fs.existsSync(BACKUP_DIR)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/**
 * ✅ 新增：格式化 URL 函數
 * 將 local_file:// 前綴替換為 STORAGE_BASE_URL
 */
function formatUrl(url) {
  if (!url) return '';
  if (url.startsWith('local_file://')) {
    return url.replace('local_file://', STORAGE_BASE_URL);
  }
  return url;
}

/**
解析 CSV
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
根據 _company_key 分組
*/
function groupByCompany(csvData) {
  const grouped = {};
  csvData.forEach(row => {
    const companyKey = row._company_key;
    if (!companyKey || !/^\d{4}$/.test(companyKey)) return; // 只處理4位數字代號
    if (!grouped[companyKey]) grouped[companyKey] = [];
    grouped[companyKey].push(row);
  });
  return grouped;
}

/**
從專案名稱中提取所有公司代號（4位數字）
*/
function extractCompanyKeys(projectName) {
  const matches = projectName.match(/\d{4}/g);
  return matches ? [...new Set(matches)] : []; // 去重
}

/**
標準化文本（去除所有符號，只保留文字和數字）
*/
function normalizeText(text) {
  // 先統一空白字符
  let normalized = text.replace(/\s+/g, ' ').trim();
  // 去除所有符號，只保留中文、英文、數字
  normalized = normalized.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
  return normalized;
}

/**
計算相似度（Levenshtein 距離）
*/
function calculateSimilarity(str1, str2) {
  const len1 = str1.length;
  const len2 = str2.length;
  if (len1 === 0) return len2 === 0 ? 1 : 0;
  if (len2 === 0) return 0;
  const shorter = len1 < len2 ? str1 : str2;
  const longer = len1 < len2 ? str2 : str1;
  if (longer.includes(shorter)) {
    return shorter.length / longer.length;
  }
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
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  const distance = matrix[len2][len1];
  const maxLen = Math.max(len1, len2);
  return 1 - (distance / maxLen);
}

/**
建立 PDF URLs 對應表
*/
function buildPdfUrlsMap(companyDataArray) {
  const pdfUrlsMap = {};
  companyDataArray.forEach(row => {
    const pageNum = parseInt(row.page_number);
    // ✅ 這裡套用 URL 格式化
    const url = formatUrl(row.URL); 
    
    if (!isNaN(pageNum) && url) {
      pdfUrlsMap[pageNum] = url;
    }
  });
  return pdfUrlsMap;
}

/**
備份資料表
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
更新單個專案
*/
async function updateProject(project, groupedData) {
  const projectId = project.id;
  const projectName = project.name;
  console.log(`\n🔄 處理專案: ${projectName}`);
  console.log(`專案 ID: ${projectId}`);

  // 從專案名稱提取公司代號
  const companyKeys = extractCompanyKeys(projectName);
  console.log(`提取到的公司代號: ${companyKeys.join(', ')}`);

  if (companyKeys.length === 0) {
    console.warn(`⚠️ 無法從專案名稱提取公司代號，跳過`);
    return { success: false, reason: 'no_company_key_found' };
  }

  // 合併所有相關公司的 CSV 資料
  let allCompanyData = [];
  const foundKeys = [];
  const missingKeys = [];

  for (const key of companyKeys) {
    if (groupedData[key]) {
      allCompanyData = allCompanyData.concat(groupedData[key]);
      foundKeys.push(key);
    } else {
      missingKeys.push(key);
    }
  }

  if (foundKeys.length > 0) {
    console.log(`✅ 找到公司資料: ${foundKeys.join(', ')} (共 ${allCompanyData.length} 筆)`);
  }
  if (missingKeys.length > 0) {
    console.log(`⚠️ CSV 中找不到: ${missingKeys.join(', ')}`);
  }

  if (allCompanyData.length === 0) {
    console.warn(`⚠️ 沒有對應的 CSV 資料，跳過`);
    return { success: false, reason: 'no_csv_data' };
  }

  // 取得該專案所有 source_data
  const existingData = await sql`SELECT id, original_data, source_url, page_number FROM source_data WHERE project_id = ${projectId} ORDER BY id;`;
  console.log(`現有資料: ${existingData.rows.length} 筆`);
  console.log(`CSV 資料: ${allCompanyData.length} 筆`);

  // 建立資料庫資料的查找表（使用標準化文本）
  const dbDataMap = new Map();
  existingData.rows.forEach(row => {
    const normalizedText = normalizeText(row.original_data);
    dbDataMap.set(normalizedText, {
      id: row.id,
      url: row.source_url,
      page: row.page_number
    });
  });

  // 逐筆匹配並更新（CSV 去找資料庫，使用模糊匹配）
  let matchedCount = 0;
  let updatedCount = 0;
  let notFoundCount = 0;

  for (const csvRow of allCompanyData) {
    const normalizedCsvText = normalizeText(csvRow.data);
    
    // ✅ 這裡套用 URL 格式化，將 local_file:// 轉為 https://...
    const formattedUrl = formatUrl(csvRow.URL);
    const targetPage = parseInt(csvRow.page_number);

    // 先嘗試精確匹配
    let dbMatch = dbDataMap.get(normalizedCsvText);
    let bestSimilarity = 1.0;

    // 如果沒有精確匹配，使用模糊匹配
    if (!dbMatch) {
      bestSimilarity = 0;
      for (const [dbText, dbData] of dbDataMap.entries()) {
        const similarity = calculateSimilarity(normalizedCsvText, dbText);
        if (similarity > SIMILARITY_THRESHOLD && similarity > bestSimilarity) {
          bestSimilarity = similarity;
          dbMatch = dbData;
        }
      }
    }

    if (dbMatch) {
      matchedCount++;

      // 檢查是否需要更新
      // 比對時使用格式化後的 URL
      const needsUpdate =
        dbMatch.url !== formattedUrl ||
        dbMatch.page !== targetPage;

      if (needsUpdate) {
        await sql`
          UPDATE source_data
          SET source_url = ${formattedUrl},  -- ✅ 使用格式化後的 URL
              page_number = ${targetPage}
          WHERE id = ${dbMatch.id};
        `;
        updatedCount++;
      }
    } else {
      notFoundCount++;
    }
  }

  console.log(`✅ CSV 匹配到資料庫: ${matchedCount} 筆`);
  console.log(`✅ 實際更新: ${updatedCount} 筆`);
  if (notFoundCount > 0) {
    console.log(`⚠️ CSV 在資料庫中找不到: ${notFoundCount} 筆`);
  }

  // 重建 pdf_urls (buildPdfUrlsMap 內部已包含 URL 格式化)
  const pdfUrlsMap = buildPdfUrlsMap(allCompanyData);
  await sql`UPDATE projects SET pdf_urls = ${JSON.stringify(pdfUrlsMap)}::jsonb WHERE id = ${projectId};`;
  console.log(`✅ 已更新 pdf_urls: ${Object.keys(pdfUrlsMap).length} 個頁面`);

  return {
    success: true,
    projectId,
    projectName,
    companyKeys: foundKeys,
    existingCount: existingData.rows.length,
    csvCount: allCompanyData.length,
    matchedCount,
    updatedCount,
    notFoundCount,
    pdfUrlsCount: Object.keys(pdfUrlsMap).length
  };
}

/**
主程式
*/
async function main() {
  console.log('🚀 開始更新所有專案的 URL 和 page_number\n');
  console.log(`📄 CSV 檔案: ${CSV_PATH}\n`);
  console.log(`🔗 目標 URL 前綴: ${STORAGE_BASE_URL}\n`);

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

    // 4. 取得所有專案
    console.log('\n📋 取得所有專案...');
    const projectsResult = await sql`
      SELECT id, name, page_offset FROM projects ORDER BY name;
    `;
    console.log(`✅ 找到 ${projectsResult.rows.length} 個專案`);

    // 5. 更新每個專案
    console.log('\n' + '='.repeat(60));
    console.log('開始更新專案資料...');
    console.log('='.repeat(60));

    const results = [];
    for (const project of projectsResult.rows) {
      const result = await updateProject(project, groupedData);
      results.push({ ...result });
    }

    // 6. 摘要報告
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
        console.log(`  - ${r.projectName || '未知'}: ${r.reason}`);
      });
    }

    console.log('\n成功更新的專案詳情:');
    successResults.forEach(r => {
      console.log(`  - ${r.projectName}:`);
      console.log(`      公司代號: ${r.companyKeys.join(', ')}`);
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