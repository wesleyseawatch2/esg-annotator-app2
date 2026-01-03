# 資料替換指南

本指南說明如何使用 CSV 檔案批次替換資料庫中所有專案的資料和 PDF URL 對應。

## 📋 概述

這套工具可以：
1. **備份**現有的 `source_data` 和 `projects` 資料
2. **讀取** CSV 檔案並根據 `_company_key` 分組
3. **替換**每個專案的：
   - `source_data` 表中的 `original_data`、`source_url`、`page_number`
   - `projects` 表中的 `pdf_urls` 對應表
4. **還原**備份（如果需要）

## 🗂️ 相關檔案

```
scripts/
├── preview-data-replacement.js       # 預覽將會發生的變更（推薦先執行）
├── replace-all-projects-data.js      # 實際執行替換
└── restore-from-backup.js            # 從備份還原

backups/                               # 自動產生的備份目錄
├── source_data_backup_<時間戳>.json
└── projects_backup_<時間戳>.json
```

## 📝 CSV 檔案格式要求

CSV 檔案必須包含以下欄位：

| 欄位 | 說明 | 必填 |
|------|------|------|
| `data` | ESG 文本內容（對應 `original_data`） | ✅ |
| `URL` | PDF 網址（對應 `source_url`） | ✅ |
| `page_number` | 頁碼（對應 `page_number`） | ✅ |
| `_company_key` | 公司識別碼（對應專案名稱 `projects.name`） | ✅ |
| `ESG_type` | ESG 類別 | ❌ |
| `promise_status` | 承諾狀態 | ❌ |
| 其他欄位 | 不會被導入資料庫 | ❌ |

**重要事項：**
- `_company_key` 必須與資料庫中 `projects.name` 完全一致
- 若 CSV 中的 `_company_key` 在資料庫找不到對應專案，該筆資料會被跳過

## 🚀 使用步驟

### 步驟 1: 預覽變更（強烈建議）

在實際執行前，先預覽將會發生的變更：

```bash
node scripts/preview-data-replacement.js
```

**輸出內容：**
- ✅ 將會更新的專案清單
- ⚠️ CSV 中有但資料庫沒有的公司（會被跳過）
- ⚠️ 資料庫有但 CSV 沒有的專案（不會被更新）
- 📊 資料筆數變化統計
- 📝 CSV 資料範例

**範例輸出：**
```
✅ 將會更新的專案 (CSV 中有對應的專案):
--------------------------------------------------------------------------------
  GroupA_2345
    專案 ID: 1
    現有資料: 150 筆 → 新資料: 180 筆 (+30)
    現有 PDF 頁面: 150 頁
    page_offset: 0

  GroupB_6789
    專案 ID: 2
    現有資料: 200 筆 → 新資料: 195 筆 (-5)
    現有 PDF 頁面: 200 頁
    page_offset: 0
```

### 步驟 2: 執行替換

**⚠️ 警告：此操作會修改資料庫，請確認預覽結果無誤後再執行！**

```bash
node scripts/replace-all-projects-data.js
```

**執行流程：**
1. 自動備份 `source_data` 和 `projects` 到 `backups/` 目錄
2. 讀取並解析 CSV 檔案
3. 根據 `_company_key` 分組
4. 逐一更新每個專案：
   - 刪除舊的 `source_data`
   - 插入新的 `source_data`
   - 重建 `pdf_urls` 對應表
5. 顯示執行摘要

**範例輸出：**
```
🔄 處理專案: GroupA_2345

   專案 ID: 1, 現有 page_offset: 0
   ✅ 已刪除舊資料: 150 筆
   ✅ 已插入新資料: 180 筆
   ✅ 已更新 pdf_urls: 180 個頁面

────────────────────────────────────────────────────────────────────────────────
📋 執行摘要
────────────────────────────────────────────────────────────────────────────────

✅ 成功更新: 25 個專案
❌ 失敗/跳過: 2 個專案

📦 備份位置:
   - ./backups/source_data_backup_2026-01-03T10-30-45-123Z.json
   - ./backups/projects_backup_2026-01-03T10-30-45-123Z.json
```

### 步驟 3: 驗證結果

執行完成後，可以透過以下方式驗證：

```bash
# 查看專案資料筆數
node -e "
import { sql } from '@vercel/postgres';
const result = await sql\`
  SELECT p.name, COUNT(sd.id) as data_count
  FROM projects p
  LEFT JOIN source_data sd ON p.id = sd.project_id
  GROUP BY p.name
  ORDER BY p.name;
\`;
console.table(result.rows);
"
```

