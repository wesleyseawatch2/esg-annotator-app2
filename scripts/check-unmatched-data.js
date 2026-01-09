/**
 * 檢查資料庫中有但 CSV 中找不到的資料
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
    }
  }
  return project;
}

async function main() {
  console.log('🔍 檢查未匹配的資料\n');

  // 讀取 CSV
  const csvContent = fs.readFileSync(CSV_PATH, 'utf8');
  const csvData = parseCSV(csvContent);
  const groupedData = groupByCompany(csvData);

  // 取得所有專案
  const projectsResult = await sql`
    SELECT id, name FROM projects ORDER BY name;
  `;

  console.log('='.repeat(80));
  console.log('檢查每個專案的未匹配資料');
  console.log('='.repeat(80));

  const companyKeys = Object.keys(groupedData);
  const allUnmatched = [];

  for (const companyKey of companyKeys) {
    const project = await findProjectByCompanyKey(companyKey, projectsResult.rows);
    if (!project) continue;

    // 取得資料庫資料
    const existingData = await sql`
      SELECT id, original_data, source_url, page_number
      FROM source_data
      WHERE project_id = ${project.id}
      ORDER BY id;
    `;

    // 建立 CSV 查找表
    const csvDataSet = new Set(groupedData[companyKey].map(row => row.data));

    // 找出未匹配的
    const unmatched = existingData.rows.filter(dbRow => !csvDataSet.has(dbRow.original_data));

    if (unmatched.length > 0) {
      console.log(`\n${companyKey} → ${project.name}`);
      console.log(`  總資料: ${existingData.rows.length} 筆`);
      console.log(`  未匹配: ${unmatched.length} 筆\n`);

      // 顯示前 3 筆未匹配的資料
      unmatched.slice(0, 3).forEach((row, idx) => {
        console.log(`  [${idx + 1}] ID: ${row.id}`);
        console.log(`      page: ${row.page_number}`);
        console.log(`      url: ${row.source_url}`);
        console.log(`      文本: ${row.original_data.substring(0, 100)}...`);
        console.log('');
      });

      if (unmatched.length > 3) {
        console.log(`  ... 還有 ${unmatched.length - 3} 筆未顯示\n`);
      }

      allUnmatched.push(...unmatched.map(row => ({
        companyKey,
        projectName: project.name,
        ...row
      })));
    }
  }

  console.log('='.repeat(80));
  console.log('📋 總結');
  console.log('='.repeat(80));
  console.log(`總共 ${allUnmatched.length} 筆未匹配的資料`);

  // 分析未匹配資料的特徵
  if (allUnmatched.length > 0) {
    console.log('\n可能原因分析:');

    // 檢查文本長度分布
    const lengthDistribution = {};
    allUnmatched.forEach(row => {
      const len = row.original_data.length;
      const range = Math.floor(len / 100) * 100;
      lengthDistribution[range] = (lengthDistribution[range] || 0) + 1;
    });

    console.log('\n文本長度分布:');
    Object.keys(lengthDistribution).sort((a, b) => a - b).forEach(range => {
      console.log(`  ${range}-${parseInt(range) + 99} 字元: ${lengthDistribution[range]} 筆`);
    });

    // 檢查是否有特殊字符
    const withSpecialChars = allUnmatched.filter(row =>
      /[\n\r\t]/.test(row.original_data)
    );
    if (withSpecialChars.length > 0) {
      console.log(`\n包含換行/Tab 字符: ${withSpecialChars.length} 筆`);
    }

    // 儲存完整清單到檔案
    const outputPath = `${BACKUP_DIR || './backups'}/unmatched_data_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    if (!fs.existsSync('./backups')) {
      fs.mkdirSync('./backups', { recursive: true });
    }
    fs.writeFileSync(outputPath, JSON.stringify(allUnmatched, null, 2));
    console.log(`\n完整清單已儲存到: ${outputPath}`);
  }
}

main().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('程式執行失敗:', error);
  process.exit(1);
});
