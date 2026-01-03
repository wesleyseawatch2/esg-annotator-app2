# PDF 載入問題檢查與修復指南

## 🎯 功能概覽

這個工具可以幫助您診斷和修復專案中 PDF 無法正確載入的問題。

## 🔍 如何使用

### 1. 檢查問題

1. 進入管理後台 (`/admin`)
2. 點擊頂部的 **「🔍 檢查 PDF 問題」** 按鈕
3. 系統會掃描所有專案並顯示：
   - 總專案數
   - 正常專案數
   - 有問題的專案數
   - 問題類型統計

### 2. 查看詳情

對於每個有問題的專案，您可以：

- **👁️ 查看詳情**：查看專案的 PDF URLs 配置
- **🔧 自動修復**：讓系統自動從 Vercel Blob 重建 PDF URLs

### 3. 手動編輯 PDF URLs

如果自動修復無法解決問題，您可以手動編輯：

1. 點擊 **「👁️ 查看詳情」**
2. 在彈出的編輯器中，以 JSON 格式編輯 PDF URLs
3. 格式範例：
```json
{
  "1": "https://xxxxx.public.blob.vercel-storage.com/rt_2379_page_1.pdf",
  "2": "https://xxxxx.public.blob.vercel-storage.com/rt_2379_page_2.pdf",
  "3": "https://xxxxx.public.blob.vercel-storage.com/rt_2379_page_3.pdf"
}
```
4. 點擊 **「💾 儲存」**

## 🛠️ 自動修復功能

系統提供**兩種修復模式**，您可以根據情況選擇：

### 📝 檔名修復（傳統方式）

**適用情況**：
- PDF 檔案命名規則正確（例如：`cathay_2882_page_1.pdf`）
- `page_offset` 設定正確
- 問題只是映射遺失或錯誤

**執行步驟**：
1. 掃描 Vercel Blob 中的 PDF 檔案（支援分頁，最多 10,000 個檔案）
2. 智能匹配專案名稱：
   - 先嘗試完整專案名稱匹配
   - 如果失敗，自動提取關鍵部分（例如：`組2_非資訊相關學士生_半導體產業_rt_2379` → `rt_2379`）
3. 從檔案名稱提取頁碼（支援 `page_1.pdf`, `p1.pdf` 等格式）
4. 使用 `page_offset` 計算對應關係
5. 更新資料庫

**優點**：速度快、效率高
**缺點**：依賴檔案命名和 page_offset 設定

---

### 🧠 智能修復（內容匹配）

**適用情況**：
- PDF 檔案命名不規則或頁碼不連續
- `page_offset` 不確定或設定錯誤
- 檔名修復無法解決問題時

**執行步驟**：
1. 掃描 Vercel Blob 中所有匹配的 PDF 檔案
2. 逐筆讀取 `source_data.original_data`（標註資料的原始文字）
3. 對每個 PDF 頁面提取文字內容
4. 使用 **Levenshtein Distance** 計算文字相似度
5. 選擇相似度最高的 PDF 頁面（閾值：0.7）
6. 更新資料庫

**優點**：更準確、不依賴檔案命名
**缺點**：較慢（需要提取 PDF 文字）、消耗更多資源

**相似度計算**：
- 1.0 = 完全相同
- 0.9 = 包含關係（子字串匹配）
- 0.7+ = 高度相似（推薦閾值）
- < 0.7 = 不匹配，設為 null

## 📋 常見問題類型

| 問題類型 | 說明 | 修復方式 |
|---------|------|---------|
| ❌ MISSING_PDF_URLS | pdf_urls 欄位為空 | 自動修復 |
| 📭 EMPTY_PDF_URLS | pdf_urls 是空物件 {} | 自動修復 |
| 🚫 NULL_SOURCE_URLS | source_url 為 null | 自動修復 |
| ⚡ URL_MISMATCH | URL 與預期不符 | 自動修復 |
| 🔗 INVALID_URLS | URL 格式錯誤 | 手動編輯 |
| ⚠️ INVALID_PDF_URLS_JSON | JSON 格式錯誤 | 手動編輯 |

## 🎓 使用範例

### 範例 1: 專案名稱與檔案不匹配

**情況**：
- 專案名稱：`組2_非資訊相關學士生_半導體產業_rt_2379`
- Blob 中的檔案：`rt_2379_page_1.pdf`, `rt_2379_page_2.pdf`, ...

**解決方式**：
點擊 **「📝 檔名修復」**，系統會自動識別並匹配 `rt_2379`

---

### 範例 2: 完全沒有 PDF URLs

**情況**：
- pdf_urls 欄位為 null 或 {}
- Blob 中有對應的 PDF 檔案
- 檔案命名規則正確

**解決方式**：
點擊 **「📝 檔名修復」**（快速），系統會掃描並重建映射

---

### 範例 3: page_offset 設定錯誤或不確定