或直接在管理後台查看專案資料。

## 🔙 還原備份

如果發現替換後的資料有問題，可以從備份還原：

### 1. 列出可用的備份

```bash
node scripts/restore-from-backup.js
```

輸出：
```
可用的備份:
  - 2026-01-03T10-30-45-123Z
  - 2026-01-02T15-20-30-456Z
```

### 2. 執行還原

```bash
node scripts/restore-from-backup.js 2026-01-03T10-30-45-123Z
```

**執行流程：**
1. 讀取備份檔案
2. 刪除現有的 `source_data`
3. 還原備份的 `source_data`（包含 ID）
4. 還原 `projects` 的 `pdf_urls` 和 `page_offset`

**範例輸出：**
```
📦 還原 source_data...
   已刪除現有資料: 4500 筆
   ✅ 已還原 4200 筆資料

📦 還原 projects (pdf_urls 和 page_offset)...
   ✅ 已還原 25 個專案的 pdf_urls 和 page_offset

────────────────────────────────────────────────────────────────────────────────
✨ 還原完成！
────────────────────────────────────────────────────────────────────────────────
✅ source_data: 4200 筆
✅ projects: 25 個
```

## ⚠️ 注意事項

### 1. 資料完整性

- **備份會自動執行**：每次執行 `replace-all-projects-data.js` 都會自動備份
- **備份包含完整資料**：包括 ID、時間戳等所有欄位
- **還原會覆蓋現有資料**：還原時會先刪除現有資料

### 2. 專案匹配規則

- CSV 的 `_company_key` 必須與 `projects.name` **完全一致**
- 大小寫敏感
- 若找不到對應專案，該筆資料會被跳過並記錄在摘要中

### 3. PDF URLs 重建

- `pdf_urls` 會根據 CSV 中所有該公司的資料重建
- 格式：`{ "1": "url1", "2": "url2", ... }`
- 頁碼來自 CSV 的 `page_number` 欄位

### 4. 現有標註資料

- **標註資料不會被刪除**：`annotations` 表中的資料保持不變
- **但可能會失去關聯**：如果 `source_data` 的 ID 改變，原有的標註會找不到對應的來源資料
- **建議**：如果有重要標註，請先匯出或確認不需要保留

### 5. page_offset

- `page_offset` 不會被修改
- 如果需要調整 `page_offset`，請在替換後手動更新或使用管理後台

## 🛠️ 疑難排解

### 問題 1: CSV 中有些公司找不到對應專案

**症狀：**
```
⚠️  專案不存在，跳過: SomeCompany_1234
```

**解決方式：**
1. 檢查 CSV 中的 `_company_key` 是否正確
2. 檢查資料庫中 `projects` 表的 `name` 欄位
3. 必要時先建立專案或修正 CSV 中的 `_company_key`

### 問題 2: CSV 解析錯誤

**症狀：**
```
❌ 執行過程發生錯誤: ...
```

**解決方式：**
1. 確認 CSV 使用 UTF-8 編碼
2. 確認欄位中的逗號有用引號包覆（例如：`"文本包含,逗號"`）
3. 檢查是否有多餘的空行

### 問題 3: 還原失敗

**症狀：**
```
❌ 找不到備份檔案: ...
```

**解決方式：**
1. 確認備份檔案存在於 `backups/` 目錄
2. 確認時間戳格式正確（包含完整的日期時間）

## 📊 執行前檢查清單

- [ ] CSV 檔案路徑正確（修改腳本中的 `CSV_PATH`）
- [ ] CSV 格式符合要求（包含必要欄位）
- [ ] 已執行預覽腳本並確認變更內容
- [ ] 已確認資料庫連線正常（`.env.local` 設定正確）
- [ ] 已告知使用者系統將暫時無法使用（如有必要）
- [ ] 已確認是否需要保留現有標註資料

## 🔐 安全建議

1. **在正式環境執行前，先在測試環境測試**
2. **保留備份至少 30 天**
3. **記錄每次執行的時間和結果**
4. **定期檢查備份檔案的完整性**

## 📞 需要協助？

如果遇到問題，請檢查：
1. 腳本的執行日誌
2. 備份檔案是否正常產生
3. 資料庫連線是否正常

---

**最後更新：** 2026-01-03
**維護者：** ESG Annotator Team
