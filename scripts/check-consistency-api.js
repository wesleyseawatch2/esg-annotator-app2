// Check consistency API data
import { sql } from '@vercel/postgres';

async function checkConsistencyAPI() {
    try {
        // 假設你的專案 ID（請替換為實際的專案 ID）
        const projectId = 42; // 請替換為你看到的專案 ID
        const userId = 'cathay_2882'; // 請替換為你的 user_id

        console.log('=== 檢查一致性 API 的資料 ===\n');
        console.log(`專案 ID: ${projectId}`);
        console.log(`使用者 ID: ${userId}\n`);

        // 執行與 API 相同的查詢
        const result = await sql`
            WITH ProjectSource AS (
                SELECT
                    id,
                    original_data,
                    ROW_NUMBER() OVER (ORDER BY id ASC) as sequence
                FROM source_data
                WHERE project_id = ${projectId}
            ),
            LatestAnnotations AS (
                -- 取得每個使用者對每筆資料的最新標註（包含初次標註和重標註）
                -- 優先使用最新輪次的標註
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
                WHERE sd.project_id = ${projectId}
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
                ps.sequence,
                ps.original_data
            FROM LatestAnnotations la
            JOIN ProjectSource ps ON la.source_data_id = ps.id
            WHERE la.status = 'completed'
                AND (la.skipped IS NULL OR la.skipped = FALSE)
            ORDER BY ps.sequence, la.user_id
            LIMIT 30
        `;

        console.log(`查詢結果：共 ${result.rows.length} 筆標註資料\n`);

        // 統計資料
        const userCounts = {};
        const roundCounts = { 0: 0 };

        result.rows.forEach(row => {
            userCounts[row.user_id] = (userCounts[row.user_id] || 0) + 1;
            roundCounts[row.reannotation_round] = (roundCounts[row.reannotation_round] || 0) + 1;
        });

        console.log('=== 使用者統計 ===');
        Object.entries(userCounts).forEach(([user, count]) => {
            console.log(`  ${user}: ${count} 筆`);
        });

        console.log('\n=== 輪次統計 ===');
        Object.entries(roundCounts).forEach(([round, count]) => {
            console.log(`  第 ${round} 輪: ${count} 筆`);
        });

        // 檢查前 5 筆資料的詳細情況
        console.log('\n=== 前 5 筆資料詳情 ===');
        const sourceIds = [...new Set(result.rows.map(r => r.source_data_id))].slice(0, 5);

        for (const sourceId of sourceIds) {
            const annotations = result.rows.filter(r => r.source_data_id === sourceId);
            console.log(`\n資料 ID: ${sourceId} (序號: ${annotations[0].sequence})`);
            console.log(`  文本: ${annotations[0].original_data?.substring(0, 50)}...`);
            console.log(`  標註者數量: ${annotations.length}`);

            annotations.forEach(ann => {
                console.log(`  - ${ann.user_id} (輪次: ${ann.reannotation_round}, 儲存次數: ${ann.modify_count})`);
                console.log(`    承諾狀態: ${ann.promise_status}`);
                console.log(`    驗證時間: ${ann.verification_timeline}`);
                console.log(`    證據狀態: ${ann.evidence_status}`);
                console.log(`    證據品質: ${ann.evidence_quality}`);
            });

            // 計算一致性
            const promiseValues = annotations.map(a => a.promise_status).filter(v => v);
            const uniquePromise = new Set(promiseValues);
            console.log(`  承諾狀態一致性: ${uniquePromise.size === 1 ? '完全一致 ✅' : `有 ${uniquePromise.size} 種不同答案 ⚠️`}`);
        }

        // 檢查當前使用者的資料
        console.log('\n=== 當前使用者資料 ===');
        const userAnnotations = result.rows.filter(r => r.user_id === userId);
        console.log(`當前使用者 (${userId}) 標註了 ${userAnnotations.length} 筆資料`);

        if (userAnnotations.length > 0) {
            const withReannotation = userAnnotations.filter(r => r.reannotation_round > 0);
            console.log(`其中有重標註的: ${withReannotation.length} 筆`);

            if (withReannotation.length > 0) {
                console.log('\n重標註的資料 ID:');
                withReannotation.forEach(r => {
                    console.log(`  - 資料 ${r.source_data_id} (序號: ${r.sequence}, 輪次: ${r.reannotation_round}, 儲存次數: ${r.modify_count})`);
                });
            }
        }

    } catch (error) {
        console.error('執行失敗:', error);
    } finally {
        process.exit(0);
    }
}

checkConsistencyAPI();
