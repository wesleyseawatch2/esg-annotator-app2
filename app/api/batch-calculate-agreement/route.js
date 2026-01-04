// 檔案路徑: app/api/batch-calculate-agreement/route.js
import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

/**
 * 批次計算所有專案的一致性分析（智能分析 - 只計算新專案和重標註資料）
 * POST /api/batch-calculate-agreement
 */

// Krippendorff's Alpha 計算函數（與原有 calculate-agreement 相同）
function calculateKrippendorffsAlpha(matrix, valueSet) {
    const n = matrix.length; // 標註者數量
    const m = matrix[0]?.length || 0; // 案例數量

    if (n < 2 || m === 0) {
        return { alpha: null, error: '至少需要 2 位標註者和 1 個案例' };
    }

    // 1. 建立 coincidence matrix
    const coincidenceMatrix = {};
    valueSet.forEach(v1 => {
        coincidenceMatrix[v1] = {};
        valueSet.forEach(v2 => {
            coincidenceMatrix[v1][v2] = 0;
        });
    });

    // 2. 填充 coincidence matrix
    for (let j = 0; j < m; j++) {
        const values = matrix.map(row => row[j]).filter(v => v !== null && v !== undefined);
        const mu = values.length;
        if (mu < 2) continue;

        for (let i = 0; i < values.length; i++) {
            for (let k = 0; k < values.length; k++) {
                if (i !== k) {
                    const v1 = values[i];
                    const v2 = values[k];
                    coincidenceMatrix[v1][v2] += 1 / (mu - 1);
                }
            }
        }
    }

    // 3. 計算 marginal totals
    const nc = {};
    valueSet.forEach(v => {
        nc[v] = valueSet.reduce((sum, v2) => sum + coincidenceMatrix[v][v2], 0);
    });

    const totalObs = Object.values(nc).reduce((a, b) => a + b, 0);
    if (totalObs === 0) return { alpha: null, error: '無有效觀測值' };

    // 4. 計算 observed disagreement (Do)
    let Do = 0;
    valueSet.forEach(v1 => {
        valueSet.forEach(v2 => {
            if (v1 !== v2) {
                Do += coincidenceMatrix[v1][v2];
            }
        });
    });

    // 5. 計算 expected disagreement (De)
    let De = 0;
    valueSet.forEach(v1 => {
        valueSet.forEach(v2 => {
            if (v1 !== v2) {
                De += nc[v1] * nc[v2];
            }
        });
    });
    De = De / (totalObs - 1);

    // 6. 計算 Alpha
    if (De === 0) {
        return { alpha: Do === 0 ? 1.0 : null, error: De === 0 && Do !== 0 ? '期望不一致為零但觀察到不一致' : null };
    }

    const alpha = 1 - (Do / De);
    return { alpha, error: null };
}

// 計算局部 Alpha (local alpha)
function calculateLocalAlpha(annotations, task) {
    if (annotations.length < 2) return null;

    const values = annotations.map(a => a[task]).filter(v => v !== null && v !== undefined && v !== '' && v !== 'N/A');

    if (values.length < 2) return null;

    const uniqueValues = [...new Set(values)];
    if (uniqueValues.length === 1) return 1.0;

    const valueSet = [...new Set(annotations.flatMap(a => {
        const val = a[task];
        return (val && val !== 'N/A') ? [val] : [];
    }))];

    const matrix = annotations.map(a => [a[task] || 'N/A']);
    const result = calculateKrippendorffsAlpha(matrix, [...new Set([...valueSet, 'N/A'])]);

    return result.alpha;
}

