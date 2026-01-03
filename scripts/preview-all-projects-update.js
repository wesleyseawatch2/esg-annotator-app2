/**
 * 預覽所有專案的 URL 和 page_number 更新 - 不實際執行
 */

import fs from 'fs';
import dotenv from 'dotenv';
import { sql } from '@vercel/postgres';

dotenv.config({ path: '.env.local' });

const CSV_PATH = String.raw`C:\Users\wesley\OneDrive\桌面\LAB\ai_cup\company_data_by_annotation_group\all\final_complete_pegatron_updated.csv`;
const SIMILARITY_THRESHOLD = 0.2; // 20% 相似度門檻

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

function groupByCompany(csvData) {
  const grouped = {};
  csvData.forEach(row => {
    const companyKey = row._company_key;
    if (!companyKey || !/^\d{4}$/.test(companyKey)) return;
    if (!grouped[companyKey]) grouped[companyKey] = [];
    grouped[companyKey].push(row);
  });
  return grouped;
}

function extractCompanyKeys(projectName) {
  const matches = projectName.match(/\d{4}/g);
  return matches ? [...new Set(matches)] : [];
}

/**
 * 標準化文本（去除所有符號，只保留文字和數字）
 */
function normalizeText(text) {
  // 先統一空白字符
  let normalized = text.replace(/\s+/g, ' ').trim();
  // 去除所有符號，只保留中文、英文、數字
  normalized = normalized.replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, '');
  return normalized;
}

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

