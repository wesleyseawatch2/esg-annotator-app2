# 標註一致性儀表板修復紀錄

## 🐛 問題描述

### 問題 1: SQL 錯誤
執行批次分析時出現錯誤：
```
分析失敗: column a.project_id does not exist
```

### 問題 2: 無法抓取資料
修復後顯示「分析完成」但結果為：
```
新分析: 0 個
使用快取: 0 個
```

## 🔍 問題原因

### 原因 1: 資料表關聯錯誤
`annotations` 表沒有 `project_id` 欄位。`annotations` 表是通過 `source_data` 表間接關聯到 `projects` 表的。

### 原因 2: 狀態欄位不一致
- 原始查詢使用 `status = 'submitted'`
- 實際應該使用 `status = 'completed'`（完成狀態）
- 需要考慮 `version`（版本號）和 `skipped`（跳過標記）

### 資料庫結構：
```
projects (id, name, group_id, ...)
    ↓
source_data (id, project_id, original_data, ...)
    ↓
annotations (id, source_data_id, user_id, reannotation_round, ...)
```

## ✅ 修復內容

### 檔案：`app/api/batch-calculate-agreement/route.js`

#### 1. 修復取得已完成專案的查詢（第 115-132 行）

**錯誤寫法：**
```sql
FROM projects p
LEFT JOIN project_groups pg ON p.group_id = pg.id
JOIN annotations a ON a.project_id = p.id  -- ❌ annotations 沒有 project_id
WHERE a.status = 'submitted'
```

**正確寫法：**
```sql
FROM projects p
LEFT JOIN project_groups pg ON p.group_id = pg.id
JOIN source_data sd ON sd.project_id = p.id  -- ✅ 先 JOIN source_data
JOIN annotations a ON a.source_data_id = sd.id  -- ✅ 再 JOIN annotations
WHERE a.status = 'submitted'
    AND a.reannotation_round = 0  -- ✅ 只查詢初次標註
```

#### 2. 修復計算專案一致性的查詢（第 336-353 行）

**錯誤寫法：**
```sql
FROM annotations a
JOIN users u ON a.user_id = u.id
JOIN source_data sd ON a.source_data_id = sd.id
WHERE a.project_id = ${projectId}  -- ❌ annotations 沒有 project_id
```

**正確寫法：**
```sql
FROM annotations a
JOIN users u ON a.user_id = u.id
JOIN source_data sd ON a.source_data_id = sd.id
WHERE sd.project_id = ${projectId}  -- ✅ 使用 source_data.project_id
```

#### 3. 修復計算重標註一致性的查詢（第 434-451 行）

**錯誤寫法：**
```sql
FROM annotations a
JOIN users u ON a.user_id = u.id
JOIN source_data sd ON a.source_data_id = sd.id
WHERE a.project_id = ${projectId}  -- ❌ annotations 沒有 project_id
```

**正確寫法：**
```sql
FROM annotations a
JOIN users u ON a.user_id = u.id
JOIN source_data sd ON a.source_data_id = sd.id
WHERE sd.project_id = ${projectId}  -- ✅ 使用 source_data.project_id
```

## 🧪 測試步驟

1. 重新啟動開發伺服器（如果需要）
2. 進入管理後台 → 一致性儀表板
3. 點擊「🚀 執行智能分析（僅新資料）」
4. 確認分析成功完成，沒有出現 "column a.project_id does not exist" 錯誤
5. 檢查顯示的統計摘要是否正確
6. 嘗試使用篩選器
7. 嘗試匯出 Excel

## 📝 修復時間

2026-01-04

## ✨ 額外改進

在取得已完成專案時，增加了 `AND a.reannotation_round = 0` 條件，確保只統計初次標註的專案（避免重標註資料干擾統計）。

## 🔗 相關檔案

- [app/api/batch-calculate-agreement/route.js](app/api/batch-calculate-agreement/route.js)
- [app/admin/consistency-dashboard/page.js](app/admin/consistency-dashboard/page.js)
- [docs/consistency-dashboard-guide.md](docs/consistency-dashboard-guide.md)
