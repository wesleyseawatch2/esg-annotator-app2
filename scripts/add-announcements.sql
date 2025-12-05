-- 新增公告功能的資料庫遷移腳本

-- 建立 announcements 表
CREATE TABLE IF NOT EXISTS announcements (
    id SERIAL PRIMARY KEY,
    title VARCHAR(200) NOT NULL,
    content TEXT NOT NULL,
    type VARCHAR(20) DEFAULT 'info', -- info, warning, success, error
    is_active BOOLEAN DEFAULT TRUE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 建立索引以提升查詢效能
CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements(is_active);
CREATE INDEX IF NOT EXISTS idx_announcements_created_at ON announcements(created_at DESC);

-- 執行說明：
-- 請在 Vercel Postgres 或本地資料庫執行此腳本
-- type: info=一般訊息(藍色), warning=警告(橘色), success=成功(綠色), error=錯誤(紅色)
-- is_active: TRUE=顯示公告, FALSE=隱藏公告
