// 驗證一致性計算邏輯
// 檢查是否正確混合初次標註和重標註資料

import { sql } from '@vercel/postgres';

async function verifyConsistencyLogic() {
    try {
        console.log('=== 驗證一致性計算邏輯 ===\n');

        // 1. 找一個有完成標註的專案
        const projects = await sql`
            WITH latest_annotations AS (
                SELECT DISTINCT ON (a.source_data_id, a.user_id)
                    a.source_data_id,
                    a.user_id,
                    a.status,
                    a.skipped,
                    sd.project_id
                FROM annotations a
                JOIN source_data sd ON a.source_data_id = sd.id
                WHERE a.reannotation_round = 0
                ORDER BY a.source_data_id, a.user_id, a.version DESC, a.created_at DESC
            ),
            user_project_completion AS (
                SELECT
                    p.id as project_id,
                    p.name as project_name,
                    la.user_id,
                    (SELECT COUNT(*) FROM source_data WHERE project_id = p.id) as total_tasks,
                    COUNT(la.source_data_id) FILTER (
                        WHERE la.status = 'completed'
                        AND (la.skipped IS NULL OR la.skipped = FALSE)
                    ) as completed_tasks
                FROM projects p
                JOIN latest_annotations la ON la.project_id = p.id
                GROUP BY p.id, p.name, la.user_id
            )
            SELECT
                p.id,
                p.name,
                COUNT(DISTINCT upc.user_id) as users_completed
            FROM projects p
            LEFT JOIN user_project_completion upc ON p.id = upc.project_id
            WHERE upc.total_tasks > 0
                AND upc.completed_tasks = upc.total_tasks
            GROUP BY p.id, p.name
            HAVING COUNT(DISTINCT upc.user_id) >= 2
            LIMIT 1
        `;

        if (projects.rows.length === 0) {
            console.log('❌ 找不到已完成的專案');
            return;
        }

        const project = projects.rows[0];
        console.log(`📊 測試專案: ${project.name} (ID: ${project.id})`);
        console.log(`   完成人數: ${project.users_completed} 人\n`);

        // 2. 檢查是否有重標註資料
        const reannotations = await sql`
            SELECT DISTINCT
                a.source_data_id,
                a.user_id,
                a.reannotation_round,
                a.promise_status,
                sd.original_data
            FROM annotations a
            JOIN source_data sd ON a.source_data_id = sd.id
            WHERE sd.project_id = ${project.id}
                AND a.reannotation_round > 0
                AND a.status = 'completed'
            ORDER BY a.source_data_id, a.user_id, a.reannotation_round
            LIMIT 5
        `;

        if (reannotations.rows.length > 0) {
            console.log('✅ 發現重標註資料:');
            reannotations.rows.forEach(r => {
                console.log(`   - source_data_id: ${r.source_data_id}, user_id: ${r.user_id}, round: ${r.reannotation_round}`);
            });
            console.log('');
        } else {
            console.log('ℹ️  此專案沒有重標註資料\n');
        }

        // 3. 測試新的邏輯：取得混合資料（優先重標註，否則初次標註）
        console.log('=== 測試新邏輯：自動混合最新資料 ===\n');

        const mixedData = await sql`
            SELECT
                latest.source_data_id,
                latest.user_id,
                latest.reannotation_round,
                latest.promise_status,
                latest.verification_timeline,
                sd.original_data
            FROM (
                SELECT DISTINCT ON (a.source_data_id, a.user_id)
                    a.source_data_id,
                    a.user_id,
                    a.reannotation_round,
                    a.promise_status,
                    a.verification_timeline,
                    a.evidence_status,
                    a.evidence_quality,
                    a.status,
                    a.skipped,
                    a.version,
                    a.created_at
                FROM annotations a
                JOIN source_data sd ON a.source_data_id = sd.id
                WHERE sd.project_id = ${project.id}
                ORDER BY a.source_data_id, a.user_id, a.reannotation_round DESC, a.version DESC, a.created_at DESC
            ) latest
            JOIN source_data sd ON latest.source_data_id = sd.id
            WHERE latest.status = 'completed'
                AND (latest.skipped IS NULL OR latest.skipped = FALSE)
            ORDER BY latest.source_data_id, latest.user_id
            LIMIT 10
        `;

        console.log(`取得 ${mixedData.rows.length} 筆混合資料:\n`);

        // 統計每個 source_data_id 的標註情況
        const sourceDataMap = new Map();
        mixedData.rows.forEach(row => {
            if (!sourceDataMap.has(row.source_data_id)) {
                sourceDataMap.set(row.source_data_id, []);
            }
            sourceDataMap.get(row.source_data_id).push({
                user_id: row.user_id,
                round: row.reannotation_round,
                promise_status: row.promise_status
            });
        });

        sourceDataMap.forEach((users, sourceDataId) => {
            const hasReannotation = users.some(u => u.round > 0);
            console.log(`📝 Source Data ID: ${sourceDataId}`);
            users.forEach(u => {
                const marker = u.round > 0 ? '🔄' : '📋';
                console.log(`   ${marker} User ${u.user_id}: round=${u.round}, promise=${u.promise_status}`);
            });
            if (hasReannotation) {
                console.log('   ✅ 包含重標註資料 - 系統會自動使用最新版本');
            }
            console.log('');
        });

        // 4. 比較舊邏輯（只取 round=0）
        console.log('=== 舊邏輯：只取初次標註 (round=0) ===\n');

        const oldData = await sql`
            SELECT
                latest.source_data_id,
                latest.user_id,
                latest.reannotation_round,
                latest.promise_status
            FROM (
                SELECT DISTINCT ON (a.source_data_id, a.user_id)
                    a.source_data_id,
                    a.user_id,
                    a.reannotation_round,
                    a.promise_status,
                    a.status,
                    a.skipped,
                    a.version,
                    a.created_at
                FROM annotations a
                JOIN source_data sd ON a.source_data_id = sd.id
                WHERE sd.project_id = ${project.id}
                    AND a.reannotation_round = 0
                ORDER BY a.source_data_id, a.user_id, a.version DESC, a.created_at DESC
            ) latest
            WHERE latest.status = 'completed'
                AND (latest.skipped IS NULL OR latest.skipped = FALSE)
            ORDER BY latest.source_data_id, latest.user_id
            LIMIT 10
        `;

        console.log(`只取得 ${oldData.rows.length} 筆初次標註資料`);
        console.log('❌ 舊邏輯會忽略所有重標註資料！\n');

        // 5. 總結
        console.log('=== 總結 ===\n');
        console.log('✅ 新邏輯（已修改）:');
        console.log('   - 優先使用重標註資料（如果存在）');
        console.log('   - 否則使用初次標註資料');
        console.log('   - 實現混合計算：A 重標 + B、C 初次標註\n');

        console.log('❌ 舊邏輯（修改前）:');
        console.log('   - 只使用初次標註資料');
        console.log('   - 忽略所有重標註資料');
        console.log('   - 無法反映最新的標註結果\n');

    } catch (error) {
        console.error('驗證失敗:', error);
    } finally {
        process.exit(0);
    }
}

verifyConsistencyLogic();
