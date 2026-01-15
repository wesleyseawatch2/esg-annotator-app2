import { sql } from '@vercel/postgres';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

/**
 * 計算 Krippendorff's Alpha (Nominal level)
 */
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

async function main() {
  try {
    // 要計算的專案ID (排除進度項目)
    const projectIds = [
      61, 62, 66, 67,           // 組1
      50, 51, 53,               // 組2  
      21, 37, 38, 40, 60,       // 組3
      14, 15, 16, 17, 18,       // 組4
      24, 25, 26, 29,           // 組5
      32, 33, 34,               // 組6
      41, 44, 46, 49, 59        // 組7
    ];

    console.log(`\n開始計算 ${projectIds.length} 個專案的 K-Alpha...`);
    console.log('=' .repeat(150));
    console.log('');

    const results = [];

    for (const projectId of projectIds) {
      try {
        // 查詢項目信息
        const { rows: projectRows } = await sql`
          SELECT id, name 
          FROM projects 
          WHERE id = ${projectId}
        `;

        if (projectRows.length === 0) {
          continue;
        }

        const project = projectRows[0];

        // 取得該專案的初次標註資料
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
            AND a.version = 1
          ORDER BY a.source_data_id, u.username;
        `;

        if (annotations.length === 0) {
          continue;
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
            promise_status: ann.promise_status,
            verification_timeline: ann.verification_timeline,
            evidence_status: ann.evidence_status,
            evidence_quality: ann.evidence_quality
          };
        });

        const annotators = Array.from(annotatorSet).sort();
        const sourceDataList = Array.from(sourceDataMap.values());

        // 檢查完整項目
        let completeItems = 0;
        const completeSourceDataList = sourceDataList.filter(item => {
          const completedAnnotators = annotators.filter(ann => {
            const annotation = item.annotators[ann];
            if (!annotation) return false;
            return (annotation.promise_status !== null && annotation.promise_status !== undefined) &&
                   (annotation.verification_timeline !== null && annotation.verification_timeline !== undefined) &&
                   (annotation.evidence_status !== null && annotation.evidence_status !== undefined) &&
                   (annotation.evidence_quality !== null && annotation.evidence_quality !== undefined);
          });
          if (completedAnnotators.length === annotators.length) {
            completeItems++;
            return true;
          }
          return false;
        });

        if (completeItems === 0) {
          continue;
        }

        // 計算 K-Alpha
        const tasks = ['promise_status', 'verification_timeline', 'evidence_status', 'evidence_quality'];
        const alphaValues = [];

        for (const task of tasks) {
          const matrix = annotators.map(annotator =>
            completeSourceDataList.map(item => {
              const val = item.annotators[annotator]?.[task];
              return (val === null || val === undefined) ? null : val;
            })
          );

          const alpha = calculateKrippendorffsAlpha(matrix);
          alphaValues.push(isNaN(alpha) ? 0 : alpha);
        }

        const avgAlpha = alphaValues.reduce((a, b) => a + b, 0) / alphaValues.length;

        results.push({
          id: projectId,
          name: project.name,
          annotators: annotators.length,
          completeItems,
          promise_status: alphaValues[0],
          verification_timeline: alphaValues[1],
          evidence_status: alphaValues[2],
          evidence_quality: alphaValues[3],
          avgAlpha: avgAlpha
        });

      } catch (error) {
        // 忽略錯誤，繼續下一個
      }
    }

    // 按照 ID 排序結果
    results.sort((a, b) => a.id - b.id);

    console.log(`\n找到 ${results.length} 個有完整標註的項目\n`);

    // 輸出表格
    console.log('📊 K-Alpha 計算結果:\n');
    console.log('ID  | 專案名稱                                          | 標註者 | 完整項目 | 承諾狀態 | 驗證時間 | 證據狀態 | 證據品質 | 平均值');
    console.log('-'.repeat(150));

    results.forEach(r => {
      const name = r.name.substring(0, 48).padEnd(48);
      const p = r.promise_status.toFixed(4);
      const v = r.verification_timeline.toFixed(4);
      const e = r.evidence_status.toFixed(4);
      const q = r.evidence_quality.toFixed(4);
      const a = r.avgAlpha.toFixed(4);
      console.log(`${r.id.toString().padStart(3)} | ${name} | ${r.annotators} | ${r.completeItems.toString().padEnd(8)} | ${p} | ${v} | ${e} | ${q} | ${a}`);
    });

    console.log('\n計算完成！');
    process.exit(0);

  } catch (error) {
    console.error('錯誤:', error);
    process.exit(1);
  }
}
