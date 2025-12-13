// 檔案路徑: app/api/reannotation/create-round/route.js
import { sql } from '@vercel/postgres';
import { NextResponse } from 'next/server';

// 引入一致性計算函數 (與 calculate-agreement 相同)
function calculateKrippendorffsAlpha(data) {
  const matrix = data;
  const nRaters = matrix.length;
  const nItems = matrix[0] ? matrix[0].length : 0;

  if (nRaters === 0 || nItems === 0) return NaN;

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

  const coincidenceMatrix = Array(nValues).fill(0).map(() => Array(nValues).fill(0));

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

  const nc = Array(nValues).fill(0);
  for (let c = 0; c < nValues; c++) {
    for (let k = 0; k < nValues; k++) {
      nc[c] += coincidenceMatrix[c][k];
    }
  }

  const n = nc.reduce((sum, val) => sum + val, 0);
  if (n === 0) return NaN;

  let Do = 0;
  for (let c = 0; c < nValues; c++) {
    for (let k = 0; k < nValues; k++) {
      if (c !== k) {
        Do += coincidenceMatrix[c][k];
      }
    }
  }

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

function calculateLocalAlpha(itemData, allData) {
  const values = itemData;
  const m = values.length;

  if (m < 2) return NaN;

  const allValuesSet = new Set();
  allData.forEach(row => {
    row.forEach(val => {
      allValuesSet.add(val);
    });
  });

  const uniqueVals = Array.from(allValuesSet);

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

  const uCounts = {};
  uniqueVals.forEach(v => {
    uCounts[v] = values.filter(val => val === v).length;
  });

  let sumNuSq = 0;
  for (const val of uniqueVals) {
    sumNuSq += (uCounts[val] || 0) ** 2;
  }

  const Du = (m ** 2 - sumNuSq) / (m * (m - 1));

  if (De === 0) {
    return Du === 0 ? 1.0 : 0.0;
  }

  const score = 1 - (Du / De);
  return score;
}

/**
 * POST /api/reannotation/create-round
 * 計算一致性並建立新一輪重標註任務
 *
 * Body:
 * {
 *   userId: number,
 *   projectId: number,
 *   taskGroup: 'group1' | 'group2',
 *   threshold: number (default 0.5),
 *   assignAll: boolean (default true - 所有人都要重看)
 * }
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const {
      userId,
      projectId,
      taskGroup,
      threshold = 0.5,
      assignAll = true
    } = body;

    // 驗證管理員權限
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return NextResponse.json({ success: false, error: '權限不足' }, { status: 403 });
    }

    // 驗證參數
    if (!['group1', 'group2'].includes(taskGroup)) {
      return NextResponse.json({
        success: false,
        error: 'taskGroup 必須是 group1 或 group2'
      }, { status: 400 });
    }

    // 定義任務分組
    const taskGroups = {
      group1: ['promise_status', 'verification_timeline'],
      group2: ['evidence_status', 'evidence_quality']
    };

    const tasksToCheck = taskGroups[taskGroup];

    // 取得專案標註資料
    const { rows: annotations } = await sql`
      SELECT
        a.source_data_id,
        a.user_id,
        u.username,
        a.promise_status,
        a.verification_timeline,
        a.evidence_status,
        a.evidence_quality
      FROM annotations a
      JOIN users u ON a.user_id = u.id
      JOIN source_data sd ON a.source_data_id = sd.id
      WHERE sd.project_id = ${projectId}
      AND a.status = 'completed'
      AND (a.skipped IS NULL OR a.skipped = FALSE)
      ORDER BY a.source_data_id, u.username
    `;

    if (annotations.length === 0) {
      return NextResponse.json({
        success: false,
        error: '此專案沒有已完成的標註資料'
      }, { status: 404 });
    }

    // 整理資料結構
    const sourceDataMap = new Map();
    const annotatorSet = new Set();

    annotations.forEach(ann => {
      if (!sourceDataMap.has(ann.source_data_id)) {
        sourceDataMap.set(ann.source_data_id, {
          source_data_id: ann.source_data_id,
          annotators: {}
        });
      }

      const shortName = ann.username.split('@')[0];
      annotatorSet.add(shortName);

      sourceDataMap.get(ann.source_data_id).annotators[shortName] = {
        user_id: ann.user_id,
        promise_status: ann.promise_status,
        verification_timeline: ann.verification_timeline,
        evidence_status: ann.evidence_status,
        evidence_quality: ann.evidence_quality
      };
    });

    const annotators = Array.from(annotatorSet);
    const sourceDataList = Array.from(sourceDataMap.values());

    // 計算每筆資料的 Local Alpha
    const inconsistentItems = [];

    for (const item of sourceDataList) {
      const localScores = {};
      let hasInconsistency = false;

      for (const task of tasksToCheck) {
        // 建立任務矩陣
        const taskMatrix = annotators.map(annotator =>
          sourceDataList.map(dataItem => {
            const val = dataItem.annotators[annotator]?.[task];
            return (val === null || val === undefined) ? 'N/A' : val;
          })
        );

        // 取得此題目的評分
        const itemValues = annotators.map(ann => {
          const val = item.annotators[ann]?.[task];
          return (val === null || val === undefined) ? 'N/A' : val;
        });

        const localScore = calculateLocalAlpha(itemValues, taskMatrix);
        localScores[task] = isNaN(localScore) ? 0 : localScore;

        if (localScores[task] < threshold) {
          hasInconsistency = true;
        }
      }

      if (hasInconsistency) {
        inconsistentItems.push({
          source_data_id: item.source_data_id,
          annotators: item.annotators,
          localScores
        });
      }
    }

    if (inconsistentItems.length === 0) {
      return NextResponse.json({
        success: true,
        message: '沒有發現一致性低於門檻的資料',
        data: {
          inconsistentCount: 0,
          threshold
        }
      });
    }

    // 開始建立重標註任務
    await sql.query('BEGIN');

    try {
      // 1. 建立新輪次
      const { rows: roundRows } = await sql`
        SELECT COALESCE(MAX(round_number), 0) + 1 as next_round
        FROM reannotation_rounds
        WHERE project_id = ${projectId}
      `;

      const nextRound = roundRows[0].next_round;

      const { rows: newRoundRows } = await sql`
        INSERT INTO reannotation_rounds
        (project_id, round_number, task_group, threshold, created_by, status)
        VALUES (${projectId}, ${nextRound}, ${taskGroup}, ${threshold}, ${userId}, 'active')
        RETURNING id
      `;

      const roundId = newRoundRows[0].id;

      // 2. 為每筆不一致的資料建立任務
      let taskCount = 0;

      for (const item of inconsistentItems) {
        const tasksFlagged = {};
        tasksToCheck.forEach(task => {
          if (item.localScores[task] < threshold) {
            tasksFlagged[task] = item.localScores[task];
          }
        });

        // 為每位標註者建立任務 (如果 assignAll=true)
        const userIds = Object.values(item.annotators).map(a => a.user_id);

        for (const uid of userIds) {
          await sql`
            INSERT INTO reannotation_tasks
            (round_id, source_data_id, user_id, task_group, tasks_flagged, status)
            VALUES (
              ${roundId},
              ${item.source_data_id},
              ${uid},
              ${taskGroup},
              ${JSON.stringify(tasksFlagged)},
              'pending'
            )
          `;
          taskCount++;
        }

        // 更新快取
        for (const task of tasksToCheck) {
          await sql`
            INSERT INTO agreement_scores_cache
            (project_id, source_data_id, round_number, task_name, local_score, annotators_count)
            VALUES (
              ${projectId},
              ${item.source_data_id},
              ${nextRound},
              ${task},
              ${item.localScores[task]},
              ${userIds.length}
            )
            ON CONFLICT (project_id, source_data_id, round_number, task_name)
            DO UPDATE SET local_score = EXCLUDED.local_score, calculated_at = NOW()
          `;
        }
      }

      await sql.query('COMMIT');

      return NextResponse.json({
        success: true,
        data: {
          roundId,
          roundNumber: nextRound,
          taskGroup,
          inconsistentCount: inconsistentItems.length,
          tasksCreated: taskCount,
          threshold,
          tasks: tasksToCheck
        }
      });

    } catch (error) {
      await sql.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('建立重標註輪次失敗:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
