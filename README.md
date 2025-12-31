# ESG Annotator App (AI CUP 資料標註系統)

這是一個基於 Next.js 15 的全端資料標註平台，專為 ESG 報告的承諾與驗證標註設計。系統整合了 PDF 瀏覽、標註工具、後端資料庫管理以及管理員後台功能。
>> https://www.aicup-ntpu-esg-annotation-web.space/

---

## 🛠 技術棧 (Tech Stack)

- **Framework**：[Next.js 15 (App Router)](https://nextjs.org/)
- **UI Library**：React 19
- **Database**：Vercel Postgres (SQL)
- **Storage**：Vercel Blob (PDF 檔案儲存)
- **PDF Engine**:
  - Viewer：`pdfjs-dist`
  - Manipulation：`pdf-lib` (用於自動分頁處理)
- **Deployment**：Vercel

---

## 🛠 技術棧 (Tech Stack)

- **Framework**：[Next.js 15 (App Router)](https://nextjs.org/)
- **UI Library**：React 19
- **Database**：Vercel Postgres (SQL)
- **Storage**：Vercel Blob (PDF 檔案儲存)
- **PDF Engine**:
  - Viewer：`pdfjs-dist` (Canvas 渲染)
  - Manipulation：`pdf-lib` (用於後端自動分頁與處理)
- **Deployment**：Vercel

---

## ✨ 主要功能

### 🧑‍💻 標註者端 (Annotator)
- **PDF 互動瀏覽**：支援縮放、換頁、Canvas 渲染與畫框 (Bounding Box) 定位。
- **雙色標註系統**：
  - 🟨 **承諾 (Promise)**：黃色標記。
  - 🟦 **證據 (Evidence)**：藍色標記。
- **智慧驗證邏輯**：
  - 若承諾狀態為 `No`，系統自動將驗證相關欄位填為 `N/A`。
  - 即時檢查資料完整性，自動偵測漏填項目。
- **標註輔助工具**：
  - **⭐ 星號標記 (Star)**：標記不確定或需回顧的題目。
  - **⏭️ 跳過功能 (Skip)**：暫時跳過當前題目，系統標記為「待補」。
  - **資料總覽**：一鍵查看所有題目的狀態（完成/待補/未填/星號）。
  - **快速跳轉**：依題號 (N) 直接跳轉至特定題目。
- **公告系統**：收納式公告介面，支援未讀紅點提醒與 Markdown 格式顯示。

### 👮 管理員端 (Admin)
- **批次資料上傳**：
  - 支援以「組別/公司」結構批次上傳。
  - **自動分頁**：系統自動將整份 PDF 切割為單頁並上傳至 Blob。
- **公司資料管理**：
  - 支援將單一公司的大量數據分配給不同專案 (Projects)。
  - 防止資料範圍重複分配。
- **重標註任務管理 (Re-annotation)**：
  - 針對一致性低 (Alpha 值低) 的資料發布重標註任務。
  - 支援分組標註 (Group 1: 承諾 / Group 2: 證據)。
  - 審計日誌 (Audit Log) 追蹤修改歷程。
- **專案群組與權限**：支援使用者與專案的分組權限控管。

---

## 🚀 本地開發

### 1. 安裝依賴
```bash
npm install
```bash
# 1. 執行資料庫遷移
npm run migrate:reannotation

# 2. 管理員前往 /admin/reannotation 建立輪次
# 3. 標註者前往 /reannotation 處理任務
```

### 2. 環境變數設定 (.env.local)
請確保您的 .env.local 檔案包含以下設定（需從 Vercel 專案設定中取得）：
```bash
POSTGRES_URL="..."
POSTGRES_PRISMA_URL="..."
POSTGRES_URL_NON_POOLING="..."
POSTGRES_USER="..."
POSTGRES_HOST="..."
POSTGRES_PASSWORD="..."
POSTGRES_DATABASE="..."
BLOB_READ_WRITE_TOKEN="vercel_blob_rw_..."
```

### 3. 資料庫初始化 (Migrations)
本專案包含多個功能模組，初次建立請依序執行以下遷移腳本：
```bash
# 1. 建立基礎標註功能 (Skipped 欄位)
npm run migrate:skipped

# 2. 建立重標註功能 (Re-annotation tables)
npm run migrate:reannotation

# 3. 建立公告系統 (Announcements table)
# (需直接執行 node 腳本或檢查 package.json 是否有對應指令)
node scripts/migrate-add-announcements.js

# 4. 其他資料庫結構 (SQL)
# 若需手動建立公司管理與群組功能，請參考 docs/ 內的 .sql 檔案
# 或使用資料庫管理工具執行：
# - scripts/add-company-management.sql
# - scripts/add-project-groups.sql
```

### 4. 資料注入 (Seeding)
**方式 A：本地 CLI 注入 (適用於已切割好的 PDF)**
若您的 data/ 資料夾中已有 page_X.pdf 格式的檔案與 JSON：
```bash
node scripts/upload.js
```
**方式 B：網頁後台批次上傳 (適用於完整 PDF)**
登入管理員帳號後，進入 /admin 頁面使用「批次上傳組別資料」功能，系統會自動處理 PDF 切割。

### 5. 啟動開發伺服器
```bash
npm run dev
```
打開瀏覽器前往 http://localhost:3000。

### 6. 管理公告
```bash
---
title：公告標題
date：YYYY-MM-DD
type：info（藍）/ notice（橘）/ warning（紅色）
---
公告內容支援 **Markdown** 語法。
```

---

## 📂 專案架構概覽
```
esg-annotator-app
├─ 📁.next
├─ 📁.claude
├─ 📁announcements
├─ 📁app
│  ├─ 📁admin                 # 管理員後台頁面
│  │  └─ 📄page.js
│  ├─ 📁api                   # Next.js API Routes (Upload, Re-annotation, etc.)
│  │  └─ 📁upload
│  │     └─ 📄route.js
│  ├─ 📄actions.js            # Server Actions (使用者端邏輯)
│  ├─ 📄adminActions.js       # Server Actions (管理員端邏輯)
│  ├─ 📄favicon.ico
│  ├─ 📄globals.css
│  ├─ 📄layout.js
│  ├─ 📄page.js
│  └─ 📄page.module.css
├─ 📁components
│  └─ 📄PDFViewer.js          # 核心 PDF 瀏覽器元件
├─ 📁docs                                 # 詳細功能手冊
│  ├─ 📄batch-upload-guide.md             # 批次上傳指南
│  ├─ 📄company-data-management-guide.md  # 公司資料管理指南
│  ├─ 📄reannotation-guide.md             # 重標註功能指南
│  └─ ...
├─ 📁public
│  ├─ 📄file.svg
│  ├─ 📄globe.svg
│  ├─ 📄next.svg
│  ├─ 📄pdf.worker.min.mjs
│  ├─ 📄vercel.svg
│  └─ 📄window.svg
├─ 📁scripts                  # 維運與遷移腳本
│  ├─ 📄upload.js             # 資料注入腳本
│  ├─ 📄delete_all_blobs.js   # Blob 清理工具
│  └─ 📄migrate-*.js          # 資料庫遷移腳本
├─ 📄.gitignore
├─ 📄eslint.config.mjs
├─ 📄jsconfig.json
├─ 📄next.config.mjs
├─ 📄package-lock.json
├─ 📄package.json
└─ 📄README.md
```

---

## 📚 參考文件
詳細的操作邏輯與管理員功能，請參閱 docs/ 資料夾下的文件：
* [批次上傳指南](docs/batch-upload-guide.md)
* [公司資料管理指南](docs/company-data-management-guide.md)
* [🔄 重標註功能使用指南](docs/reannotation-guide.md)
