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

async function main() {
  try {
    console.log('開始計算前5個有初次標注的組的 K-Alpha...\n');

    // 查詢所有有初次標注的專案
    const { rows: projects } = await sql`
      SELECT DISTINCT 
        p.id, 
        p.name,
        COUNT(DISTINCT a.source_data_id) as item_count,
        COUNT(DISTINCT a.user_id) as annotator_count
      FROM projects p
      JOIN source_data sd ON sd.project_id = p.id
      JOIN annotations a ON a.source_data_id = sd.id
      WHERE a.version = 1
      GROUP BY p.id, p.name
      ORDER BY p.id
      LIMIT 5
    `;

    console.log(`找到 ${projects.length} 個有初次標注的專案\n`);

    let count = 0;

    for (const project of projects) {
      count++;
      console.log(`========== 第 ${count} 組: ${project.name} (ID: ${project.id}) ==========`);
      console.log(`   標註者數: ${project.annotator_count}, 項目數: ${project.item_count}`);

      // 取得該專案的所有初次標註資料
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
        WHERE sd.project_id = ${project.id}
          AND a.version = 1
        ORDER BY a.source_data_id, u.username;
      `;

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

      console.log(`   實際標註者: ${annotators.join(', ')}`);

      // 檢查是否所有項目都被所有標註者標註完成
      let completeItems = 0;
      let incompleteItems = 0;

      for (const item of sourceDataList) {
        const completedAnnotators = annotators.filter(ann => {
          const annotation = item.annotators[ann];
          if (!annotation) return false;
          // 檢查四個任務都有標註
          return (annotation.promise_status !== null && annotation.promise_status !== undefined) &&
                 (annotation.verification_timeline !== null && annotation.verification_timeline !== undefined) &&
                 (annotation.evidence_status !== null && annotation.evidence_status !== undefined) &&
                 (annotation.evidence_quality !== null && annotation.evidence_quality !== undefined);
        });

        if (completedAnnotators.length === annotators.length) {
          completeItems++;
        } else {
          incompleteItems++;
        }
      }

      console.log(`   完成項目: ${completeItems}, 未完成項目: ${incompleteItems}`);

      if (completeItems === 0) {
        console.log(`   ⚠️  沒有完整標註的項目，跳過 K-Alpha 計算\n`);
        continue;
      }

      // 建立完整項目的矩陣（只包含被所有標註者標註完成的項目）
      const completeSourceDataList = sourceDataList.filter(item => {
        const completedAnnotators = annotators.filter(ann => {
          const annotation = item.annotators[ann];
          if (!annotation) return false;
          return (annotation.promise_status !== null && annotation.promise_status !== undefined) &&
                 (annotation.verification_timeline !== null && annotation.verification_timeline !== undefined) &&
                 (annotation.evidence_status !== null && annotation.evidence_status !== undefined) &&
                 (annotation.evidence_quality !== null && annotation.evidence_quality !== undefined);
        });
        return completedAnnotators.length === annotators.length;
      });

      // 計算各任務的 K-Alpha
      const tasks = ['promise_status', 'verification_timeline', 'evidence_status', 'evidence_quality'];
      const taskNames = {
        'promise_status': '承諾狀態',
        'verification_timeline': '驗證時間',
        'evidence_status': '證據狀態',
        'evidence_quality': '證據品質'
      };

      console.log(`\n   K-Alpha 計算結果 (基於 ${completeItems} 個完整項目):`);

      for (const task of tasks) {
        const matrix = annotators.map(annotator =>
          completeSourceDataList.map(item => {
            const val = item.annotators[annotator]?.[task];
            return (val === null || val === undefined) ? null : val;
          })
        );

        const alpha = calculateKrippendorffsAlpha(matrix);
        const quality = alpha >= 0.8 ? '優秀' : (alpha >= 0.667 ? '可接受' : '較差');

        console.log(`      • ${taskNames[task]}: ${isNaN(alpha) ? 'N/A' : alpha.toFixed(4)} (${quality})`);
      }

      console.log('');
    }

    console.log('計算完成！');
    process.exit(0);

  } catch (error) {
    console.error('錯誤:', error);
    process.exit(1);
  }
}

main();
