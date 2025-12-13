// 檔案路徑: app/api/calculate-agreement/route.js
import { sql } from '@vercel/postgres';
import { NextResponse } from 'next/server';

/**
 * 計算 Krippendorff's Alpha (Nominal level)
 * 使用與 Python krippendorff 套件相同的演算法
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
  // Do = sum of all off-diagonal elements for nominal data
  let Do = 0;
  for (let c = 0; c < nValues; c++) {
    for (let k = 0; k < nValues; k++) {
      if (c !== k) {
        Do += coincidenceMatrix[c][k];
      }
    }
  }

  // 計算 expected disagreement (De)
  // De = sum(nc[c] * nc[k]) for all c != k, divided by (n-1)
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
 * 使用與 Python 版本相同的演算法
 * 注意: 這裡 allData 應該已經把 null 替換成 'N/A' (缺值當成一個類別)
 * @param {Array} itemData - 單一題目的所有評分者答案 (包含 'N/A')
 * @param {Array<Array>} allData - 完整的資料矩陣 (包含 'N/A'),用於計算 De
 * @returns {number} - Local Alpha 分數
 */
function calculateLocalAlpha(itemData, allData) {
  // Python 版本不過濾任何值,所有值(包括 'N/A')都參與計算
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
    const { userId, projectId } = await request.json();

    // 驗證管理員權限
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return NextResponse.json({ success: false, error: '權限不足' }, { status: 403 });
    }

    // 取得專案資訊
    const { rows: projectRows } = await sql`
      SELECT id, name FROM projects WHERE id = ${projectId};
    `;

    if (projectRows.length === 0) {
      return NextResponse.json({ success: false, error: '專案不存在' }, { status: 404 });
    }

    const project = projectRows[0];

    // 取得所有標註資料
    const { rows: annotations } = await sql`
      SELECT
        a.source_data_id,
        a.user_id,
        u.username,
        a.promise_status,
        a.verification_timeline,
        a.evidence_status,
        a.evidence_quality,
        sd.original_data
      FROM annotations a
      JOIN users u ON a.user_id = u.id
      JOIN source_data sd ON a.source_data_id = sd.id
      WHERE sd.project_id = ${projectId}
      ORDER BY a.source_data_id, u.username;
    `;

    if (annotations.length === 0) {
      return NextResponse.json({
        success: false,
        error: '此專案沒有標註資料'
      }, { status: 404 });
    }

    // 整理資料結構
    const sourceDataMap = new Map();
    const annotatorSet = new Set();

    annotations.forEach(ann => {
      if (!sourceDataMap.has(ann.source_data_id)) {
        sourceDataMap.set(ann.source_data_id, {
          source_data_id: ann.source_data_id,
          original_data: ann.original_data,
          annotators: {}
        });
      }

      const shortName = ann.username.split('@')[0];
      annotatorSet.add(shortName);

      sourceDataMap.get(ann.source_data_id).annotators[shortName] = {
        promise_status: ann.promise_status,
        verification_timeline: ann.verification_timeline,
        evidence_status: ann.evidence_status,
        evidence_quality: ann.evidence_quality
      };
    });

    const annotators = Array.from(annotatorSet);
    const sourceDataList = Array.from(sourceDataMap.values());

    // 計算各任務的 Global Alpha
    const tasks = ['promise_status', 'verification_timeline', 'evidence_status', 'evidence_quality'];
    const taskNames = {
      'promise_status': '承諾狀態',
      'verification_timeline': '驗證時間',
      'evidence_status': '證據狀態',
      'evidence_quality': '證據品質'
    };

    const globalResults = [];

    for (const task of tasks) {
      // 建立評分矩陣 (rows=annotators, cols=source_data)
      // 注意: Python 版本在 Global Alpha 計算時,pivot 後的 NaN 會保持為 NaN (不參與計算)
      // 但對於有值的情況 (包括空字串、'N/A' 等),都會被視為有效類別
      const matrix = annotators.map(annotator =>
        sourceDataList.map(item => {
          const val = item.annotators[annotator]?.[task];
          // 只有 null/undefined 保持為 null (krippendorff 會跳過)
          // 其他值(包括空字串 '', 'N/A' 等)都視為有效類別
          return (val === null || val === undefined) ? null : val;
        })
      );

      const alpha = calculateKrippendorffsAlpha(matrix);
      const rating = alpha >= 0.8 ? 'High' : (alpha >= 0.667 ? 'Acceptable' : 'Low');

      globalResults.push({
        task,
        taskName: taskNames[task],
        alpha: isNaN(alpha) ? 0 : alpha,
        quality: rating
      });
    }

    // 計算每筆資料的 Local Alpha
    const detailedResults = sourceDataList.map(item => {
      const result = {
        source_data_id: item.source_data_id,
        original_data: item.original_data,
        annotators: []
      };

      // 整理標註者資料
      for (const annotator of annotators) {
        if (item.annotators[annotator]) {
          result.annotators.push({
            name: annotator,
            ...item.annotators[annotator]
          });
        }
      }

      // 計算各任務的 local alpha
      for (const task of tasks) {
        // 建立該任務的完整資料矩陣 (用於計算 De)
        // 重要: 將 null 替換成 'N/A',與 Python 的 fillna('N/A') 一致
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
        result[`${task}_score`] = isNaN(localScore) ? 0 : localScore;
      }

      // 判斷是否有爭議
      result.hasInconsistency = tasks.some(task => result[`${task}_score`] < 0.5);

      return result;
    });

    // 統計資料
    const inconsistentCount = detailedResults.filter(r => r.hasInconsistency).length;
    const avgAlpha = globalResults.reduce((sum, r) => sum + r.alpha, 0) / globalResults.length;

    return NextResponse.json({
      success: true,
      data: {
        projectName: project.name,
        annotators,
        globalResults,
        detailedResults,
        stats: {
          totalCases: sourceDataList.length,
          inconsistentCases: inconsistentCount,
          avgAlpha: avgAlpha
        }
      }
    });

  } catch (error) {
    console.error('計算一致性失敗:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
