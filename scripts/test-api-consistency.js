import { sql } from '@vercel/postgres';
import { calculateNominalAlpha } from '../lib/krippendorff.js';

const projectId = 62;
const userId = '8'; // 假設你是 user 8

console.log('=== 模擬 /api/consistency 的查詢 ===\n');

const result = await sql`
    WITH ProjectSource AS (
        SELECT id, original_data,
            ROW_NUMBER() OVER (ORDER BY id ASC) as sequence
        FROM source_data
        WHERE project_id = ${projectId}
    ),
    LatestAnnotations AS (
        SELECT DISTINCT ON (a.source_data_id, a.user_id)
            a.source_data_id, a.user_id, a.promise_status,
            a.verification_timeline, a.evidence_status, a.evidence_quality,
            a.reannotation_round, a.save_count, a.status, a.skipped
        FROM annotations a
        JOIN source_data sd ON a.source_data_id = sd.id
        WHERE sd.project_id = ${projectId}
        ORDER BY a.source_data_id, a.user_id, a.reannotation_round DESC, a.version DESC, a.created_at DESC
    )
    SELECT la.source_data_id, la.user_id, la.promise_status,
        la.reannotation_round, la.save_count as modify_count, ps.sequence
    FROM LatestAnnotations la
    JOIN ProjectSource ps ON la.source_data_id = ps.id
    WHERE la.status = 'completed' AND (la.skipped IS NULL OR la.skipped = FALSE)
    ORDER BY ps.sequence, la.user_id
    LIMIT 20
`;

console.log(`查詢結果: ${result.rows.length} 筆\n`);

// 檢查前3筆資料
const sources = [...new Set(result.rows.map(r => r.source_data_id))].slice(0, 3);

sources.forEach(sid => {
    const anns = result.rows.filter(r => r.source_data_id === sid);
    console.log(`資料 ${sid}:`);
    anns.forEach(a => {
        console.log(`  ${a.user_id} (輪次${a.reannotation_round}): ${a.promise_status}`);
    });

    // 計算一致性
    const inputData = anns.map(a => ({
        unitId: a.source_data_id,
        coderId: a.user_id,
        value: a.promise_status
    }));

    const { unitScores } = calculateNominalAlpha(inputData);
    const score = unitScores[sid];
    console.log(`  一致性分數: ${score.toFixed(2)}\n`);
});

// 檢查 user 8 的資料
const userAnns = result.rows.filter(r => r.user_id === userId);
console.log(`使用者 ${userId} 標註了 ${userAnns.length} 筆`);
console.log(`其中有重標註的: ${userAnns.filter(r => r.reannotation_round > 0).length} 筆`);

process.exit(0);
