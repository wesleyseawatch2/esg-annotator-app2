// 檔案路徑: scripts/split-and-upload-pdf.js
// 用途：將單一 PDF 切割成多個單頁 PDF 並上傳到 Vercel Blob

import { config } from 'dotenv';
import { put, list, del } from '@vercel/blob';
import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 載入 .env.local
config({ path: path.join(__dirname, '..', '.env.local') });

async function splitAndUploadPDF(pdfPath, projectName) {
  try {
    console.log(`\n開始處理 PDF: ${pdfPath}`);
    console.log(`專案名稱: ${projectName}`);

    // 讀取 PDF 檔案
    const pdfBytes = fs.readFileSync(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const totalPages = pdfDoc.getPageCount();

    console.log(`PDF 總頁數: ${totalPages}`);

    // 步驟 1: 刪除舊的 PDF 檔案
    console.log(`\n步驟 1: 刪除 blob store 中舊的 ${projectName} PDF 檔案...`);
    await deleteOldPDFs(projectName);

    // 步驟 2: 切割並上傳新的 PDF 檔案
    console.log(`\n步驟 2: 切割並上傳新的 PDF 檔案...`);
    const uploadedUrls = [];

    for (let i = 0; i < totalPages; i++) {
      const pageNumber = i + 1;
      console.log(`\n處理第 ${pageNumber}/${totalPages} 頁...`);

      // 創建新的 PDF 文件，只包含當前頁
      const newPdf = await PDFDocument.create();
      const [copiedPage] = await newPdf.copyPages(pdfDoc, [i]);
      newPdf.addPage(copiedPage);

      // 生成 PDF 二進制數據
      const newPdfBytes = await newPdf.save();

      // 上傳到 Vercel Blob
      const fileName = `${projectName}_page_${pageNumber}.pdf`;
      console.log(`  上傳檔案: ${fileName}`);

      const blob = await put(fileName, newPdfBytes, {
        access: 'public',
        contentType: 'application/pdf'
      });

      uploadedUrls.push({
        page: pageNumber,
        fileName: fileName,
        url: blob.url
      });

      console.log(`  ✓ 第 ${pageNumber} 頁上傳成功`);
    }

    console.log(`\n所有 ${totalPages} 頁上傳完成！`);
    console.log('\n上傳的檔案清單:');
    uploadedUrls.forEach(item => {
      console.log(`  第 ${item.page} 頁: ${item.fileName}`);
    });

    return uploadedUrls;

  } catch (error) {
    console.error('處理 PDF 時發生錯誤:', error);
    throw error;
  }
}

async function deleteOldPDFs(projectName) {
  try {
    // 列出所有 blob 檔案
    let allBlobs = [];
    let cursor;
    let hasMore = true;

    while (hasMore) {
      const listResult = cursor
        ? await list({ limit: 1000, cursor })
        : await list({ limit: 1000 });

      allBlobs = allBlobs.concat(listResult.blobs);
      cursor = listResult.cursor;
      hasMore = listResult.hasMore || false;
    }

    // 找出屬於該專案的 PDF 檔案
    const projectPdfs = allBlobs.filter(blob => {
      return blob.pathname.includes(projectName) && blob.pathname.endsWith('.pdf');
    });

    console.log(`找到 ${projectPdfs.length} 個舊的 ${projectName} PDF 檔案`);

    // 刪除這些檔案
    let deletedCount = 0;
    for (const blob of projectPdfs) {
      console.log(`  刪除: ${blob.pathname}`);
      await del(blob.url);
      deletedCount++;
    }

    console.log(`已刪除 ${deletedCount} 個舊檔案`);
    return deletedCount;

  } catch (error) {
    console.error('刪除舊 PDF 檔案時發生錯誤:', error);
    throw error;
  }
}

// 主程式
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log('使用方法: node split-and-upload-pdf.js <PDF路徑> <專案名稱>');
    console.log('範例: node split-and-upload-pdf.js "C:\\path\\to\\pdf.pdf" pegatron_4938');
    process.exit(1);
  }

  const pdfPath = args[0];
  const projectName = args[1];

  // 檢查檔案是否存在
  if (!fs.existsSync(pdfPath)) {
    console.error(`錯誤: 找不到檔案 ${pdfPath}`);
    process.exit(1);
  }

  await splitAndUploadPDF(pdfPath, projectName);
  console.log('\n✓ 所有操作完成！');
}

main();
