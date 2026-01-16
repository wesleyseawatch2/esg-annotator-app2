// Test script to trigger batch recalculation via API
import fetch from 'node-fetch';

async function testRecalculation() {
    try {
        console.log('=== 觸發批次重新計算 ===\n');
        console.log('注意：這需要 Next.js 開發伺服器正在運行 (npm run dev)\n');

        // 假設使用 admin 用戶的 ID (需要替換為實際的 admin user ID)
        // 這裡我們先嘗試呼叫 API
        const response = await fetch('http://localhost:3000/api/batch-calculate-agreement', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                userId: 1,  // 請替換為實際的 admin user ID
                force: true  // 強制重新計算所有
            })
        });

        if (!response.ok) {
            console.error('API 請求失敗:', response.status, response.statusText);
            const text = await response.text();
            console.error('錯誤訊息:', text);
            return;
        }

        const result = await response.json();

        if (result.success) {
            console.log('✓ 批次計算成功！\n');
            console.log('統計資訊:');
            console.log(`  初次標註專案: ${result.data.summary.totalProjects}`);
            console.log(`  重標註輪次: ${result.data.summary.totalReannotations}`);
            console.log(`  新分析數量: ${result.data.summary.newAnalysis}`);
            console.log(`  使用快取: ${result.data.summary.fromCache}`);
            console.log(`  總結果數: ${result.data.summary.totalResults}\n`);

            // 抽查幾個結果
            if (result.data.results.length > 0) {
                console.log('前 3 個結果範例:');
                result.data.results.slice(0, 3).forEach((r, i) => {
                    console.log(`\n${i + 1}. ${r.projectName}`);
                    console.log(`   類型: ${r.roundType === 'initial' ? '初次標註' : '重標註'}`);
                    console.log(`   來源: ${r.fromCache ? '快取' : '新計算'}`);
                    if (r.detailedResults && r.detailedResults.length > 0) {
                        const firstDetail = r.detailedResults[0];
                        console.log(`   範例分數:`, firstDetail.scores);
                    }
                });
            }
        } else {
            console.error('✗ 批次計算失敗:', result.error);
        }

    } catch (error) {
        console.error('執行失敗:', error.message);
        console.log('\n提示：請確認：');
        console.log('1. Next.js 開發伺服器正在運行 (npm run dev)');
        console.log('2. 伺服器運行在 http://localhost:3000');
        console.log('3. 環境變數已正確設定');
    } finally {
        process.exit(0);
    }
}

testRecalculation();