**情況**：
- PDF 頁碼與 JSON page_number 對應不清楚
- `page_offset` 不確定應該設為多少
- 使用檔名修復後，PDF 內容對不上

**解決方式**：
1. 點擊 **「🧠 智能修復」**
2. 系統會自動比對每筆資料的文字內容與 PDF
3. 不需要設定 page_offset

**範例數據**：
```
JSON data: "本公司致力於減少碳排放..."
系統會在所有 PDF 中搜尋包含此文字的頁面
找到相似度最高的頁面 (例如 page_15.pdf, 相似度 0.95)
自動建立對應關係
```

---

### 範例 4: 檔案命名不規則

**情況**：
- 檔案命名：`cathay_10.pdf`, `cathay_25.pdf`, `cathay_33.pdf`（頁碼不連續）
- 或命名方式：`report_section1.pdf`, `report_section2.pdf`

**解決方式**：
1. 先嘗試 **「📝 檔名修復」**
2. 如果失敗，使用 **「🧠 智能修復」**
3. 智能修復會忽略檔名，純粹根據內容匹配

---

### 範例 5: 需要手動調整

**情況**：
- 兩種自動修復都無法完美解決
- 需要自定義特定頁面的對應

**解決方式**：
1. 點擊 **「👁️ 查看詳情」**
2. 手動編輯 JSON
3. 從 Vercel Blob Browser 複製正確的 URL
4. 儲存

## ⚠️ 注意事項

### 通用注意事項

1. **備份重要**：修復前建議先檢查詳情，確認不會影響現有資料
2. **JSON 格式**：手動編輯時確保 JSON 格式正確
3. **頁碼類型**：頁碼必須是數字（作為物件的 key）
4. **URL 完整性**：URL 必須是完整的 HTTPS 連結

### 檔名修復注意事項

1. **page_offset**：系統會使用 `page_offset` 計算對應關係
2. **檔案命名**：支援 `page_1.pdf`, `p1.pdf`, `_1.pdf` 等格式
3. **速度**：處理速度快，適合大量資料

### 智能修復注意事項

1. **處理時間**：需要下載並提取每個 PDF 的文字，處理時間較長
2. **相似度閾值**：預設 0.7，可以根據需要調整
3. **文字品質**：依賴 PDF 文字提取品質，掃描版 PDF 可能無法正確提取
4. **資源消耗**：會消耗更多網路頻寬和運算資源
5. **適用場景**：特別適合 page_offset 不確定或檔案命名不規則的情況

## 🔧 技術細節

### Page Offset 計算（檔名修復）

```
actualPdfPage = jsonPageNumber + pageOffset
```

例如：
- JSON page_number = 1
- page_offset = 9
- 實際 PDF 頁碼 = 1 + 9 = 10
- 對應 URL = pdf_urls["10"]

### 內容匹配演算法（智能修復）

```javascript
for (每筆 source_data) {
  targetText = source_data.original_data;

  for (每個 PDF 檔案) {
    pdfText = extractTextFromPDF(pdfUrl);
    similarity = calculateSimilarity(targetText, pdfText);

    if (similarity > bestScore) {
      bestScore = similarity;
      bestMatch = PDF 檔案;
    }
  }

  if (bestScore >= 0.7) {
    建立對應關係;
  } else {
    設為 null（找不到匹配）;
  }
}
```

**相似度計算方法**：
- 使用 **Levenshtein Distance**（編輯距離）
- 正規化文字：移除多餘空白、轉小寫
- 檢查子字串包含關係
- 轉換為 0-1 之間的相似度分數

### 檔案命名規則

系統支援以下命名格式：
- `{name}_page_{number}.pdf`
- `{name}_p{number}.pdf`
- `{name}_{number}.pdf`

### API 端點

- `POST /api/check-pdf-issues` - 檢查所有專案的 PDF 問題
- `POST /api/rebuild-pdf-urls` - 自動修復專案的 PDF URLs
  - 參數：`projectId`, `useContentMatching`, `similarityThreshold`
- `POST /api/rebuild-pdf-urls-by-content` - 純內容匹配修復（獨立 API）
- `POST /api/get-project-pdf-urls` - 取得專案的 PDF URLs
- `POST /api/update-project-pdf-urls` - 更新專案的 PDF URLs

### 效能考量

| 項目 | 檔名修復 | 智能修復 |
|------|---------|---------|
| 處理速度 | 快（秒級） | 慢（分鐘級） |
| 網路使用 | 低 | 高（需下載 PDF） |
| CPU 使用 | 低 | 高（文字提取與比對） |
| 記憶體使用 | 低 | 中高 |
| 準確度 | 依賴設定 | 高（基於內容） |
| 適用情況 | 規則資料 | 不規則資料 |

## 📞 需要協助？

如果遇到無法解決的問題：
1. 查看瀏覽器控制台的錯誤訊息
2. 檢查 Vercel Blob Browser 確認檔案存在
3. 確認專案名稱與檔案命名的對應關係
4. 使用手動編輯功能進行細微調整
