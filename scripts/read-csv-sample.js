import fs from 'fs';

const csvPath = String.raw`C:\Users\wesley\OneDrive\桌面\LAB\ai_cup\company_data_by_annotation_group\all\final_complete_pegatron_updated.csv`;

console.log('Reading CSV from:', csvPath);

const content = fs.readFileSync(csvPath, 'utf8');
const lines = content.split('\n');

console.log('\n總行數:', lines.length);
console.log('\n=== CSV Header ===');
console.log(lines[0]);
console.log('\n=== 前 3 筆資料 ===');
for (let i = 1; i <= 3 && i < lines.length; i++) {
  console.log(`\n第 ${i} 筆:`);
  console.log(lines[i].substring(0, 200) + '...');
}

// 解析 header
const headers = lines[0].split(',');
console.log('\n=== 欄位清單 ===');
headers.forEach((h, idx) => {
  console.log(`${idx}: ${h.trim()}`);
});