async function main() {
  console.log('🔍 預覽所有專案的 URL 和 page_number 更新（不實際執行）\n');
  console.log(`📄 CSV 檔案: ${CSV_PATH}\n`);

  try {
    // 讀取 CSV
    const csvContent = fs.readFileSync(CSV_PATH, 'utf8');
    const csvData = parseCSV(csvContent);
    console.log(`✅ CSV 資料: ${csvData.length} 筆\n`);

    // 分組
    const groupedData = groupByCompany(csvData);
    const companyKeys = Object.keys(groupedData);
    console.log(`✅ 找到 ${companyKeys.length} 個公司\n`);

    // 取得所有專案
    const projectsResult = await sql`
      SELECT id, name, page_offset FROM projects ORDER BY name;
    `;

    console.log('='.repeat(80));
    console.log('📊 預覽匹配結果');
    console.log('='.repeat(80));

    const results = [];

    for (const project of projectsResult.rows) {
      const projectName = project.name;
      const companyKeys = extractCompanyKeys(projectName);

      if (companyKeys.length === 0) {
        results.push({
          projectName,
          status: 'skip',
          reason: '無法提取公司代號'
        });
        continue;
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

      if (allCompanyData.length === 0) {
        results.push({
          projectName,
          status: 'skip',
          reason: 'CSV 中無對應資料',
          companyKeys
        });
        continue;
      }

      // 取得該專案的 source_data
      const existingData = await sql`
        SELECT id, original_data, source_url, page_number
        FROM source_data
        WHERE project_id = ${project.id};
      `;

      // 建立資料庫資料的查找表（使用標準化文本）
      const dbDataMap = new Map();
      existingData.rows.forEach(row => {
        const normalizedText = normalizeText(row.original_data);
        dbDataMap.set(normalizedText, {
          id: row.id,
          url: row.source_url,
          page: row.page_number,
          originalText: row.original_data
        });
      });

      // 計算匹配統計（CSV 去找資料庫，使用模糊匹配）
      let matchCount = 0;
      let needUpdateCount = 0;
      let notFoundInDBCount = 0;
      const unmatchedRecords = []; // 記錄未匹配的 CSV 資料

      for (const csvRow of allCompanyData) {
        const normalizedCsvText = normalizeText(csvRow.data);

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
          matchCount++;
          const needsUpdate =
            dbMatch.url !== csvRow.URL ||
            dbMatch.page !== parseInt(csvRow.page_number);
          if (needsUpdate) {
            needUpdateCount++;
          }
        } else {
          notFoundInDBCount++;
          unmatchedRecords.push({
            csvText: csvRow.data,
            csvUrl: csvRow.URL,
            csvPage: parseInt(csvRow.page_number)
          });
        }
      }

      results.push({
        projectName,
        status: 'success',
        companyKeys: foundKeys,
        missingKeys,
        dbRecords: existingData.rows.length,
        csvRecords: allCompanyData.length,
        matchCount,
        needUpdateCount,
        notFoundInDBCount,
        unmatchedRecords
      });
    }

    // 顯示成功的專案
    const successResults = results.filter(r => r.status === 'success');
    const skipResults = results.filter(r => r.status === 'skip');

    console.log('\n✅ 將會更新的專案:');
    console.log('-'.repeat(80));
    successResults.forEach(r => {
      console.log(`  ${r.projectName}`);
      console.log(`    公司代號: ${r.companyKeys.join(', ')}`);
      if (r.missingKeys && r.missingKeys.length > 0) {
        console.log(`    ⚠️  CSV 中找不到: ${r.missingKeys.join(', ')}`);
      }
      console.log(`    資料庫資料: ${r.dbRecords} 筆`);
      console.log(`    CSV 資料: ${r.csvRecords} 筆`);
      console.log(`    可匹配: ${r.matchCount} 筆`);
      console.log(`    需要更新: ${r.needUpdateCount} 筆`);
      if (r.notFoundInDBCount > 0) {
        console.log(`    資料庫中找不到: ${r.notFoundInDBCount} 筆`);
      }
      console.log('');
    });

    // 顯示跳過的專案
    if (skipResults.length > 0) {
      console.log('\n⚠️  將會跳過的專案:');
      console.log('-'.repeat(80));
      skipResults.forEach(r => {
        console.log(`  ${r.projectName}`);
        console.log(`    原因: ${r.reason}`);
        if (r.companyKeys) {
          console.log(`    提取的代號: ${r.companyKeys.join(', ')}`);
        }
        console.log('');
      });
    }

    // 摘要
    console.log('='.repeat(80));
    console.log('📋 執行摘要 (預覽)');
    console.log('='.repeat(80));
    console.log(`總共將會處理: ${successResults.length} 個專案`);
    console.log(`將會跳過: ${skipResults.length} 個專案`);

    const totalDbRecords = successResults.reduce((sum, r) => sum + r.dbRecords, 0);
    const totalCsvRecords = successResults.reduce((sum, r) => sum + r.csvRecords, 0);
    const totalMatchCount = successResults.reduce((sum, r) => sum + r.matchCount, 0);
    const totalNeedUpdate = successResults.reduce((sum, r) => sum + r.needUpdateCount, 0);
    const totalNotFound = successResults.reduce((sum, r) => sum + r.notFoundInDBCount, 0);

    console.log(`\n資料庫總資料: ${totalDbRecords} 筆`);
    console.log(`CSV 總資料: ${totalCsvRecords} 筆`);
    console.log(`CSV 可匹配到資料庫: ${totalMatchCount} 筆 (${((totalMatchCount/totalCsvRecords)*100).toFixed(1)}%)`);
    console.log(`實際需要更新: ${totalNeedUpdate} 筆`);
    if (totalNotFound > 0) {
      console.log(`CSV 在資料庫中找不到: ${totalNotFound} 筆 (${((totalNotFound/totalCsvRecords)*100).toFixed(1)}%)`);
    }

    console.log('\n' + '='.repeat(80));
    console.log('ℹ️  這只是預覽，沒有實際修改資料庫');
    console.log('ℹ️  若要執行實際更新，請執行: node scripts/update-all-projects-urls.js');
    console.log('='.repeat(80));

    // 顯示部分未匹配的資料
    const projectsWithUnmatched = successResults.filter(r => r.notFoundInDBCount > 0);

    if (projectsWithUnmatched.length > 0) {
      console.log('\n' + '='.repeat(80));
      console.log('⚠️  部分未匹配的資料範例');
      console.log('='.repeat(80));

      projectsWithUnmatched.forEach(r => {
        console.log(`\n專案: ${r.projectName}`);
        console.log(`未匹配數量: ${r.notFoundInDBCount} 筆`);

        // 只顯示前 3 筆
        r.unmatchedRecords.slice(0, 3).forEach((item, idx) => {
          console.log(`  [${idx + 1}] ${item.csvText.substring(0, 80)}...`);
        });

        if (r.unmatchedRecords.length > 3) {
          console.log(`  ... 還有 ${r.unmatchedRecords.length - 3} 筆`);
        }
      });
    }

  } catch (error) {
    console.error('\n❌ 執行過程發生錯誤:', error);
    console.error(error.stack);
    process.exit(1);
  }
}

main().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('程式執行失敗:', error);
  process.exit(1);
});
