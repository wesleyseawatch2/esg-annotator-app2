-- 在 annotations 表加入 save_count 欄位來追蹤儲存次數
-- 每次 saveAnnotation 時會 +1

-- 1. 添加 save_count 欄位，預設值為 0
ALTER TABLE annotations
ADD COLUMN IF NOT EXISTS save_count INTEGER DEFAULT 0;

-- 2. 為現有資料初始化 save_count
-- 根據 reannotation_audit_log 來推算已經儲存過幾次
UPDATE annotations a
SET save_count = (
    SELECT COUNT(DISTINCT changed_at)
    FROM reannotation_audit_log r
    WHERE r.source_data_id = a.source_data_id
    AND r.user_id = a.user_id
)
WHERE EXISTS (
    SELECT 1
    FROM reannotation_audit_log r
    WHERE r.source_data_id = a.source_data_id
    AND r.user_id = a.user_id
);

-- 3. 為沒有重標註記錄的資料設定 save_count = 1 (代表初次標註)
UPDATE annotations
SET save_count = 1
WHERE save_count = 0 AND status = 'completed';

-- 4. 建立索引以提升查詢效能
CREATE INDEX IF NOT EXISTS idx_annotations_save_count ON annotations(save_count);
