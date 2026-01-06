// 檔案路徑: app/api/batch-calculate-agreement/route.js
import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

/**
 * 批次計算所有專案的一致性分析（智能分析 - 只計算新專案和重標註資料）
 * POST /api/batch-calculate-agreement
 */

/**
 * 計算 Krippendorff's Alpha (Nominal level)
 * 使用與 calculate-agreement 相同的完整演算法
 * @param {Array<Array<any>>} data - 資料矩陣 (rows=raters, cols=items)
 * @returns {number} - Alpha 值
 */
function calculateKrippendorffsAlpha(data) {
    const matrix = data;
    const nRaters = matrix.length;
    const nItems = matrix[0] ? matrix[0].length : 0;

    if (nRaters === 0 || nItems === 0) return NaN;

    // 收集所有唯一值並建立映射
    const allValues = new Set();
    matrix.forEach(row => row.forEach(val => {
        if (val !== null && val !== undefined) {
            allValues.add(val);
        }
    }));

    const values = Array.from(allValues).sort();
    const valueToIndex = new Map();
    values.forEach((val, idx) => valueToIndex.set(val, idx));

    const nValues = values.length;
    if (nValues === 0) return NaN;

    // 建立 coincidence matrix
    const coincidenceMatrix = Array(nValues).fill(0).map(() => Array(nValues).fill(0));

    // 對每個 item (column) 計算 pairwise comparisons
    for (let item = 0; item < nItems; item++) {
        const itemValues = [];
        for (let rater = 0; rater < nRaters; rater++) {
            const val = matrix[rater][item];
            if (val !== null && val !== undefined) {
                itemValues.push(val);
            }
        }

        const m = itemValues.length;
        if (m < 2) continue;

        // 對每一對評分者進行比較
        for (let i = 0; i < m; i++) {
            for (let j = 0; j < m; j++) {
                if (i !== j) {
                    const vi = valueToIndex.get(itemValues[i]);
                    const vj = valueToIndex.get(itemValues[j]);
                    coincidenceMatrix[vi][vj] += 1 / (m - 1);
                }
            }
        }
    }

    // 計算 marginal totals (nc)
    const nc = Array(nValues).fill(0);
    for (let c = 0; c < nValues; c++) {
        for (let k = 0; k < nValues; k++) {
            nc[c] += coincidenceMatrix[c][k];
        }
    }

    const n = nc.reduce((sum, val) => sum + val, 0);
    if (n === 0) return NaN;

    // 計算 observed disagreement (Do)
    let Do = 0;
    for (let c = 0; c < nValues; c++) {
        for (let k = 0; k < nValues; k++) {
            if (c !== k) {
                Do += coincidenceMatrix[c][k];
            }
        }
    }

    // 計算 expected disagreement (De)
    let De = 0;
    for (let c = 0; c < nValues; c++) {
        for (let k = 0; k < nValues; k++) {
            if (c !== k) {
                De += nc[c] * nc[k];
            }
        }
    }

    if (n <= 1) {
        De = 0;
    } else {
        De = De / (n - 1);
    }

    if (De === 0) {
        return Do === 0 ? 1.0 : 0.0;
    }

    const alpha = 1 - (Do / De);
    return alpha;
}

/**
 * 計算 Local Alpha (單題爭議程度)
 * 使用與 calculate-agreement 相同的演算法
 * @param {Array} itemData - 單一題目的所有評分者答案 (包含 'N/A')
 * @param {Array<Array>} allData - 完整的資料矩陣 (包含 'N/A'),用於計算 De
 * @returns {number} - Local Alpha 分數
 */
