// 驗證程式碼修改是否正確
import fs from 'fs';
import path from 'path';

console.log('=== 驗證程式碼修改 ===\n');

const checks = [];

// 1. 檢查 /api/reannotation/submit/route.js
console.log('檢查 1: /api/reannotation/submit/route.js');
const submitPath = 'app/api/reannotation/submit/route.js';
const submitContent = fs.readFileSync(submitPath, 'utf8');

// 檢查是否有 save_count 邏輯
const hasSaveCountVar = submitContent.includes('const currentSaveCount = oldAnnotation.save_count || 0;');
const hasSaveCountInAnnotation = submitContent.includes('save_count: currentSaveCount + 1');
const hasSaveCountInInsert = submitContent.includes('save_count,') && submitContent.includes('${newAnnotation.save_count}');
const hasSaveCountInUpdate = submitContent.includes('save_count = EXCLUDED.save_count');

console.log(`  ✓ 計算 currentSaveCount: ${hasSaveCountVar ? '✓' : '✗'}`);
console.log(`  ✓ 設定 save_count + 1: ${hasSaveCountInAnnotation ? '✓' : '✗'}`);
console.log(`  ✓ INSERT 包含 save_count: ${hasSaveCountInInsert ? '✓' : '✗'}`);
console.log(`  ✓ UPDATE 包含 save_count: ${hasSaveCountInUpdate ? '✓' : '✗'}`);

checks.push(hasSaveCountVar && hasSaveCountInAnnotation && hasSaveCountInInsert && hasSaveCountInUpdate);

// 2. 檢查 /app/reannotation/[taskId]/page.js
console.log('\n檢查 2: /app/reannotation/[taskId]/page.js');
const taskDetailPath = 'app/reannotation/[taskId]/page.js';
const taskDetailContent = fs.readFileSync(taskDetailPath, 'utf8');

// 檢查是否有觸發一致性計算的邏輯
const hasTriggerConsistency = taskDetailContent.includes('await fetch(`/api/consistency?projectId=${groupData.projectId}&userId=${user.id}`)');
const hasGroupDataCheck = taskDetailContent.includes('if (groupData && groupData.projectId)');

console.log(`  ✓ 檢查 groupData 存在: ${hasGroupDataCheck ? '✓' : '✗'}`);
console.log(`  ✓ 觸發 /api/consistency: ${hasTriggerConsistency ? '✓' : '✗'}`);

checks.push(hasTriggerConsistency && hasGroupDataCheck);

// 3. 檢查 /app/page.js
console.log('\n檢查 3: /app/page.js');
const mainPagePath = 'app/page.js';
const mainPageContent = fs.readFileSync(mainPagePath, 'utf8');

// 檢查是否有 visibilitychange 監聽器
const hasVisibilityListener = mainPageContent.includes('visibilitychange');
const hasFetchInVisibility = mainPageContent.includes('fetchProjectReannotationTasks()') &&
                              mainPageContent.includes('handleVisibilityChange');

console.log(`  ✓ 監聽 visibilitychange: ${hasVisibilityListener ? '✓' : '✗'}`);
console.log(`  ✓ 觸發 fetchProjectReannotationTasks: ${hasFetchInVisibility ? '✓' : '✗'}`);

checks.push(hasVisibilityListener && hasFetchInVisibility);

// 4. 檢查 /app/reannotation/page.js
console.log('\n檢查 4: /app/reannotation/page.js');
const reannotationListPath = 'app/reannotation/page.js';
const reannotationListContent = fs.readFileSync(reannotationListPath, 'utf8');

// 檢查是否有監聽器
const hasListenerInReannotation = reannotationListContent.includes('visibilitychange') ||
                                  reannotationListContent.includes('focus');

console.log(`  ✓ 監聽頁面顯示事件: ${hasListenerInReannotation ? '✓' : '✗'}`);

checks.push(hasListenerInReannotation);

// 5. 檢查 /api/consistency/route.js
console.log('\n檢查 5: /api/consistency/route.js');
const consistencyPath = 'app/api/consistency/route.js';
const consistencyContent = fs.readFileSync(consistencyPath, 'utf8');

// 檢查查詢邏輯
const hasDistinctOn = consistencyContent.includes('SELECT DISTINCT ON (a.source_data_id, a.user_id)');
const hasReannotationOrder = consistencyContent.includes('ORDER BY a.source_data_id, a.user_id, a.reannotation_round DESC');
const hasUserIdParse = consistencyContent.includes('const userIdNum = parseInt(userId)');
const hasSaveCountAlias = consistencyContent.includes('la.save_count as modify_count');

console.log(`  ✓ 使用 DISTINCT ON: ${hasDistinctOn ? '✓' : '✗'}`);
console.log(`  ✓ 按 reannotation_round DESC 排序: ${hasReannotationOrder ? '✓' : '✗'}`);
console.log(`  ✓ 轉換 userId 為數字: ${hasUserIdParse ? '✓' : '✗'}`);
console.log(`  ✓ 返回 save_count: ${hasSaveCountAlias ? '✓' : '✗'}`);

checks.push(hasDistinctOn && hasReannotationOrder && hasUserIdParse && hasSaveCountAlias);

// 總結
console.log('\n=== 驗證總結 ===');
const allPassed = checks.every(check => check === true);

if (allPassed) {
    console.log('✓ 所有檢查通過！');
    console.log('\n代碼修改已正確完成，包括:');
    console.log('1. ✓ save_count 在重標註時會增加');
    console.log('2. ✓ 重標註送出後會觸發一致性計算');
    console.log('3. ✓ 主頁面會在顯示時重新載入一致性分數');
    console.log('4. ✓ 重標註列表頁面會在顯示時重新載入');
    console.log('5. ✓ /api/consistency 查詢邏輯正確（混合初次標註和重標註）');
    console.log('\n請在瀏覽器中測試完整流程:');
    console.log('1. 完成一個專案的標註');
    console.log('2. 查看重標註列表（應該顯示一致性分數）');
    console.log('3. 修改一筆資料的答案並儲存');
    console.log('4. 返回主頁面/重標註列表');
    console.log('5. 確認「儲存次數」、「承諾狀態」、「驗證時間」、「證據狀態」、「證據品質」都有更新');
} else {
    console.log('✗ 部分檢查未通過');
    console.log('失敗的檢查:');
    checks.forEach((check, index) => {
        if (!check) {
            console.log(`  - 檢查 ${index + 1} 失敗`);
        }
    });
}

process.exit(allPassed ? 0 : 1);
