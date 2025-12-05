-- 新增跳過功能的資料庫遷移腳本

-- 在 annotations 表增加 skipped 欄位
ALTER TABLE annotations
ADD COLUMN IF NOT EXISTS skipped BOOLEAN DEFAULT FALSE;

-- 建立索引以提升查詢效能
CREATE INDEX IF NOT EXISTS idx_annotations_skipped ON annotations(skipped);

-- 執行說明：
-- 請在 Vercel Postgres 或本地資料庫執行此腳本
-- skipped = TRUE 表示該標註被跳過，需要之後補齊
-- skipped = FALSE 或 NULL 表示正常完成的標註
