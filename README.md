# ESG Annotator App (AI CUP 資料標註系統)

這是一個基於 Next.js 15 的全端資料標註平台，專為 ESG 報告的承諾與驗證標註設計。系統整合了 PDF 瀏覽、標註工具、後端資料庫管理以及管理員後台功能。

---

## 🛠 技術棧 (Tech Stack)

- **Framework**: [Next.js 15 (App Router)](https://nextjs.org/)
- **UI Library**: React 19
- **Database**: Vercel Postgres (SQL)
- **Storage**: Vercel Blob (PDF 檔案儲存)
- **PDF Engine**:
  - Viewer: `pdfjs-dist`
  - Manipulation: `pdf-lib` (用於自動分頁處理)
- **Deployment**: Vercel

---

## ✨ 主要功能

### 🧑‍💻 標註者端 (User)
- **PDF 瀏覽器**: 支援縮放、換頁、Canvas 渲染。
- **標註工具**:
  - 承諾 (Promise) 與 證據 (Evidence) 標記。
  - 支援畫框 (Bounding Box) 定位。
  - ESG 類別分類 (E/S/G)。
- **進度追蹤**: 查看個人標註進度與跳過功能。

### 👮‍♂️ 管理員後台 (Admin)
- **專案管理**:
  - 支援單一專案上傳。
  - **批次上傳**: 支援多層資料夾結構，自動將 PDF 分割為單頁並建立對應專案。
  - PDF 頁碼對齊工具。
- **資料分配管理**:
  - 公司資料掃描與建立。
  - 靈活分配資料範圍給不同專案 (Range Assignment)。
- **群組與權限**: 建立專案群組、分配使用者權限。
- **公告系統**: 發布系統公告（支援類型與狀態切換）。
- **資料匯出**: 匯出標註結果為 CSV。

---

## 🚀 快速開始 (Getting Started)

### 1. 安裝依賴
```bash
npm install
```

### 2. 設定環境變數
請在根目錄建立 .env.local 檔案，並填入以下 Vercel 相關設定：
```bash
POSTGRES_URL="postgres://..."
POSTGRES_PRISMA_URL="postgres://..."
POSTGRES_URL_NO_SSL="postgres://..."
POSTGRES_USER="..."
POSTGRES_HOST="..."
POSTGRES_PASSWORD="..."
POSTGRES_DATABASE="..."
BLOB_READ_WRITE_TOKEN="vercel_blob_rw_..."
```

### 3. 資料庫初始化 (Migrations)
如果是首次執行，請執行以下腳本以建立必要的資料表結構：
```bash
# 建立 skipped 欄位
node scripts/migrate-add-skipped.js

# 建立公告功能表
node scripts/migrate-add-announcements.js

# 其他 SQL 初始化請參考 docs/ 資料夾下的 sql 檔案
```

### 4. 啟動開發伺服器
```bash
npm run dev
```
打開瀏覽器前往 http://localhost:3000。
或者，直接前往：https://www.aicup-ntpu-esg-annotation-web.space/

---

## 📂 目前專案架構
```
esg-annotator-app
├─ 📁.next
├─ 📁.claude
├─ 📁app
│  ├─ 📁admin
│  │  └─ 📄page.js
│  ├─ 📁api
│  │  └─ 📁upload
│  │     └─ 📄route.js
│  ├─ 📄actions.js
│  ├─ 📄adminActions.js
│  ├─ 📄favicon.ico
│  ├─ 📄globals.css
│  ├─ 📄layout.js
│  ├─ 📄page.js
│  └─ 📄page.module.css
├─ 📁components
│  └─ 📄PDFViewer.js
├─ 📁docs
│  ├─ 📄batch-upload-guide.md
│  └─ 📄company-data-management-guide.md
├─ 📁public
│  ├─ 📄file.svg
│  ├─ 📄globe.svg
│  ├─ 📄next.svg
│  ├─ 📄pdf.worker.min.mjs
│  ├─ 📄vercel.svg
│  └─ 📄window.svg
├─ 📁scripts
│  ├─ 📄delete_all_blobs.js
│  ├─ 📄delete_bold.js
│  └─ 📄upload.js
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
詳細功能操作請參閱 docs/ 資料夾：
* [批次上傳指南](docs/batch-upload-guide.md)
* [公司資料管理指南](docs/company-data-management-guide.md)
