import { sql } from '@vercel/postgres';

async function checkData() {
  try {
    // 檢查所有專案
    const { rows: projects } = await sql`
      SELECT id, name FROM projects ORDER BY name;
    `;
    console.log('\n=== 專案列表 ===');
    console.log(`總共 ${projects.length} 個專案:`);
    projects.forEach(p => console.log(`  ${p.id}: ${p.name}`));

    // 檢查所有公司
    const { rows: companies } = await sql`
      SELECT id, code, group_name, total_records FROM companies ORDER BY group_name, code;
    `;
    console.log('\n=== 公司列表 ===');
    console.log(`總共 ${companies.length} 個公司:`);
    companies.forEach(c => console.log(`  ${c.id}: ${c.group_name}_${c.code} (${c.total_records} 筆)`));

    // 比對差異
    console.log('\n=== 差異分析 ===');
    
    // 從專案提取公司資訊
    const projectCompanies = new Set();
    projects.forEach(p => {
      const parts = p.name.split('_');
      if (parts.length >= 2) {
        const groupName = parts[0];
        const companyCode = parts.slice(1).join('_');
        projectCompanies.add(`${groupName}_${companyCode}`);
      }
    });
    
    // 從公司表提取公司資訊
    const companyRecords = new Set();
    companies.forEach(c => {
      companyRecords.add(`${c.group_name}_${c.code}`);
    });
    
    console.log(`專案中的公司數: ${projectCompanies.size}`);
    console.log(`公司表中的公司數: ${companyRecords.size}`);
    
    // 找出在公司表但不在專案中的
    console.log('\n在公司表但不在專案中的:');
    let orphanCount = 0;
    companyRecords.forEach(comp => {
      if (!projectCompanies.has(comp)) {
        console.log(`  ❌ ${comp}`);
        orphanCount++;
      }
    });
    
    if (orphanCount === 0) {
      console.log('  (無)');
    }
    
    // 找出在專案但不在公司表中的
    console.log('\n在專案但不在公司表中的:');
    let missingCount = 0;
    projectCompanies.forEach(comp => {
      if (!companyRecords.has(comp)) {
        console.log(`  ⚠️  ${comp}`);
        missingCount++;
      }
    });
    
    if (missingCount === 0) {
      console.log('  (無)');
    }

    process.exit(0);
  } catch (error) {
    console.error('錯誤:', error);
    process.exit(1);
  }
}

checkData();
