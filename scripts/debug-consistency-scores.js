// Debug script to check consistency scores in database
import { sql } from '@vercel/postgres';

async function debugConsistencyScores() {
    try {
        console.log('=== 檢查一致性分數快取 ===\n');

        // 1. 檢查有多少筆快取資料
        const cacheCount = await sql`
            SELECT
                COUNT(*) as total_count,
                COUNT(DISTINCT project_id) as project_count,
                COUNT(DISTINCT round_number) as round_count
            FROM agreement_scores_cache
        `;
        console.log('快取統計:', cacheCount.rows[0]);

        // 2. 檢查分數分布
        const scoreDistribution = await sql`
            SELECT
                task_name,
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE local_score = 1.0) as perfect_scores,
                COUNT(*) FILTER (WHERE local_score >= 0.8 AND local_score < 1.0) as high_scores,
                COUNT(*) FILTER (WHERE local_score >= 0.5 AND local_score < 0.8) as medium_scores,
                COUNT(*) FILTER (WHERE local_score < 0.5 AND local_score >= 0) as low_scores,
                COUNT(*) FILTER (WHERE local_score < 0) as negative_scores,
                COUNT(*) FILTER (WHERE local_score IS NULL) as null_scores,
                AVG(local_score) as avg_score,
                MIN(local_score) as min_score,
                MAX(local_score) as max_score
            FROM agreement_scores_cache
            WHERE round_number = 0
            GROUP BY task_name
            ORDER BY task_name
        `;

        console.log('\n=== 初次標註分數分布 ===');
        scoreDistribution.rows.forEach(row => {
            console.log(`\n${row.task_name}:`);
            console.log(`  總數: ${row.total}`);
            console.log(`  1.0 (完美): ${row.perfect_scores} (${(row.perfect_scores/row.total*100).toFixed(1)}%)`);
            console.log(`  0.8-1.0 (高): ${row.high_scores} (${(row.high_scores/row.total*100).toFixed(1)}%)`);
            console.log(`  0.5-0.8 (中): ${row.medium_scores} (${(row.medium_scores/row.total*100).toFixed(1)}%)`);
            console.log(`  0-0.5 (低): ${row.low_scores} (${(row.low_scores/row.total*100).toFixed(1)}%)`);
            console.log(`  負數: ${row.negative_scores} (${(row.negative_scores/row.total*100).toFixed(1)}%)`);
            console.log(`  NULL: ${row.null_scores}`);
            console.log(`  平均: ${row.avg_score !== null ? Number(row.avg_score).toFixed(3) : 'N/A'}`);
            console.log(`  範圍: ${row.min_score} ~ ${row.max_score}`);
        });

        // 3. 抽查幾筆分數為 1.0 的資料，看看標註者是否真的一致
        console.log('\n=== 抽查分數 1.0 的案例（檢查是否真的一致）===');
        const perfectScoreSamples = await sql`
            SELECT
                asc.source_data_id,
                asc.task_name,
                asc.local_score,
                STRING_AGG(DISTINCT
                    CASE asc.task_name
                        WHEN 'promise_status' THEN a.promise_status
                        WHEN 'verification_timeline' THEN a.verification_timeline
                        WHEN 'evidence_status' THEN a.evidence_status
                        WHEN 'evidence_quality' THEN a.evidence_quality
                    END,
                    ' | ' ORDER BY
                    CASE asc.task_name
                        WHEN 'promise_status' THEN a.promise_status
                        WHEN 'verification_timeline' THEN a.verification_timeline
                        WHEN 'evidence_status' THEN a.evidence_status
                        WHEN 'evidence_quality' THEN a.evidence_quality
                    END
                ) as unique_values,
                COUNT(DISTINCT a.user_id) as annotator_count
            FROM agreement_scores_cache asc
            JOIN annotations a ON asc.source_data_id = a.source_data_id
            WHERE asc.local_score = 1.0
                AND asc.round_number = 0
                AND asc.task_name = 'promise_status'
                AND a.reannotation_round = 0
                AND a.status = 'completed'
            GROUP BY asc.source_data_id, asc.task_name, asc.local_score
            LIMIT 5
        `;

        perfectScoreSamples.rows.forEach((row, idx) => {
            console.log(`\n案例 ${idx+1}:`);
            console.log(`  Source ID: ${row.source_data_id}`);
            console.log(`  Task: ${row.task_name}`);
            console.log(`  Score: ${row.local_score}`);
            console.log(`  標註者數: ${row.annotator_count}`);
            console.log(`  唯一值: ${row.unique_values}`);
            console.log(`  ✓ 一致? ${row.unique_values.includes('|') ? 'NO ❌' : 'YES ✅'}`);
        });

        // 4. 抽查幾筆分數 < 1.0 的資料，看看標註者答案
        console.log('\n=== 抽查分數 < 1.0 的案例（應該有不同答案）===');
        const imperfectScoreSamples = await sql`
            SELECT
                asc.source_data_id,
                asc.task_name,
                asc.local_score,
                STRING_AGG(DISTINCT
                    CASE asc.task_name
                        WHEN 'promise_status' THEN a.promise_status
                        WHEN 'verification_timeline' THEN a.verification_timeline
                        WHEN 'evidence_status' THEN a.evidence_status
                        WHEN 'evidence_quality' THEN a.evidence_quality
                    END,
                    ' | ' ORDER BY
                    CASE asc.task_name
                        WHEN 'promise_status' THEN a.promise_status
                        WHEN 'verification_timeline' THEN a.verification_timeline
                        WHEN 'evidence_status' THEN a.evidence_status
                        WHEN 'evidence_quality' THEN a.evidence_quality
                    END
                ) as unique_values,
                COUNT(DISTINCT a.user_id) as annotator_count
            FROM agreement_scores_cache asc
            JOIN annotations a ON asc.source_data_id = a.source_data_id
            WHERE asc.local_score < 1.0 AND asc.local_score >= 0
                AND asc.round_number = 0
                AND asc.task_name = 'promise_status'
                AND a.reannotation_round = 0
                AND a.status = 'completed'
            GROUP BY asc.source_data_id, asc.task_name, asc.local_score
            LIMIT 5
        `;

        if (imperfectScoreSamples.rows.length === 0) {
            console.log('  沒有找到分數 < 1.0 的案例！這就是問題所在！');
        } else {
            imperfectScoreSamples.rows.forEach((row, idx) => {
                console.log(`\n案例 ${idx+1}:`);
                console.log(`  Source ID: ${row.source_data_id}`);
                console.log(`  Task: ${row.task_name}`);
                console.log(`  Score: ${row.local_score}`);
                console.log(`  標註者數: ${row.annotator_count}`);
                console.log(`  唯一值: ${row.unique_values}`);
                console.log(`  ✓ 有差異? ${row.unique_values.includes('|') ? 'YES ✅' : 'NO ❌'}`);
            });
        }

        // 5. 檢查原始標註資料中是否真的有不一致的情況
        console.log('\n=== 檢查原始資料中的不一致案例 ===');
        const rawInconsistency = await sql`
            WITH annotation_data AS (
                SELECT DISTINCT ON (a.source_data_id, a.user_id)
                    a.source_data_id,
                    a.user_id,
                    a.promise_status,
                    a.status,
                    a.skipped
                FROM annotations a
                JOIN source_data sd ON a.source_data_id = sd.id
                JOIN projects p ON sd.project_id = p.id
                WHERE a.reannotation_round = 0
                    AND p.name LIKE '%第二%'
                ORDER BY a.source_data_id, a.user_id, a.version DESC, a.created_at DESC
            )
            SELECT
                source_data_id,
                COUNT(DISTINCT user_id) as annotator_count,
                COUNT(DISTINCT promise_status) as unique_promise_count,
                STRING_AGG(DISTINCT promise_status, ' | ' ORDER BY promise_status) as promise_values
            FROM annotation_data
            WHERE status = 'completed' AND (skipped IS NULL OR skipped = FALSE)
            GROUP BY source_data_id
            HAVING COUNT(DISTINCT user_id) >= 3
                AND COUNT(DISTINCT promise_status) > 1
            LIMIT 5
        `;

        if (rawInconsistency.rows.length === 0) {
            console.log('  沒有找到不一致的原始資料！標註者可能真的都很一致。');
        } else {
            rawInconsistency.rows.forEach((row, idx) => {
                console.log(`\n原始案例 ${idx+1}:`);
                console.log(`  Source ID: ${row.source_data_id}`);
                console.log(`  標註者數: ${row.annotator_count}`);
                console.log(`  不同答案數: ${row.unique_promise_count}`);
                console.log(`  答案: ${row.promise_values}`);
            });
        }

    } catch (error) {
        console.error('執行失敗:', error);
    } finally {
        process.exit(0);
    }
}

debugConsistencyScores();
