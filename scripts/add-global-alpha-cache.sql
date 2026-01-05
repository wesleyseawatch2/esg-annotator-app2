-- Add table to cache global alpha values for faster dashboard loading

CREATE TABLE IF NOT EXISTS global_alpha_cache (
    id SERIAL PRIMARY KEY,
    project_id INTEGER NOT NULL,
    round_number INTEGER DEFAULT 0,
    task_name TEXT NOT NULL,
    global_alpha NUMERIC(5,3),
    data_count INTEGER,
    calculated_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(project_id, round_number, task_name)
);

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_global_alpha_cache_project ON global_alpha_cache(project_id, round_number);

-- Migration note:
-- This table stores global Krippendorff's Alpha values per (project, round, task)
-- to avoid recalculating when loading cached results in the dashboard