function calculateLocalAlpha(itemData, allData) {
    const values = itemData;
    const m = values.length;

    if (m < 2) return NaN;

    // 計算整體資料的唯一值 (包括 'N/A')
    const allValuesSet = new Set();
    allData.forEach(row => {
        row.forEach(val => {
            allValuesSet.add(val);
        });
    });

    const uniqueVals = Array.from(allValuesSet);

    // 計算整體的 De (expected disagreement)
    const flattened = [];
    allData.forEach(row => {
        row.forEach(val => {
            flattened.push(val);
        });
    });

    const nTotal = flattened.length;
    if (nTotal === 0) return NaN;

    const counts = {};
    uniqueVals.forEach(v => {
        counts[v] = flattened.filter(val => val === v).length;
    });

    let sumNcSq = 0;
    for (const val of uniqueVals) {
        sumNcSq += (counts[val] || 0) ** 2;
    }

    let De;
    if (nTotal <= 1) {
        De = 0;
    } else {
        De = (nTotal ** 2 - sumNcSq) / (nTotal * (nTotal - 1));
    }

    // 計算此題目的 Du (observed disagreement)
    const uCounts = {};
    uniqueVals.forEach(v => {
        uCounts[v] = values.filter(val => val === v).length;
    });

    let sumNuSq = 0;
    for (const val of uniqueVals) {
        sumNuSq += (uCounts[val] || 0) ** 2;
    }

    const Du = (m ** 2 - sumNuSq) / (m * (m - 1));

    // 計算 Local Alpha
    if (De === 0) {
        return Du === 0 ? 1.0 : 0.0;
    }

    const score = 1 - (Du / De);
    return score;
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

        // 2. 取得所有重標註輪次（分別統計 group1 和 group2）
        const reannotationRounds = await sql`
            WITH round_groups AS (
                SELECT
                    p.id as project_id,
                    p.name as project_name,
                    p.group_id,
                    pg.name as group_name,
                    a.reannotation_round as round_number,
                    'group1' as task_group,
                    COUNT(DISTINCT CASE
                        WHEN a.promise_status IS NOT NULL OR a.verification_timeline IS NOT NULL
                        THEN a.user_id
                    END) as users_completed
                FROM annotations a
                JOIN source_data sd ON a.source_data_id = sd.id
                JOIN projects p ON sd.project_id = p.id
                LEFT JOIN project_groups pg ON p.group_id = pg.id
                WHERE a.reannotation_round > 0
                    AND a.status = 'completed'
                    AND (a.skipped IS NULL OR a.skipped = FALSE)
                GROUP BY p.id, p.name, p.group_id, pg.name, a.reannotation_round
                HAVING COUNT(DISTINCT CASE
                    WHEN a.promise_status IS NOT NULL OR a.verification_timeline IS NOT NULL
                    THEN a.user_id
                END) >= 3

                UNION ALL

                SELECT
                    p.id as project_id,
                    p.name as project_name,
                    p.group_id,
                    pg.name as group_name,
                    a.reannotation_round as round_number,
                    'group2' as task_group,
                    COUNT(DISTINCT CASE
                        WHEN a.evidence_status IS NOT NULL OR a.evidence_quality IS NOT NULL
                        THEN a.user_id
                    END) as users_completed
                FROM annotations a
                JOIN source_data sd ON a.source_data_id = sd.id
                JOIN projects p ON sd.project_id = p.id
                LEFT JOIN project_groups pg ON p.group_id = pg.id
                WHERE a.reannotation_round > 0
                    AND a.status = 'completed'
                    AND (a.skipped IS NULL OR a.skipped = FALSE)
                GROUP BY p.id, p.name, p.group_id, pg.name, a.reannotation_round
                HAVING COUNT(DISTINCT CASE
                    WHEN a.evidence_status IS NOT NULL OR a.evidence_quality IS NOT NULL
                    THEN a.user_id
                END) >= 3
            )
            SELECT * FROM round_groups
            ORDER BY group_name, project_name, round_number, task_group
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

                    // 從快取讀取 local scores
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

                    // 從快取讀取 global alpha
                    const cachedGlobalAlpha = await sql`
                        SELECT
                            task_name,
                            global_alpha,
                            data_count,
                            calculated_at
                        FROM global_alpha_cache
                        WHERE project_id = ${project.id}
                            AND round_number = 0
                        ORDER BY task_name
                    `;

                    // 重建 globalResults 結構
                    const globalResults = cachedGlobalAlpha.rows.map(row => ({
                        task: row.task_name,
                        globalAlpha: row.global_alpha,
                        count: row.data_count
                    }));

                    // 重建 detailedResults 結構並補充原始資料和標註者資訊
                    const detailedResultsMap = new Map();
                    cachedScores.rows.forEach(score => {
                        if (!detailedResultsMap.has(score.source_data_id)) {
                            detailedResultsMap.set(score.source_data_id, {
                                source_data_id: score.source_data_id,
                                scores: {}
                            });
                        }
                        detailedResultsMap.get(score.source_data_id).scores[score.task_name] = score.local_score;
                    });

                    // 補充原始資料和標註者資訊
                    const sourceDataIds = Array.from(detailedResultsMap.keys());
                    if (sourceDataIds.length > 0) {
                        const sourceDataInfo = await sql`
                            SELECT
                                sd.id as source_data_id,
                                sd.original_data,
                                a.user_id,
                                a.promise_status,
                                a.verification_timeline,
                                a.evidence_status,
                                a.evidence_quality
                            FROM source_data sd
                            JOIN (
                                SELECT DISTINCT ON (source_data_id, user_id)
                                    source_data_id, user_id, promise_status,
                                    verification_timeline, evidence_status, evidence_quality,
                                    version, created_at
                                FROM annotations
                                WHERE source_data_id = ANY(${sourceDataIds})
                                    AND reannotation_round = 0
                                    AND status = 'completed'
                                    AND (skipped IS NULL OR skipped = FALSE)
                                ORDER BY source_data_id, user_id, version DESC, created_at DESC
                            ) a ON sd.id = a.source_data_id
                            WHERE sd.id = ANY(${sourceDataIds})
                        `;

                        sourceDataInfo.rows.forEach(row => {
                            const detail = detailedResultsMap.get(row.source_data_id);
                            if (detail) {
                                detail.original_data = row.original_data;
                                if (!detail.annotators) detail.annotators = [];
                                detail.annotators.push({
                                    user_id: row.user_id,
                                    promise_status: row.promise_status,
                                    verification_timeline: row.verification_timeline,
                                    evidence_status: row.evidence_status,
                                    evidence_quality: row.evidence_quality
                                });
                            }
                        });
                    }

                    const detailedResults = Array.from(detailedResultsMap.values());

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
                        globalResults,
                        detailedResults,
                        scores: cachedScores.rows  // Keep for backward compatibility
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

                    // 從快取讀取 local scores
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

                    // 從快取讀取 global alpha
                    const cachedGlobalAlpha = await sql`
                        SELECT
                            task_name,
                            global_alpha,
                            data_count,
                            calculated_at
                        FROM global_alpha_cache
                        WHERE project_id = ${round.project_id}
                            AND round_number = ${round.round_number}
                        ORDER BY task_name
                    `;

                    // 重建 globalResults 結構
                    const globalResults = cachedGlobalAlpha.rows.map(row => ({
                        task: row.task_name,
                        globalAlpha: row.global_alpha,
                        count: row.data_count
                    }));

                    // 重建 detailedResults 結構並補充原始資料和標註者資訊
                    const detailedResultsMap = new Map();
                    cachedScores.rows.forEach(score => {
                        if (!detailedResultsMap.has(score.source_data_id)) {
                            detailedResultsMap.set(score.source_data_id, {
                                source_data_id: score.source_data_id,
                                scores: {}
                            });
                        }
                        detailedResultsMap.get(score.source_data_id).scores[score.task_name] = score.local_score;
                    });

                    // 補充原始資料和標註者資訊（重標註）
                    const sourceDataIds = Array.from(detailedResultsMap.keys());
                    if (sourceDataIds.length > 0) {
                        const sourceDataInfo = await sql`
                            SELECT
                                sd.id as source_data_id,
                                sd.original_data,
                                a.user_id,
                                a.promise_status,
                                a.verification_timeline,
                                a.evidence_status,
                                a.evidence_quality
                            FROM source_data sd
                            JOIN (
                                SELECT DISTINCT ON (source_data_id, user_id)
                                    source_data_id, user_id, promise_status,
                                    verification_timeline, evidence_status, evidence_quality,
                                    version, created_at
                                FROM annotations
                                WHERE source_data_id = ANY(${sourceDataIds})
                                    AND reannotation_round = ${round.round_number}
                                    AND status = 'completed'
                                    AND (skipped IS NULL OR skipped = FALSE)
                                ORDER BY source_data_id, user_id, version DESC, created_at DESC
                            ) a ON sd.id = a.source_data_id
                            WHERE sd.id = ANY(${sourceDataIds})
                        `;

                        sourceDataInfo.rows.forEach(row => {
                            const detail = detailedResultsMap.get(row.source_data_id);
                            if (detail) {
                                detail.original_data = row.original_data;
                                if (!detail.annotators) detail.annotators = [];
                                detail.annotators.push({
                                    user_id: row.user_id,
                                    promise_status: row.promise_status,
                                    verification_timeline: row.verification_timeline,
                                    evidence_status: row.evidence_status,
                                    evidence_quality: row.evidence_quality
                                });
                            }
                        });
                    }

                    const detailedResults = Array.from(detailedResultsMap.values());

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
                        globalResults,
                        detailedResults,
                        scores: cachedScores.rows  // Keep for backward compatibility
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

        // 為所有結果添加用戶名稱
        const resultsWithUsernames = await addUsernamesToResults(results);

        return NextResponse.json({
            success: true,
            data: {
                results: resultsWithUsernames,
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

// 為結果添加用戶名稱
async function addUsernamesToResults(results) {
    try {
        // 收集所有需要查詢的 user_id
        const userIds = new Set();
        results.forEach(result => {
            if (result.detailedResults) {
                result.detailedResults.forEach(detail => {
                    if (detail.annotators) {
                        detail.annotators.forEach(ann => {
                            userIds.add(ann.user_id);
                        });
                    }
                });
            }
        });

        if (userIds.size === 0) return results;

        // 批次查詢所有用戶名稱
        const userIdArray = Array.from(userIds);
        const users = await sql`
            SELECT id, username
            FROM users
            WHERE id = ANY(${userIdArray})
        `;

        // 建立 user_id 到 username 的映射
        const userMap = new Map();
        users.rows.forEach(user => {
            userMap.set(user.id, user.username);
        });

        // 為每個結果添加 username
        const resultsWithUsernames = results.map(result => {
            if (result.detailedResults) {
                const detailedResults = result.detailedResults.map(detail => {
                    if (detail.annotators) {
                        const annotators = detail.annotators.map(ann => ({
                            ...ann,
                            username: userMap.get(ann.user_id) || ann.user_id
                        }));
                        return { ...detail, annotators };
                    }
                    return detail;
                });
                return { ...result, detailedResults };
            }
            return result;
        });

        return resultsWithUsernames;
    } catch (error) {
        console.error('添加用戶名稱失敗:', error);
        return results; // 如果失敗，返回原始結果
    }
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
                latest.persist_answer,
                latest.reannotation_comment,
                sd.original_data
            FROM (
                SELECT DISTINCT ON (a.source_data_id, a.user_id)
                    a.source_data_id,
                    a.user_id,
                    a.promise_status,
                    a.verification_timeline,
                    a.evidence_status,
                    a.evidence_quality,
                    a.persist_answer,
                    a.reannotation_comment,
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

        // 整理資料結構（與 calculate-agreement 相同）
        const sourceDataMap = new Map();
        const annotatorSet = new Set();

        annotations.rows.forEach(ann => {
            if (!sourceDataMap.has(ann.source_data_id)) {
                sourceDataMap.set(ann.source_data_id, {
                    source_data_id: ann.source_data_id,
                    original_data: ann.original_data,
                    annotators: {}
                });
            }

            const userId = ann.user_id;
            annotatorSet.add(userId);

            sourceDataMap.get(ann.source_data_id).annotators[userId] = {
                promise_status: ann.promise_status,
                verification_timeline: ann.verification_timeline,
                evidence_status: ann.evidence_status,
                evidence_quality: ann.evidence_quality,
                persist_answer: ann.persist_answer,
                reannotation_comment: ann.reannotation_comment
            };
        });

        const annotators = Array.from(annotatorSet);
        const sourceDataList = Array.from(sourceDataMap.values());

        // 檢查是否至少有 3 個標註者
        if (annotators.length < 3) {
            return { success: false, error: `標註者不足：需要至少 3 人，目前只有 ${annotators.length} 人` };
        }

        // 計算各任務的 Global Alpha（使用完整算法）
        const globalResults = [];

        for (const task of tasks) {
            // 建立評分矩陣 (rows=annotators, cols=source_data)
            // null/undefined 保持為 null (krippendorff 會跳過)
            const matrix = annotators.map(annotator =>
                sourceDataList.map(item => {
                    const val = item.annotators[annotator]?.[task];
                    return (val === null || val === undefined) ? null : val;
                })
            );

            const alpha = calculateKrippendorffsAlpha(matrix);

            globalResults.push({
                task,
                globalAlpha: isNaN(alpha) ? null : alpha,
                count: sourceDataList.length
            });
        }

        // 計算每筆資料的 Local Alpha（使用完整算法）
        const detailedResults = sourceDataList.map(item => {
            const result = {
                source_data_id: item.source_data_id,
                original_data: item.original_data,
                scores: {},
                annotators: []
            };

            // 整理標註者資料
            for (const annotator of annotators) {
                if (item.annotators[annotator]) {
                    result.annotators.push({
                        user_id: annotator,
                        ...item.annotators[annotator]
                    });
                }
            }

            // 計算各任務的 local alpha
            for (const task of tasks) {
                // 建立該任務的完整資料矩陣 (用於計算 De)
                // 將 null 替換成 'N/A',與 calculate-agreement 一致
                const taskMatrix = annotators.map(annotator =>
                    sourceDataList.map(dataItem => {
                        const val = dataItem.annotators[annotator]?.[task];
                        return (val === null || val === undefined) ? 'N/A' : val;
                    })
                );

                // 取得此題目的評分,null 替換成 'N/A'
                const itemValues = annotators.map(ann => {
                    const val = item.annotators[ann]?.[task];
                    return (val === null || val === undefined) ? 'N/A' : val;
                });

                const localScore = calculateLocalAlpha(itemValues, taskMatrix);
                result.scores[task] = isNaN(localScore) ? null : localScore;
            }

            return result;
        });

        return {
            success: true,
            data: {
                globalResults,
                detailedResults,
                annotatorCount: annotators.length
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

        // 整理資料結構（與 calculate-agreement 相同）
        const sourceDataMap = new Map();
        const annotatorSet = new Set();

        annotations.rows.forEach(ann => {
            if (!sourceDataMap.has(ann.source_data_id)) {
                sourceDataMap.set(ann.source_data_id, {
                    source_data_id: ann.source_data_id,
                    original_data: ann.original_data,
                    annotators: {}
                });
            }

            const userId = ann.user_id;
            annotatorSet.add(userId);

            sourceDataMap.get(ann.source_data_id).annotators[userId] = {
                promise_status: ann.promise_status,
                verification_timeline: ann.verification_timeline,
                evidence_status: ann.evidence_status,
                evidence_quality: ann.evidence_quality,
                persist_answer: ann.persist_answer,
                reannotation_comment: ann.reannotation_comment
            };
        });

        const annotators = Array.from(annotatorSet);
        const sourceDataList = Array.from(sourceDataMap.values());

        // 檢查是否至少有 3 個標註者
        if (annotators.length < 3) {
            return { success: false, error: `標註者不足：需要至少 3 人，目前只有 ${annotators.length} 人` };
        }

        // 計算各任務的 Global Alpha（使用完整算法）
        const globalResults = [];

        for (const task of tasks) {
            // 建立評分矩陣 (rows=annotators, cols=source_data)
            const matrix = annotators.map(annotator =>
                sourceDataList.map(item => {
                    const val = item.annotators[annotator]?.[task];
                    return (val === null || val === undefined) ? null : val;
                })
            );

            const alpha = calculateKrippendorffsAlpha(matrix);

            globalResults.push({
                task,
                globalAlpha: isNaN(alpha) ? null : alpha,
                count: sourceDataList.length
            });
        }

        // 計算每筆資料的 Local Alpha（使用完整算法）
        const detailedResults = sourceDataList.map(item => {
            const result = {
                source_data_id: item.source_data_id,
                original_data: item.original_data,
                scores: {},
                annotators: []
            };

            // 整理標註者資料
            for (const annotator of annotators) {
                if (item.annotators[annotator]) {
                    result.annotators.push({
                        user_id: annotator,
                        ...item.annotators[annotator]
                    });
                }
            }

            // 計算各任務的 local alpha
            for (const task of tasks) {
                // 建立該任務的完整資料矩陣 (用於計算 De)
                // 將 null 替換成 'N/A',與 calculate-agreement 一致
                const taskMatrix = annotators.map(annotator =>
                    sourceDataList.map(dataItem => {
                        const val = dataItem.annotators[annotator]?.[task];
                        return (val === null || val === undefined) ? 'N/A' : val;
                    })
                );

                // 取得此題目的評分,null 替換成 'N/A'
                const itemValues = annotators.map(ann => {
                    const val = item.annotators[ann]?.[task];
                    return (val === null || val === undefined) ? 'N/A' : val;
                });

                const localScore = calculateLocalAlpha(itemValues, taskMatrix);
                result.scores[task] = isNaN(localScore) ? null : localScore;
            }

            return result;
        });

        return {
            success: true,
            data: {
                globalResults,
                detailedResults,
                annotatorCount: annotators.length,
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
        // 刪除舊的快取（local scores）
        await sql`
            DELETE FROM agreement_scores_cache
            WHERE project_id = ${projectId} AND round_number = ${roundNumber}
        `;

        // 刪除舊的快取（global alpha）
        await sql`
            DELETE FROM global_alpha_cache
            WHERE project_id = ${projectId} AND round_number = ${roundNumber}
        `;

        // 插入新的 local scores
        for (const item of data.detailedResults) {
            for (const [taskName, localScore] of Object.entries(item.scores)) {
                // 處理 NaN 和 null：都轉換為 null 儲存
                const scoreToSave = (localScore === null || isNaN(localScore)) ? null : localScore;

                await sql`
                    INSERT INTO agreement_scores_cache (
                        project_id, source_data_id, round_number, task_name,
                        local_score, annotators_count, calculated_at
                    ) VALUES (
                        ${projectId}, ${item.source_data_id}, ${roundNumber}, ${taskName},
                        ${scoreToSave}, ${data.annotatorCount}, NOW()
                    )
                    ON CONFLICT (project_id, source_data_id, round_number, task_name)
                    DO UPDATE SET
                        local_score = ${scoreToSave},
                        annotators_count = ${data.annotatorCount},
                        calculated_at = NOW()
                `;
            }
        }

        // 插入新的 global alpha values
        for (const globalResult of data.globalResults) {
            const alphaToSave = (globalResult.globalAlpha === null || isNaN(globalResult.globalAlpha))
                ? null
                : globalResult.globalAlpha;

            await sql`
                INSERT INTO global_alpha_cache (
                    project_id, round_number, task_name,
                    global_alpha, data_count, calculated_at
                ) VALUES (
                    ${projectId}, ${roundNumber}, ${globalResult.task},
                    ${alphaToSave}, ${globalResult.count}, NOW()
                )
                ON CONFLICT (project_id, round_number, task_name)
                DO UPDATE SET
                    global_alpha = ${alphaToSave},
                    data_count = ${globalResult.count},
                    calculated_at = NOW()
            `;
        }

        return true;
    } catch (error) {
        console.error('儲存快取失敗:', error);
        return false;
    }
}