export async function POST(request) {
    try {
        const { userId, force = false } = await request.json();

        if (!userId) {
            return NextResponse.json({ success: false, error: '缺少使用者 ID' }, { status: 400 });
        }

        // 1. 取得所有已完成的專案（至少 2 位使用者完成所有標註）
        const completedProjects = await sql`
            WITH latest_annotations AS (
                -- 取得每個使用者對每筆資料的最新標註（只看初次標註，不含重標註）
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
                -- 計算每個使用者在每個專案的完成狀況
                SELECT
                    p.id as project_id,
                    p.name as project_name,
                    p.group_id,
                    la.user_id,
                    (SELECT COUNT(*) FROM source_data WHERE project_id = p.id) as total_tasks,
                    COUNT(la.source_data_id) FILTER (
                        WHERE la.status = 'completed'
                        AND (la.skipped IS NULL OR la.skipped = FALSE)
                    ) as completed_tasks
                FROM projects p
                JOIN latest_annotations la ON la.project_id = p.id
                GROUP BY p.id, p.name, p.group_id, la.user_id
            )
            -- 取得至少 2 位使用者完成所有任務的專案
            SELECT
                p.id,
                p.name,
                p.group_id,
                pg.name as group_name,
                COUNT(DISTINCT upc.user_id) as users_completed,
                MAX(upc.total_tasks) as total_tasks
            FROM projects p
            LEFT JOIN project_groups pg ON p.group_id = pg.id
            LEFT JOIN user_project_completion upc ON p.id = upc.project_id
            WHERE upc.total_tasks > 0
                AND upc.completed_tasks = upc.total_tasks
            GROUP BY p.id, p.name, p.group_id, pg.name
            HAVING COUNT(DISTINCT upc.user_id) >= 2
            ORDER BY pg.name, p.name
        `;

        // 2. 取得所有重標註輪次
        const reannotationRounds = await sql`
            SELECT
                rr.id as round_id,
                rr.project_id,
                rr.round_number,
                rr.task_group,
                p.name as project_name,
                p.group_id,
                pg.name as group_name,
                COUNT(DISTINCT rt.user_id) as users_completed
            FROM reannotation_rounds rr
            JOIN projects p ON rr.project_id = p.id
            LEFT JOIN project_groups pg ON p.group_id = pg.id
            JOIN reannotation_tasks rt ON rt.round_id = rr.id
            WHERE rr.status = 'completed'
                AND rt.status = 'submitted'
            GROUP BY rr.id, rr.project_id, rr.round_number, rr.task_group, p.name, p.group_id, pg.name
            HAVING COUNT(DISTINCT rt.user_id) >= 2
            ORDER BY pg.name, p.name, rr.round_number
        `;

        const results = [];
        let newAnalysisCount = 0;
        let cachedCount = 0;

        // 3. 處理初次標註專案
        for (const project of completedProjects.rows) {
            // 檢查是否已有快取
            if (!force) {
                const cached = await sql`
                    SELECT COUNT(*) as count
                    FROM agreement_scores_cache
                    WHERE project_id = ${project.id}
                        AND round_number = 0
                `;

                if (cached.rows[0].count > 0) {
                    cachedCount++;

                    // 從快取讀取結果
                    const cachedScores = await sql`
                        SELECT
                            source_data_id,
                            task_name,
                            local_score,
                            annotators_count,
                            calculated_at
                        FROM agreement_scores_cache
                        WHERE project_id = ${project.id}
                            AND round_number = 0
                        ORDER BY source_data_id, task_name
                    `;

                    results.push({
                        projectId: project.id,
                        projectName: project.name,
                        groupId: project.group_id,
                        groupName: project.group_name,
                        roundNumber: 0,
                        roundType: 'initial',
                        week: extractWeekNumber(project.name),
                        fromCache: true,
                        calculatedAt: cachedScores.rows[0]?.calculated_at,
                        scores: cachedScores.rows
                    });
                    continue;
                }
            }

            // 計算新的一致性
            newAnalysisCount++;
            const analysisResult = await calculateProjectAgreement(project.id, 0);

            if (analysisResult.success) {
                // 儲存到快取
                await saveToCache(project.id, 0, analysisResult.data);

                results.push({
                    projectId: project.id,
                    projectName: project.name,
                    groupId: project.group_id,
                    groupName: project.group_name,
                    roundNumber: 0,
                    roundType: 'initial',
                    week: extractWeekNumber(project.name),
                    fromCache: false,
                    calculatedAt: new Date(),
                    ...analysisResult.data
                });
            } else {
                console.error(`專案 ${project.name} (ID: ${project.id}) 計算失敗: ${analysisResult.error}`);
            }
        }

        // 4. 處理重標註輪次
        for (const round of reannotationRounds.rows) {
            // 檢查是否已有快取
            if (!force) {
                const cached = await sql`
                    SELECT COUNT(*) as count
                    FROM agreement_scores_cache
                    WHERE project_id = ${round.project_id}
                        AND round_number = ${round.round_number}
                `;

                if (cached.rows[0].count > 0) {
                    cachedCount++;

                    // 從快取讀取結果
                    const cachedScores = await sql`
                        SELECT
                            source_data_id,
                            task_name,
                            local_score,
                            annotators_count,
                            calculated_at
                        FROM agreement_scores_cache
                        WHERE project_id = ${round.project_id}
                            AND round_number = ${round.round_number}
                        ORDER BY source_data_id, task_name
                    `;

                    results.push({
                        projectId: round.project_id,
                        projectName: round.project_name,
                        groupId: round.group_id,
                        groupName: round.group_name,
                        roundNumber: round.round_number,
                        roundType: 'reannotation',
                        taskGroup: round.task_group,
                        week: extractWeekNumber(round.project_name),
                        fromCache: true,
                        calculatedAt: cachedScores.rows[0]?.calculated_at,
                        scores: cachedScores.rows
                    });
                    continue;
                }
            }

            // 計算新的一致性
            newAnalysisCount++;
            const analysisResult = await calculateReannotationAgreement(round.project_id, round.round_number, round.task_group);

            if (analysisResult.success) {
                // 儲存到快取
                await saveToCache(round.project_id, round.round_number, analysisResult.data);

                results.push({
                    projectId: round.project_id,
                    projectName: round.project_name,
                    groupId: round.group_id,
                    groupName: round.group_name,
                    roundNumber: round.round_number,
                    roundType: 'reannotation',
                    taskGroup: round.task_group,
                    week: extractWeekNumber(round.project_name),
                    fromCache: false,
                    calculatedAt: new Date(),
                    ...analysisResult.data
                });
            } else {
                console.error(`重標註 ${round.project_name} 第${round.round_number}輪 ${round.task_group} 計算失敗: ${analysisResult.error}`);
            }
        }

        return NextResponse.json({
            success: true,
            data: {
                results,
                summary: {
                    totalProjects: completedProjects.rows.length,
                    totalReannotations: reannotationRounds.rows.length,
                    newAnalysis: newAnalysisCount,
                    fromCache: cachedCount,
                    totalResults: results.length
                }
            }
        });

    } catch (error) {
        console.error('批次計算一致性失敗:', error);
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
}

// 從專案名稱提取週數
function extractWeekNumber(projectName) {
    const match = projectName.match(/第([一二三四五六七八九十]+)周/);
    if (!match) return 1;

    const chineseNumbers = {
        '一': 1, '二': 2, '三': 3, '四': 4, '五': 5,
        '六': 6, '七': 7, '八': 8, '九': 9, '十': 10
    };

    return chineseNumbers[match[1]] || 1;
}

// 計算專案一致性（初次標註）
async function calculateProjectAgreement(projectId, roundNumber = 0) {
    try {
        const tasks = ['promise_status', 'verification_timeline', 'evidence_status', 'evidence_quality'];

        // 取得所有已完成的標註（使用最新版本）
        const annotations = await sql`
            SELECT
                latest.source_data_id,
                latest.user_id,
                latest.promise_status,
                latest.verification_timeline,
                latest.evidence_status,
                latest.evidence_quality,
                sd.original_data
            FROM (
                SELECT DISTINCT ON (a.source_data_id, a.user_id)
                    a.source_data_id,
                    a.user_id,
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
                WHERE sd.project_id = ${projectId}
                    AND a.reannotation_round = ${roundNumber}
                ORDER BY a.source_data_id, a.user_id, a.version DESC, a.created_at DESC
            ) latest
            JOIN source_data sd ON latest.source_data_id = sd.id
            WHERE latest.status = 'completed'
                AND (latest.skipped IS NULL OR latest.skipped = FALSE)
            ORDER BY latest.source_data_id, latest.user_id
        `;

        if (annotations.rows.length === 0) {
            return { success: false, error: '無標註資料' };
        }

        // 組織資料
        const dataBySourceId = {};
        annotations.rows.forEach(row => {
            if (!dataBySourceId[row.source_data_id]) {
                dataBySourceId[row.source_data_id] = {
                    source_data_id: row.source_data_id,
                    original_data: row.original_data,
                    annotations: []
                };
            }
            dataBySourceId[row.source_data_id].annotations.push(row);
        });

        const detailedResults = [];
        const globalScores = {};

        tasks.forEach(task => {
            globalScores[task] = [];
        });

        // 計算每個資料項的局部分數
        Object.values(dataBySourceId).forEach(item => {
            const result = {
                source_data_id: item.source_data_id,
                original_data: item.original_data,
                scores: {},
                annotators: item.annotations.map(a => ({
                    user_id: a.user_id,
                    promise_status: a.promise_status,
                    verification_timeline: a.verification_timeline,
                    evidence_status: a.evidence_status,
                    evidence_quality: a.evidence_quality
                }))
            };

            tasks.forEach(task => {
                const localAlpha = calculateLocalAlpha(item.annotations, task);
                result.scores[task] = localAlpha;
                if (localAlpha !== null) {
                    globalScores[task].push(localAlpha);
                }
            });

            detailedResults.push(result);
        });

        // 計算全域分數
        const globalResults = tasks.map(task => ({
            task,
            globalAlpha: globalScores[task].length > 0
                ? globalScores[task].reduce((a, b) => a + b, 0) / globalScores[task].length
                : null,
            count: globalScores[task].length
        }));

        return {
            success: true,
            data: {
                globalResults,
                detailedResults,
                annotatorCount: [...new Set(annotations.rows.map(r => r.user_id))].length
            }
        };

    } catch (error) {
        console.error('計算專案一致性失敗:', error);
        return { success: false, error: error.message };
    }
}

// 計算重標註一致性
async function calculateReannotationAgreement(projectId, roundNumber, taskGroup) {
    try {
        // 取得該輪次的重標註資料（使用最新版本）
        const annotations = await sql`
            SELECT
                latest.source_data_id,
                latest.user_id,
                latest.promise_status,
                latest.verification_timeline,
                latest.evidence_status,
                latest.evidence_quality,
                sd.original_data
            FROM (
                SELECT DISTINCT ON (a.source_data_id, a.user_id)
                    a.source_data_id,
                    a.user_id,
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
                WHERE sd.project_id = ${projectId}
                    AND a.reannotation_round = ${roundNumber}
                ORDER BY a.source_data_id, a.user_id, a.version DESC, a.created_at DESC
            ) latest
            JOIN source_data sd ON latest.source_data_id = sd.id
            WHERE latest.status = 'completed'
                AND (latest.skipped IS NULL OR latest.skipped = FALSE)
            ORDER BY latest.source_data_id, latest.user_id
        `;

        if (annotations.rows.length === 0) {
            return { success: false, error: '無重標註資料' };
        }

        // 根據 task_group 決定要計算哪些任務
        const tasks = taskGroup === 'group1'
            ? ['promise_status', 'verification_timeline']
            : ['evidence_status', 'evidence_quality'];

        // 組織資料（與初次標註相同邏輯）
        const dataBySourceId = {};
        annotations.rows.forEach(row => {
            if (!dataBySourceId[row.source_data_id]) {
                dataBySourceId[row.source_data_id] = {
                    source_data_id: row.source_data_id,
                    original_data: row.original_data,
                    annotations: []
                };
            }
            dataBySourceId[row.source_data_id].annotations.push(row);
        });

        const detailedResults = [];
        const globalScores = {};

        tasks.forEach(task => {
            globalScores[task] = [];
        });

        // 計算局部分數
        Object.values(dataBySourceId).forEach(item => {
            const result = {
                source_data_id: item.source_data_id,
                original_data: item.original_data,
                scores: {},
                annotators: item.annotations.map(a => ({
                    user_id: a.user_id,
                    promise_status: a.promise_status,
                    verification_timeline: a.verification_timeline,
                    evidence_status: a.evidence_status,
                    evidence_quality: a.evidence_quality
                }))
            };

            tasks.forEach(task => {
                const localAlpha = calculateLocalAlpha(item.annotations, task);
                result.scores[task] = localAlpha;
                if (localAlpha !== null) {
                    globalScores[task].push(localAlpha);
                }
            });

            detailedResults.push(result);
        });

        // 計算全域分數
        const globalResults = tasks.map(task => ({
            task,
            globalAlpha: globalScores[task].length > 0
                ? globalScores[task].reduce((a, b) => a + b, 0) / globalScores[task].length
                : null,
            count: globalScores[task].length
        }));

        return {
            success: true,
            data: {
                globalResults,
                detailedResults,
                annotatorCount: [...new Set(annotations.rows.map(r => r.user_id))].length,
                taskGroup
            }
        };

    } catch (error) {
        console.error('計算重標註一致性失敗:', error);
        return { success: false, error: error.message };
    }
}

// 儲存到快取表
async function saveToCache(projectId, roundNumber, data) {
    try {
        // 刪除舊的快取
        await sql`
            DELETE FROM agreement_scores_cache
            WHERE project_id = ${projectId} AND round_number = ${roundNumber}
        `;

        // 插入新的快取
        for (const item of data.detailedResults) {
            for (const [taskName, localScore] of Object.entries(item.scores)) {
                if (localScore !== null) {
                    await sql`
                        INSERT INTO agreement_scores_cache (
                            project_id, source_data_id, round_number, task_name,
                            local_score, annotators_count, calculated_at
                        ) VALUES (
                            ${projectId}, ${item.source_data_id}, ${roundNumber}, ${taskName},
                            ${localScore}, ${data.annotatorCount}, NOW()
                        )
                        ON CONFLICT (project_id, source_data_id, round_number, task_name)
                        DO UPDATE SET
                            local_score = ${localScore},
                            annotators_count = ${data.annotatorCount},
                            calculated_at = NOW()
                    `;
                }
            }
        }

        return true;
    } catch (error) {
        console.error('儲存快取失敗:', error);
        return false;
    }
}
