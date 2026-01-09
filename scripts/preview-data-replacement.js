/**
 * 預覽資料替換 - 不實際執行，只顯示將會發生的變更
 */

import fs from 'fs';
import dotenv from 'dotenv';
import { sql } from '@vercel/postgres';

// 載入環境變數
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

async function main() {
  console.log('🔍 預覽資料替換（不實際執行）\n');
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

    // 查詢現有專案
    const projectsResult = await sql`
      SELECT p.id, p.name, p.page_offset, p.pdf_urls,
             COUNT(sd.id) as current_data_count
      FROM projects p
      LEFT JOIN source_data sd ON p.id = sd.project_id
      GROUP BY p.id, p.name, p.page_offset, p.pdf_urls
      ORDER BY p.name;
    `;

    console.log('=' .repeat(80));
    console.log('📊 資料庫現有專案 vs CSV 資料對應');
    console.log('='.repeat(80));

    const projectsMap = {};
    projectsResult.rows.forEach(p => {
      projectsMap[p.name] = p;
    });

    console.log(`\n資料庫中共有 ${projectsResult.rows.length} 個專案\n`);

    // 比對每個公司
    const matched = [];
    const notMatched = [];

    companyKeys.forEach(companyKey => {
      // 先嘗試完全匹配
      let project = projectsMap[companyKey];

      // 如果沒有完全匹配，嘗試部分匹配（專案名稱包含公司代號）
      if (!project) {
        const matchingProjects = Object.keys(projectsMap).filter(name =>
          name.includes(`_${companyKey}`) || name.endsWith(companyKey)
        );

        if (matchingProjects.length === 1) {
          project = projectsMap[matchingProjects[0]];
        } else if (matchingProjects.length > 1) {
          console.warn(`\n⚠️  公司 ${companyKey} 有多個匹配的專案，跳過:`);
          matchingProjects.forEach(name => console.warn(`     - ${name}`));
        }
      }

      const csvRecords = groupedData[companyKey].length;

      if (project) {
        matched.push({
          companyKey,
          projectName: project.name,
          projectId: project.id,
          currentRecords: parseInt(project.current_data_count),
          newRecords: csvRecords,
          currentPdfPages: project.pdf_urls ? Object.keys(project.pdf_urls).length : 0,
          pageOffset: project.page_offset
        });
      } else {
        notMatched.push({
          companyKey,
          newRecords: csvRecords
        });
      }
    });

    // 檢查資料庫中有但 CSV 沒有的專案
    const projectsNotInCSV = [];
    projectsResult.rows.forEach(p => {
      if (!groupedData[p.name]) {
        projectsNotInCSV.push({
          projectId: p.id,
          projectName: p.name,
          currentRecords: parseInt(p.current_data_count)
        });
      }
    });

    // 顯示匹配的專案
    console.log('✅ 將會更新的專案 (CSV 中有對應的專案):');
    console.log('-'.repeat(80));
    matched.forEach(m => {
      const diff = m.newRecords - m.currentRecords;
      const diffStr = diff > 0 ? `+${diff}` : diff.toString();
      console.log(`  ${m.companyKey} → ${m.projectName}`);
      console.log(`    專案 ID: ${m.projectId}`);
      console.log(`    現有資料: ${m.currentRecords} 筆 → 新資料: ${m.newRecords} 筆 (${diffStr})`);
      console.log(`    現有 PDF 頁面: ${m.currentPdfPages} 頁`);
      console.log(`    page_offset: ${m.pageOffset}`);
      console.log('');
    });

    // 顯示不匹配的公司
    if (notMatched.length > 0) {
      console.log('\n⚠️  CSV 中有但資料庫沒有的公司 (將會被跳過):');
      console.log('-'.repeat(80));
      notMatched.forEach(m => {
        console.log(`  ${m.companyKey}: ${m.newRecords} 筆資料`);
      });
    }

    // 顯示資料庫有但 CSV 沒有的專案
    if (projectsNotInCSV.length > 0) {
      console.log('\n⚠️  資料庫中有但 CSV 沒有的專案 (不會被更新):');
      console.log('-'.repeat(80));
      projectsNotInCSV.forEach(p => {
        console.log(`  ${p.projectName} (ID: ${p.projectId}): ${p.currentRecords} 筆資料`);
      });
    }

    // 顯示範例資料
    console.log('\n' + '='.repeat(80));
    console.log('📝 CSV 資料範例 (前 3 筆)');
    console.log('='.repeat(80));
    csvData.slice(0, 3).forEach((row, idx) => {
      console.log(`\n第 ${idx + 1} 筆:`);
      console.log(`  公司: ${row._company_key}`);
      console.log(`  頁碼: ${row.page_number}`);
      console.log(`  URL: ${row.URL}`);
      console.log(`  文本: ${row.data.substring(0, 100)}...`);
    });

    // 摘要
    console.log('\n' + '='.repeat(80));
    console.log('📋 執行摘要 (預覽)');
    console.log('='.repeat(80));
    console.log(`總共將會更新: ${matched.length} 個專案`);
    console.log(`將會跳過 (CSV有但DB沒有): ${notMatched.length} 個公司`);
    console.log(`不會被更新 (DB有但CSV沒有): ${projectsNotInCSV.length} 個專案`);

    const totalOldRecords = matched.reduce((sum, m) => sum + m.currentRecords, 0);
    const totalNewRecords = matched.reduce((sum, m) => sum + m.newRecords, 0);
    console.log(`\n總資料筆數變化: ${totalOldRecords} → ${totalNewRecords} (${totalNewRecords - totalOldRecords > 0 ? '+' : ''}${totalNewRecords - totalOldRecords})`);

    console.log('\n' + '='.repeat(80));
    console.log('ℹ️  這只是預覽，沒有實際修改資料庫');
    console.log('ℹ️  若要執行實際替換，請執行: node scripts/replace-all-projects-data.js');
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
