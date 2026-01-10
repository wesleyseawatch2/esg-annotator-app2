// 檔案路徑: lib/krippendorff.js

/**
 * 計算 Nominal 尺度的 Krippendorff's Alpha
 * @param {Array} annotations - 格式: [{ unitId, coderId, value }, ...]
 * @returns {Object} { alpha: 全域分數, unitScores: { id: 單題分數 } }
 */
export function calculateNominalAlpha(annotations) {
    // 1. 資料前處理
    const units = {}; 
    const uniqueValues = new Set();

    annotations.forEach(({ unitId, value }) => {
        let v = String(value || '').trim();
        // 排除無效值 (對應 Python 邏輯)
        if (!v || v.toUpperCase() === 'N/A' || v.toLowerCase() === 'NAN') return;

        if (!units[unitId]) units[unitId] = [];
        units[unitId].push(v);
        uniqueValues.add(v);
    });

    const valuesList = Array.from(uniqueValues).sort();
    const valToIdx = {};
    valuesList.forEach((v, i) => valToIdx[v] = i);
    
    const m = valuesList.length;
    
    // 只有 0 或 1 種選項，視為完全一致
    if (m < 2) {
        const defaultScores = {};
        Object.keys(units).forEach(uid => defaultScores[uid] = 1.0);
        return { alpha: 1.0, unitScores: defaultScores };
    }

    // 2. 建立矩陣與計算單題分數
    const matrix = Array(m).fill(0).map(() => Array(m).fill(0));
    const unitScores = {}; 

    Object.keys(units).forEach(unitId => {
        const vals = units[unitId];
        const n_u = vals.length;

        if (n_u < 2) {
            unitScores[unitId] = 1.0; 
            return;
        }

        let disagreementCount = 0;
        const totalPairs = n_u * (n_u - 1);

        for (let i = 0; i < n_u; i++) {
            for (let j = 0; j < n_u; j++) {
                if (i !== j) {
                    const v1 = vals[i];
                    const v2 = vals[j];
                    matrix[valToIdx[v1]][valToIdx[v2]] += 1 / (n_u - 1);
                    if (v1 !== v2) disagreementCount++;
                }
            }
        }
        unitScores[unitId] = 1 - (disagreementCount / totalPairs);
    });

    // 3. 計算全域 Alpha
    const totalN = matrix.flat().reduce((a, b) => a + b, 0);
    if (totalN === 0) return { alpha: 1.0, unitScores };

    let do_obs = 0;
    for (let i = 0; i < m; i++) {
        for (let j = 0; j < m; j++) {
            if (i !== j) do_obs += matrix[i][j];
        }
    }

    const rowSums = matrix.map(row => row.reduce((a, b) => a + b, 0));
    let de_exp = 0;
    for (let i = 0; i < m; i++) {
        for (let j = 0; j < m; j++) {
            if (i !== j) de_exp += rowSums[i] * rowSums[j];
        }
    }
    de_exp = de_exp / (totalN - 1);

    const alpha = de_exp !== 0 ? 1 - (do_obs / de_exp) : 1.0;

    return { alpha: Number(alpha.toFixed(4)), unitScores };
}