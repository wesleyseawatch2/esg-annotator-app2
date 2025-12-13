-- ===================================================================
-- 重標註功能 (Re-annotation) 資料庫遷移腳本
-- 方案 A: 顯示統計資訊 + 指引摘要 (不顯示他人答案)
-- ===================================================================

-- 1. 在 annotations 表增加重標註相關欄位
ALTER TABLE annotations
ADD COLUMN IF NOT EXISTS reannotation_round INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS last_agreement_score JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS persist_answer BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS reannotation_comment TEXT;

-- 2. 建立重標註任務表 (記錄每一輪的重標註任務)
CREATE TABLE IF NOT EXISTS reannotation_rounds (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL,
    round_number INTEGER NOT NULL,
    task_group TEXT NOT NULL, -- 'group1' (promise+timeline) 或 'group2' (evidence)
    threshold NUMERIC(3,2) DEFAULT 0.50,
    created_at TIMESTAMP DEFAULT NOW(),
    created_by INTEGER,
    status TEXT DEFAULT 'active', -- 'active', 'completed', 'cancelled'
    completed_at TIMESTAMP,
    UNIQUE(project_id, round_number, task_group)
);

-- 3. 建立重標註任務分配表 (記錄哪些資料需要重標註)
CREATE TABLE IF NOT EXISTS reannotation_tasks (
    id SERIAL PRIMARY KEY,
    round_id INTEGER NOT NULL REFERENCES reannotation_rounds(id) ON DELETE CASCADE,
    source_data_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    task_group TEXT NOT NULL,
    tasks_flagged JSONB NOT NULL, -- {"promise_status": 0.32, "verification_timeline": 0.45}
    status TEXT DEFAULT 'pending', -- 'pending', 'in_progress', 'submitted', 'skipped'
    assigned_at TIMESTAMP DEFAULT NOW(),
    submitted_at TIMESTAMP,
    UNIQUE(round_id, source_data_id, user_id)
);

-- 4. 建立一致性分數快取表 (避免重複計算)
CREATE TABLE IF NOT EXISTS agreement_scores_cache (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL,
    source_data_id INTEGER NOT NULL,
    round_number INTEGER DEFAULT 0,
    task_name TEXT NOT NULL,
    local_score NUMERIC(5,3),
    annotators_count INTEGER,
    calculated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(project_id, source_data_id, round_number, task_name)
);

-- 5. 建立審計日誌表 (記錄所有標註修改)
CREATE TABLE IF NOT EXISTS reannotation_audit_log (
    id SERIAL PRIMARY KEY,
    source_data_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    task_name TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    round_number INTEGER,
    changed_at TIMESTAMP DEFAULT NOW(),
    change_reason TEXT
);

-- 6. 建立索引以提升查詢效能
CREATE INDEX IF NOT EXISTS idx_annotations_round ON annotations(reannotation_round);
CREATE INDEX IF NOT EXISTS idx_annotations_version ON annotations(version);
CREATE INDEX IF NOT EXISTS idx_reannotation_rounds_project ON reannotation_rounds(project_id, status);
CREATE INDEX IF NOT EXISTS idx_reannotation_tasks_user ON reannotation_tasks(user_id, status);
CREATE INDEX IF NOT EXISTS idx_reannotation_tasks_round ON reannotation_tasks(round_id, status);
CREATE INDEX IF NOT EXISTS idx_agreement_cache_project ON agreement_scores_cache(project_id, round_number);
CREATE INDEX IF NOT EXISTS idx_audit_log_user_time ON reannotation_audit_log(user_id, changed_at);

-- 執行說明：
-- 1. reannotation_round: 標註是在第幾輪產生的 (0=初始標註, 1+=重標註)
-- 2. version: 同一輪內的版本號 (每次修改+1)
-- 3. last_agreement_score: 該標註最後一次計算的局部分數 (JSONB格式)
-- 4. persist_answer: 使用者勾選「我堅持此答案」
-- 5. task_group: 分組策略 (group1=承諾+時間, group2=證據狀態+品質)
