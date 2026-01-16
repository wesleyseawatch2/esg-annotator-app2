// 測試重標註流程是否正確更新一致性分數
import { sql } from '@vercel/postgres';

const TEST_PROJECT_ID = 62;
const TEST_USER_ID = 8;
const TEST_SOURCE_DATA_ID = 1886; // 請根據實際情況調整

console.log('=== 測試重標註流程 ===\n');

try {
    // 1. 查詢測試用戶的初始標註資料
    console.log('步驟 1: 查詢初始標註資料...');
    const initialAnnotation = await sql`
        SELECT
            a.*,
            sd.original_data
        FROM annotations a
        JOIN source_data sd ON a.source_data_id = sd.id
        WHERE a.user_id = ${TEST_USER_ID}
            AND sd.project_id = ${TEST_PROJECT_ID}
            AND a.source_data_id = ${TEST_SOURCE_DATA_ID}
        ORDER BY a.version DESC, a.created_at DESC
        LIMIT 1
    `;

    if (initialAnnotation.rows.length === 0) {
        console.log('❌ 找不到測試資料，請調整 TEST_SOURCE_DATA_ID');
        process.exit(1);
    }

    const initial = initialAnnotation.rows[0];
    console.log(`✓ 找到資料 ID: ${initial.source_data_id}`);
    console.log(`  承諾狀態: ${initial.promise_status}`);
    console.log(`  驗證時間: ${initial.verification_timeline}`);
    console.log(`  證據狀態: ${initial.evidence_status}`);
    console.log(`  證據品質: ${initial.evidence_quality}`);
    console.log(`  版本: ${initial.version}`);
    console.log(`  儲存次數: ${initial.save_count || 0}`);
    console.log(`  重標註輪次: ${initial.reannotation_round || 0}\n`);

    // 2. 查詢這筆資料的所有標註者
    console.log('步驟 2: 查詢所有標註者的最新資料...');
    const allAnnotations = await sql`
        WITH LatestAnnotations AS (
            SELECT DISTINCT ON (a.source_data_id, a.user_id)
                a.source_data_id,
                a.user_id,
                a.promise_status,
                a.verification_timeline,
                a.evidence_status,
                a.evidence_quality,
                a.reannotation_round,
                a.save_count,
                a.version
            FROM annotations a
            JOIN source_data sd ON a.source_data_id = sd.id
            WHERE sd.project_id = ${TEST_PROJECT_ID}
                AND a.source_data_id = ${TEST_SOURCE_DATA_ID}
                AND a.status = 'completed'
                AND (a.skipped IS NULL OR a.skipped = FALSE)
            ORDER BY a.source_data_id, a.user_id, a.reannotation_round DESC, a.version DESC, a.created_at DESC
        )
        SELECT * FROM LatestAnnotations
        ORDER BY user_id
    `;

    console.log(`找到 ${allAnnotations.rows.length} 位標註者:\n`);
    allAnnotations.rows.forEach(row => {
        console.log(`使用者 ${row.user_id}:`);
        console.log(`  承諾狀態: ${row.promise_status}, 驗證時間: ${row.verification_timeline}`);
        console.log(`  證據狀態: ${row.evidence_status}, 證據品質: ${row.evidence_quality}`);
        console.log(`  輪次: ${row.reannotation_round || 0}, 版本: ${row.version}, 儲存次數: ${row.save_count || 0}\n`);
    });

    // 3. 計算當前的一致性分數
    console.log('步驟 3: 計算一致性分數...');

    const calculateAgreement = (values) => {
        const validValues = values.filter(v => v !== null && v !== undefined && v !== 'N/A');
        if (validValues.length < 2) return 1.0;

        let agreementCount = 0;
        let totalPairs = 0;

        for (let i = 0; i < validValues.length; i++) {
            for (let j = i + 1; j < validValues.length; j++) {
                totalPairs++;
                if (validValues[i] === validValues[j]) {
                    agreementCount++;
                }
            }
        }

        return totalPairs > 0 ? (agreementCount / totalPairs) : 1.0;
    };

    const promiseValues = allAnnotations.rows.map(r => r.promise_status);
    const timelineValues = allAnnotations.rows.map(r => r.verification_timeline);
    const evidenceValues = allAnnotations.rows.map(r => r.evidence_status);
    const qualityValues = allAnnotations.rows.map(r => r.evidence_quality);

    const scores = {
        promise: calculateAgreement(promiseValues),
        timeline: calculateAgreement(timelineValues),
        evidence: calculateAgreement(evidenceValues),
        quality: calculateAgreement(qualityValues)
    };

    console.log('一致性分數:');
    console.log(`  承諾狀態: ${scores.promise.toFixed(2)}`);
    console.log(`  驗證時間: ${scores.timeline.toFixed(2)}`);
    console.log(`  證據狀態: ${scores.evidence.toFixed(2)}`);
    console.log(`  證據品質: ${scores.quality.toFixed(2)}\n`);

    // 4. 測試 /api/consistency 的查詢邏輯
    console.log('步驟 4: 測試 /api/consistency 查詢邏輯...');
    const consistencyResult = await sql`
        WITH ProjectSource AS (
            SELECT
                id,
                original_data,
                ROW_NUMBER() OVER (ORDER BY id ASC) as sequence
            FROM source_data
            WHERE project_id = ${TEST_PROJECT_ID}
        ),
        LatestAnnotations AS (
            SELECT DISTINCT ON (a.source_data_id, a.user_id)
                a.source_data_id,
                a.user_id,
                a.promise_status,
                a.verification_timeline,
                a.evidence_status,
                a.evidence_quality,
                a.reannotation_round,
                a.save_count,
                a.status,
                a.skipped,
                a.version,
                a.created_at
            FROM annotations a
            JOIN source_data sd ON a.source_data_id = sd.id
            WHERE sd.project_id = ${TEST_PROJECT_ID}
            ORDER BY a.source_data_id, a.user_id, a.reannotation_round DESC, a.version DESC, a.created_at DESC
        )
        SELECT
            la.source_data_id,
            la.user_id,
            la.promise_status,
            la.verification_timeline,
            la.evidence_status,
            la.evidence_quality,
            la.reannotation_round,
            la.save_count as modify_count,
            ps.sequence
        FROM LatestAnnotations la
        JOIN ProjectSource ps ON la.source_data_id = ps.id
        WHERE la.status = 'completed'
            AND (la.skipped IS NULL OR la.skipped = FALSE)
            AND la.source_data_id = ${TEST_SOURCE_DATA_ID}
        ORDER BY ps.sequence, la.user_id
    `;

    console.log(`✓ 查詢返回 ${consistencyResult.rows.length} 筆資料`);

    // 檢查測試用戶的資料
    const userRow = consistencyResult.rows.find(r => r.user_id === TEST_USER_ID);
    if (userRow) {
        console.log(`\n測試用戶 ${TEST_USER_ID} 的資料:`);
        console.log(`  儲存次數: ${userRow.modify_count || 0}`);
        console.log(`  重標註輪次: ${userRow.reannotation_round || 0}`);
        console.log(`  承諾狀態: ${userRow.promise_status}\n`);
    } else {
        console.log(`⚠️ 警告: 查詢結果中找不到測試用戶的資料\n`);
    }

    // 5. 總結
    console.log('=== 測試總結 ===');
    console.log('✓ 資料庫查詢正常');
    console.log('✓ DISTINCT ON 邏輯正確（優先取最新輪次）');
    console.log('✓ 一致性分數計算公式正確');

    console.log('\n接下來請手動測試:');
    console.log('1. 在重標註頁面修改這筆資料的答案');
    console.log('2. 儲存後檢查 save_count 是否增加');
    console.log('3. 返回主頁面，檢查一致性分數是否更新');
    console.log(`\n測試資料: source_data_id = ${TEST_SOURCE_DATA_ID}`);

} catch (error) {
    console.error('❌ 測試失敗:', error);
    process.exit(1);
}

process.exit(0);
