/**
 * 診斷不匹配問題 - 分析為什麼會有這麼多 CSV 資料無法匹配到資料庫
 */

import fs from 'fs';
import dotenv from 'dotenv';
import { sql } from '@vercel/postgres';

dotenv.config({ path: '.env.local' });

const CSV_PATH = String.raw`C:\Users\wesley\OneDrive\桌面\LAB\ai_cup\company_data_by_annotation_group\all\final_complete_pegatron_updated.csv`;
const SIMILARITY_THRESHOLD = 0.4;

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

function normalizeText(text) {
  let normalized = text.replace(/\s+/g, ' ').trim();
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
  console.log('🔍 診斷不匹配問題\n');

  try {
    // 讀取 CSV
    const csvContent = fs.readFileSync(CSV_PATH, 'utf8');
    const csvData = parseCSV(csvContent);
    const groupedData = groupByCompany(csvData);

    console.log(`CSV 總資料: ${csvData.length} 筆`);
    console.log(`公司數量: ${Object.keys(groupedData).length} 個\n`);

    // 取得所有專案
    const projectsResult = await sql`
      SELECT id, name, page_offset FROM projects ORDER BY name;
    `;

    // 選擇幾個有大量不匹配資料的專案進行診斷
    const projectsToAnalyze = [
      '組1_非資訊相關大學生_金融產業_第三周進度(fubon_2881, kgi_2883)',
      '組5_混合組_電腦週邊_第三周進度(ltc_2301, avc_3017, pegatron_4938)',
      '組6_混合組_製造/傳產產業_第三周進度(tcc_1101, emc_2603, fpc_1301)'
    ];

    for (const projectName of projectsToAnalyze) {
      const project = projectsResult.rows.find(p => p.name === projectName);
      if (!project) continue;

      console.log('='.repeat(80));
      console.log(`\n分析專案: ${projectName}\n`);

      const companyKeys = extractCompanyKeys(projectName);
      console.log(`公司代號: ${companyKeys.join(', ')}`);

      // 合併所有相關公司的 CSV 資料
      let allCompanyData = [];
      for (const key of companyKeys) {
        if (groupedData[key]) {
          allCompanyData = allCompanyData.concat(groupedData[key]);
        }
      }

      console.log(`CSV 資料: ${allCompanyData.length} 筆`);

      // 取得資料庫資料
      const existingData = await sql`
        SELECT id, original_data, source_url, page_number
        FROM source_data
        WHERE project_id = ${project.id};
      `;

      console.log(`資料庫資料: ${existingData.rows.length} 筆\n`);

      // 建立資料庫資料的查找表
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

      // 分析不匹配的資料
      const unmatchedSamples = [];
      let totalUnmatched = 0;
      let bestSimilarities = [];

      for (const csvRow of allCompanyData) {
        const normalizedCsvText = normalizeText(csvRow.data);

        // 精確匹配
        let dbMatch = dbDataMap.get(normalizedCsvText);

        // 模糊匹配
        if (!dbMatch) {
          let bestSimilarity = 0;
          let bestMatch = null;

          for (const [dbText, dbData] of dbDataMap.entries()) {
            const similarity = calculateSimilarity(normalizedCsvText, dbText);
            if (similarity > bestSimilarity) {
              bestSimilarity = similarity;
              bestMatch = { dbText, dbData };
            }
          }

          if (bestSimilarity < SIMILARITY_THRESHOLD) {
            totalUnmatched++;
            if (unmatchedSamples.length < 5) {
              unmatchedSamples.push({
                csvText: csvRow.data,
                csvNormalized: normalizedCsvText,
                bestSimilarity,
                bestMatchText: bestMatch ? bestMatch.dbData.originalText : null,
                bestMatchNormalized: bestMatch ? bestMatch.dbText : null
              });
            }
            bestSimilarities.push(bestSimilarity);
          }
        }
      }

      console.log(`總不匹配數: ${totalUnmatched} 筆\n`);

      if (bestSimilarities.length > 0) {
        const avgSimilarity = bestSimilarities.reduce((a, b) => a + b, 0) / bestSimilarities.length;
        const maxSimilarity = Math.max(...bestSimilarities);
        console.log(`平均最佳相似度: ${(avgSimilarity * 100).toFixed(1)}%`);
        console.log(`最高相似度: ${(maxSimilarity * 100).toFixed(1)}%`);
        console.log(`相似度中位數: ${(bestSimilarities.sort()[Math.floor(bestSimilarities.length / 2)] * 100).toFixed(1)}%\n`);
      }

      console.log('不匹配樣本 (前 5 筆):\n');
      unmatchedSamples.forEach((sample, idx) => {
        console.log(`[${idx + 1}] CSV 文本 (前 100 字):`);
        console.log(`    ${sample.csvText.substring(0, 100)}...`);
        console.log(`    標準化: ${sample.csvNormalized.substring(0, 80)}...`);
        console.log(`    最佳相似度: ${(sample.bestSimilarity * 100).toFixed(1)}%`);
        if (sample.bestMatchText) {
          console.log(`    最接近的資料庫資料 (前 100 字):`);
          console.log(`    ${sample.bestMatchText.substring(0, 100)}...`);
          console.log(`    標準化: ${sample.bestMatchNormalized.substring(0, 80)}...`);
        }
        console.log('');
      });
    }

    // 統計所有專案的匹配情況
    console.log('\n' + '='.repeat(80));
    console.log('整體統計\n');

    let totalCsvRecords = 0;
    let totalDbRecords = 0;
    let totalMatched = 0;
    let totalUnmatchedGlobal = 0;

    for (const project of projectsResult.rows) {
      const companyKeys = extractCompanyKeys(project.name);
      if (companyKeys.length === 0) continue;

      let allCompanyData = [];
      for (const key of companyKeys) {
        if (groupedData[key]) {
          allCompanyData = allCompanyData.concat(groupedData[key]);
        }
      }

      if (allCompanyData.length === 0) continue;

      const existingData = await sql`
        SELECT id, original_data FROM source_data WHERE project_id = ${project.id};
      `;

      const dbDataMap = new Map();
      existingData.rows.forEach(row => {
        const normalizedText = normalizeText(row.original_data);
        dbDataMap.set(normalizedText, { id: row.id });
      });

      let matched = 0;
      for (const csvRow of allCompanyData) {
        const normalizedCsvText = normalizeText(csvRow.data);
        let dbMatch = dbDataMap.get(normalizedCsvText);

        if (!dbMatch) {
          let bestSimilarity = 0;
          for (const [dbText] of dbDataMap.entries()) {
            const similarity = calculateSimilarity(normalizedCsvText, dbText);
            if (similarity > SIMILARITY_THRESHOLD && similarity > bestSimilarity) {
              bestSimilarity = similarity;
              dbMatch = { found: true };
            }
          }
        }

        if (dbMatch) matched++;
      }

      totalCsvRecords += allCompanyData.length;
      totalDbRecords += existingData.rows.length;
      totalMatched += matched;
      totalUnmatchedGlobal += (allCompanyData.length - matched);
    }

    console.log(`CSV 總資料: ${totalCsvRecords} 筆`);
    console.log(`資料庫總資料: ${totalDbRecords} 筆`);
    console.log(`可匹配: ${totalMatched} 筆 (${((totalMatched / totalCsvRecords) * 100).toFixed(1)}%)`);
    console.log(`不匹配: ${totalUnmatchedGlobal} 筆 (${((totalUnmatchedGlobal / totalCsvRecords) * 100).toFixed(1)}%)`);

    console.log('\n建議:');
    console.log('1. 如果平均最佳相似度在 30-39% 之間，可以降低門檻到 30%');
    console.log('2. 如果不匹配的資料是新增的內容，這是正常的（CSV 有新資料）');
    console.log('3. 如果不匹配的資料應該要匹配，需要檢查文本差異');

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
