# 批次上傳組別資料功能使用指南

## 功能概述

此功能允許管理員一次上傳多個組別的公司資料，系統會：
- **自動分割 PDF**：將完整 PDF 檔案分割成單頁並上傳到 Vercel Blob
- **自動命名專案**：格式為 `{組別名稱}_{公司名稱}`
- **自動建立頁碼對應**：JSON 資料中的頁碼自動對應到分割後的 PDF URL
- **批次處理**：一次處理多個組別和公司

## 資料夾結構要求

```
company_data_by_annotation_group/          ← 根資料夾（可以是任何名稱）
├── 組別1/                                  ← 第一層：組別資料夾
│   ├── 公司A/                              ← 第二層：公司資料夾
│   │   ├── annotation.json               ← JSON 標註檔案
│   │   └── report.pdf                    ← PDF 報告（會被自動分頁）
│   └── 公司B/
│       ├── data.json
│       └── esg_report.pdf
├── 組別2/
│   ├── 公司C/
│   │   ├── esg_data.json
│   │   └── report_2024.pdf
│   └── 公司D/
│       ├── annotation.json
│       ├── report_part1.pdf              ← 支援多個 PDF
│       └── report_part2.pdf              ← 會合併所有頁面
...
└── 組別8/
    └── ...
```

### 重要說明：

1. **至少三層結構**：根資料夾 → 組別 → 公司 → 檔案
2. **每個公司資料夾**必須包含：
   - 至少一個 `.json` 檔案（標註資料）
   - 至少一個 `.pdf` 檔案（報告）
3. **檔案名稱**：JSON 和 PDF 可以是任何名稱
4. **多個 PDF**：如果有多個 PDF，系統會自動合併所有頁面

## JSON 格式要求

每個 JSON 檔案應包含一個陣列，格式如下：

```json
[
  {
    "data": "公司承諾在2030年前達成淨零排放目標。",
    "page_number": 1,
    "bbox": [100, 200, 500, 250]
  },
  {
    "data": "已投資5000萬元於綠能設備。",
    "page_number": 3,
    "bbox": [100, 300, 500, 350]
  }
]
```

### 欄位說明：
- `data`（必填）：標註的文字內容
- `page_number`（選填）：頁碼，預設為 1
- `bbox`（選填）：文字邊界框 [x0, y0, x1, y1]

## 使用步驟

### 1. 安裝相依套件

首次使用前需要安裝 `pdf-lib` 套件：

```bash
npm install
```

### 2. 進入管理後台

1. 使用管理員帳號登入系統
2. 在專案選擇頁面點擊「管理後台」按鈕

### 3. 批次上傳

1. 找到「📦 批次上傳組別資料（含 PDF 自動分頁）」區塊（綠色背景）
2. 點擊「選擇根資料夾」按鈕
3. 選擇包含所有組別的根資料夾（例如：`company_data_by_annotation_group`）
4. 確認顯示的檔案數量
5. 點擊「🚀 開始批次上傳」按鈕

### 4. 查看上傳結果

上傳完成後會顯示詳細結果表格：
- ✅ **成功的專案**：顯示匯入的資料筆數
- ❌ **失敗的專案**：顯示錯誤原因

### 5. 驗證與調整

1. 在「專案列表」中查看新建立的專案
2. 如需調整 PDF 頁碼對應，可使用「🎯 調整對齊」功能

## 專案命名規則

系統自動組合專案名稱：

- **組別資料夾名稱**：Group1
- **公司資料夾名稱**：CompanyA
- **生成專案名稱**：`Group1_CompanyA`

## 處理流程說明

```
1. 選擇資料夾
   └─ 系統掃描所有檔案並按路徑分組

2. 處理每個公司（並行處理）
   ├─ 讀取 JSON 資料
   ├─ 分割 PDF 成單頁
   │  ├─ 使用 pdf-lib 提取每一頁
   │  └─ 上傳到 Vercel Blob
   ├─ 建立頁碼 → URL 對應表
   └─ 儲存到資料庫

3. 建立專案記錄
   ├─ projects 表：專案資訊 + PDF URLs
   └─ source_data 表：JSON 資料 + 對應的 PDF URL

4. 顯示結果
   └─ 成功/失敗統計 + 詳細訊息
```

## 資料庫結構

### projects 表
```sql
id              | 專案 ID
name            | 專案名稱（組別_公司）
page_offset     | 頁碼偏移（預設 0）
pdf_urls        | JSON 格式：{ "1": "url1", "2": "url2", ... }
```

### source_data 表
```sql
id              | 資料 ID
project_id      | 關聯到 projects
original_data   | JSON 中的文字內容
source_url      | 對應頁碼的 PDF URL
page_number     | 頁碼
bbox            | 邊界框座標
```

