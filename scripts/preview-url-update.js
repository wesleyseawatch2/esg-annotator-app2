/**
 * 預覽 URL 和 page_number 更新 - 不實際執行
 */

import fs from 'fs';
import dotenv from 'dotenv';
import { sql } from '@vercel/postgres';

dotenv.config({ path: '.env.local' });

const CSV_PATH = String.raw`C:\Users\wesley\OneDrive\桌面\LAB\ai_cup\company_data_by_annotation_group\all\final_complete_pegatron_updated.csv`;

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
    if (!companyKey) return;
    if (!grouped[companyKey]) grouped[companyKey] = [];
    grouped[companyKey].push(row);
  });
  return grouped;
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

async function findProjectByCompanyKey(companyKey, allProjects) {
  let project = allProjects.find(p => p.name === companyKey);

  if (!project) {
    const matchingProjects = allProjects.filter(p => {
      const nameMatches = p.name.includes(`_${companyKey}`) || p.name.endsWith(companyKey);
      const isProgressProject = p.name.includes('進度');
      return nameMatches && !isProgressProject;
    });

    if (matchingProjects.length === 1) {
      project = matchingProjects[0];
    } else if (matchingProjects.length > 1) {
      console.warn(`\n⚠️  公司 ${companyKey} 有多個匹配的專案，跳過:`);
      matchingProjects.forEach(p => console.warn(`     - ${p.name}`));
      return null;
    }
  }

  return project;
}

async function main() {
  console.log('🔍 預覽 URL 和 page_number 更新（不實際執行）\n');
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
      SELECT p.id, p.name, p.page_offset, p.pdf_urls,
             COUNT(sd.id) as current_data_count
      FROM projects p
      LEFT JOIN source_data sd ON p.id = sd.project_id
      GROUP BY p.id, p.name, p.page_offset, p.pdf_urls
      ORDER BY p.name;
    `;

    console.log('='.repeat(80));
    console.log('📊 預覽匹配結果');
    console.log('='.repeat(80));

    const matched = [];
    const notMatched = [];

    for (const companyKey of companyKeys) {
      const project = await findProjectByCompanyKey(companyKey, projectsResult.rows);

      if (project) {
        // 取得該專案的 source_data
        const existingData = await sql`
          SELECT id, original_data, source_url, page_number
          FROM source_data
          WHERE project_id = ${project.id};
        `;

        // 建立 CSV 查找表（使用標準化文本）
        const csvDataMap = new Map();
        groupedData[companyKey].forEach(row => {
          const normalizedText = normalizeText(row.data);
          csvDataMap.set(normalizedText, {
            url: row.URL,
            page: parseInt(row.page_number)
          });
        });

        // 計算匹配統計（使用模糊匹配）
        let matchCount = 0;
        let needUpdateCount = 0;
        let notFoundInCSVCount = 0;
        const SIMILARITY_THRESHOLD = 0.5; // 50% 相似度門檻

        for (const dbRow of existingData.rows) {
          const normalizedDbText = normalizeText(dbRow.original_data);

          // 先嘗試精確匹配
          let csvMatch = csvDataMap.get(normalizedDbText);

          // 如果沒有精確匹配，使用模糊匹配
          if (!csvMatch) {
            let bestSimilarity = 0;
            for (const [csvText, csvData] of csvDataMap.entries()) {
              const similarity = calculateSimilarity(normalizedDbText, csvText);
              if (similarity > SIMILARITY_THRESHOLD && similarity > bestSimilarity) {
                bestSimilarity = similarity;
                csvMatch = csvData;
              }
            }
          }

          if (csvMatch) {
            matchCount++;
            const needsUpdate =
              dbRow.source_url !== csvMatch.url ||
              dbRow.page_number !== csvMatch.page;
            if (needsUpdate) {
              needUpdateCount++;
            }
          } else {
            notFoundInCSVCount++;
          }
        }

        matched.push({
          companyKey,
          projectName: project.name,
          projectId: project.id,
          dbRecords: existingData.rows.length,
          csvRecords: groupedData[companyKey].length,
          matchCount,
          needUpdateCount,
          notFoundInCSVCount
        });
      } else {
        notMatched.push({
          companyKey,
          csvRecords: groupedData[companyKey].length
        });
      }
    }

    // 顯示匹配的專案
    console.log('\n✅ 將會更新的專案:');
    console.log('-'.repeat(80));
    matched.forEach(m => {
      console.log(`  ${m.companyKey} → ${m.projectName}`);
      console.log(`    專案 ID: ${m.projectId}`);
      console.log(`    資料庫資料: ${m.dbRecords} 筆`);
      console.log(`    CSV 資料: ${m.csvRecords} 筆`);
      console.log(`    可匹配: ${m.matchCount} 筆`);
      console.log(`    需要更新: ${m.needUpdateCount} 筆`);
      if (m.notFoundInCSVCount > 0) {
        console.log(`    CSV 中找不到 (保持不變): ${m.notFoundInCSVCount} 筆`);
      }
      console.log('');
    });

    // 顯示不匹配的公司
    if (notMatched.length > 0) {
      console.log('\n⚠️  CSV 中有但資料庫沒有的公司 (將會被跳過):');
      console.log('-'.repeat(80));
      notMatched.forEach(m => {
        console.log(`  ${m.companyKey}: ${m.csvRecords} 筆資料`);
      });
    }

    // 摘要
    console.log('\n' + '='.repeat(80));
    console.log('📋 執行摘要 (預覽)');
    console.log('='.repeat(80));
    console.log(`總共將會處理: ${matched.length} 個專案`);
    console.log(`將會跳過: ${notMatched.length} 個公司`);

    const totalDbRecords = matched.reduce((sum, m) => sum + m.dbRecords, 0);
    const totalMatchCount = matched.reduce((sum, m) => sum + m.matchCount, 0);
    const totalNeedUpdate = matched.reduce((sum, m) => sum + m.needUpdateCount, 0);
    const totalNotFound = matched.reduce((sum, m) => sum + m.notFoundInCSVCount, 0);

    console.log(`\n資料庫總資料: ${totalDbRecords} 筆`);
    console.log(`可匹配: ${totalMatchCount} 筆 (${((totalMatchCount/totalDbRecords)*100).toFixed(1)}%)`);
    console.log(`實際需要更新: ${totalNeedUpdate} 筆`);
    if (totalNotFound > 0) {
      console.log(`CSV 中找不到 (將保持不變): ${totalNotFound} 筆 (${((totalNotFound/totalDbRecords)*100).toFixed(1)}%)`);
    }

    console.log('\n' + '='.repeat(80));
    console.log('ℹ️  這只是預覽，沒有實際修改資料庫');
    console.log('ℹ️  若要執行實際更新，請執行: node scripts/update-url-and-page.js');
    console.log('='.repeat(80));

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
