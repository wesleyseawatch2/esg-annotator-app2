-- 新增公司管理功能的資料表
-- 用途：追蹤公司資料並防止重複分配

-- 1. 建立公司主表
CREATE TABLE IF NOT EXISTS companies (
  id SERIAL PRIMARY KEY,
  code VARCHAR(100) NOT NULL,              -- 公司代碼 (從專案名稱提取)
  name VARCHAR(255),                        -- 公司名稱
  group_name VARCHAR(255),                  -- 所屬組別
  total_records INTEGER DEFAULT 0,          -- 總資料筆數
  assigned_records INTEGER DEFAULT 0,       -- 已分配筆數
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(code, group_name)                  -- 同組別下公司代碼必須唯一
);

-- 2. 建立公司資料分配表 (追蹤哪些資料範圍被分配到哪個專案)
CREATE TABLE IF NOT EXISTS company_data_assignments (
  id SERIAL PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  start_record INTEGER NOT NULL,            -- 起始記錄編號 (1-based)
  end_record INTEGER NOT NULL,              -- 結束記錄編號 (inclusive)
  record_count INTEGER NOT NULL,            -- 分配的記錄數量
  assigned_at TIMESTAMP DEFAULT NOW(),

  CHECK (start_record > 0),
  CHECK (end_record >= start_record),
  CHECK (record_count = end_record - start_record + 1)
);

-- 3. 建立索引以提升查詢效能
CREATE INDEX IF NOT EXISTS idx_company_code ON companies(code);
CREATE INDEX IF NOT EXISTS idx_company_group ON companies(group_name);
CREATE INDEX IF NOT EXISTS idx_assignments_company ON company_data_assignments(company_id);
CREATE INDEX IF NOT EXISTS idx_assignments_project ON company_data_assignments(project_id);

-- 4. 建立觸發器：自動更新 updated_at 欄位
CREATE OR REPLACE FUNCTION update_companies_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW
  EXECUTE FUNCTION update_companies_updated_at();

-- 5. 新增註解
COMMENT ON TABLE companies IS '公司主表，追蹤所有公司的資料狀況';
COMMENT ON TABLE company_data_assignments IS '公司資料分配記錄，追蹤資料範圍分配並防止重複';
COMMENT ON COLUMN company_data_assignments.start_record IS '起始記錄編號 (1-based index)';
COMMENT ON COLUMN company_data_assignments.end_record IS '結束記錄編號 (inclusive)';