## 範例：實際操作

假設你有以下結構：

```
C:\Users\wesley\OneDrive\桌面\LAB\ai_cup\company_data_by_annotation_group\
├── 第一組/
│   ├── 台積電/
│   │   ├── tsmc_2024.json
│   │   └── tsmc_esg.pdf (50頁)
│   └── 聯發科/
│       ├── mtk_data.json
│       └── mtk_report.pdf (30頁)
└── 第二組/
    └── 鴻海/
        ├── foxconn.json
        └── foxconn_esg.pdf (40頁)
```

上傳後會建立 3 個專案：
1. `第一組_台積電`（50 頁 PDF，每頁獨立 URL）
2. `第一組_聯發科`（30 頁 PDF，每頁獨立 URL）
3. `第二組_鴻海`（40 頁 PDF，每頁獨立 URL）

## 常見問題

### Q1: 上傳需要多久時間？
**A:** 取決於 PDF 數量和大小。一個 50 頁的 PDF 需要約 2-3 分鐘（分割 + 上傳）。

### Q2: 如果某個公司上傳失敗會怎樣？
**A:** 系統會跳過該公司並繼續處理其他公司，最後在結果表格中顯示失敗原因。

### Q3: 可以重複上傳同一個專案嗎？
**A:** 可以。如果專案名稱已存在，系統會更新專案資料。重複的 `original_data` 不會重複插入。

### Q4: PDF 頁碼對應不正確怎麼辦？
**A:** 使用「🎯 調整對齊」功能，視覺化比對後調整 `page_offset` 參數。

### Q5: 支援什麼格式的 PDF？
**A:** 支援所有標準 PDF 格式。如果 PDF 有密碼保護或損壞，上傳會失敗。

### Q6: 可以上傳多少個專案？
**A:** 沒有數量限制，但建議分批上傳以避免瀏覽器超時。

## 技術細節

### PDF 分頁原理
使用 `pdf-lib` 套件：
```javascript
1. 載入完整 PDF
2. 取得總頁數
3. 為每一頁建立新的 PDF 文件
4. 複製該頁到新文件
5. 儲存為獨立的 PDF bytes
6. 上傳到 Vercel Blob
```

### 檔案路徑解析
使用 `webkitRelativePath` 屬性：
```javascript
// 範例：company_data/Group1/CompanyA/data.json
pathParts = ['company_data', 'Group1', 'CompanyA', 'data.json']
groupName = pathParts[1]      // 'Group1'
companyName = pathParts[2]    // 'CompanyA'
projectName = 'Group1_CompanyA'
```

## 對比：單一上傳 vs 批次上傳

| 功能 | 單一上傳 | 批次上傳 |
|-----|---------|---------|
| 一次處理 | 1 個專案 | 多個專案 |
| PDF 格式要求 | 已分頁（page_1.pdf, page_2.pdf...） | 完整 PDF（自動分頁） |
| 適用場景 | 單一公司資料 | 多組多公司資料 |
| 操作步驟 | 選擇 JSON + PDF 資料夾 | 選擇根資料夾 |
| 處理時間 | 快（PDF 已分好） | 較慢（需分割 PDF） |

## 注意事項

1. **網路連線**：確保穩定的網路連線，上傳大量 PDF 需要時間
2. **瀏覽器限制**：Chrome/Edge 對檔案選擇器支援最佳
3. **記憶體使用**：處理大型 PDF 會使用較多記憶體
4. **環境變數**：確認 `.env.local` 包含正確的 `BLOB_READ_WRITE_TOKEN`

## 疑難排解

### 錯誤：找不到 JSON 檔案
**原因**：公司資料夾內沒有 `.json` 檔案
**解決**：確認每個公司資料夾都有至少一個 JSON 檔案

### 錯誤：PDF 分割失敗
**原因**：PDF 檔案損壞或加密
**解決**：檢查 PDF 是否可正常開啟，移除密碼保護

### 錯誤：上傳到 Blob 失敗
**原因**：Token 無效或網路問題
**解決**：檢查 `.env.local` 中的 `BLOB_READ_WRITE_TOKEN`

### 錯誤：資料庫連線失敗
**原因**：PostgreSQL 連線問題
**解決**：檢查 `.env.local` 中的 `POSTGRES_URL`

## 相關檔案

- **前端介面**：[app/admin/page.js](../app/admin/page.js) (line 862-959)
- **後端處理**：[app/adminActions.js](../app/adminActions.js) (line 344-503)
- **套件設定**：[package.json](../package.json)

## 更新記錄

- **2025-11-30**：新增批次上傳組別資料功能
  - 整合 pdf-lib 自動分頁
  - 支援多層資料夾結構
  - 新增上傳結果詳細報告
