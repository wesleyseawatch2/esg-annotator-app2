// 執行重標註功能的資料庫遷移
import { sql } from '@vercel/postgres';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function migrate() {
  try {
    console.log('開始執行重標註功能資料庫遷移...\n');

    // 1. 在 annotations 表增加重標註相關欄位
    console.log('步驟 1/6: 新增 annotations 表欄位...');
    await sql`
      ALTER TABLE annotations
      ADD COLUMN IF NOT EXISTS reannotation_round INTEGER DEFAULT 0,
      ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1,
      ADD COLUMN IF NOT EXISTS last_agreement_score JSONB DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS persist_answer BOOLEAN DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS reannotation_comment TEXT
    `;
    console.log('✓ annotations 表欄位新增完成');

    // 2. 建立重標註任務表
    console.log('\n步驟 2/6: 建立 reannotation_rounds 表...');
    await sql`
      CREATE TABLE IF NOT EXISTS reannotation_rounds (
        id SERIAL PRIMARY KEY,
        project_id INTEGER NOT NULL,
        round_number INTEGER NOT NULL,
        task_group TEXT NOT NULL,
        threshold NUMERIC(3,2) DEFAULT 0.50,
        created_at TIMESTAMP DEFAULT NOW(),
        created_by INTEGER,
        status TEXT DEFAULT 'active',
        completed_at TIMESTAMP,
        UNIQUE(project_id, round_number, task_group)
      )
    `;
    console.log('✓ reannotation_rounds 表建立完成');

    // 3. 建立重標註任務分配表
    console.log('\n步驟 3/6: 建立 reannotation_tasks 表...');
    await sql`
      CREATE TABLE IF NOT EXISTS reannotation_tasks (
        id SERIAL PRIMARY KEY,
        round_id INTEGER NOT NULL REFERENCES reannotation_rounds(id) ON DELETE CASCADE,
        source_data_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        task_group TEXT NOT NULL,
        tasks_flagged JSONB NOT NULL,
        status TEXT DEFAULT 'pending',
        assigned_at TIMESTAMP DEFAULT NOW(),
        submitted_at TIMESTAMP,
        UNIQUE(round_id, source_data_id, user_id)
      )
    `;
    console.log('✓ reannotation_tasks 表建立完成');

    // 4. 建立一致性分數快取表
    console.log('\n步驟 4/6: 建立 agreement_scores_cache 表...');
    await sql`
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
      )
    `;
    console.log('✓ agreement_scores_cache 表建立完成');

    // 5. 建立審計日誌表
    console.log('\n步驟 5/6: 建立 reannotation_audit_log 表...');
    await sql`
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
      )
    `;
    console.log('✓ reannotation_audit_log 表建立完成');

    // 6. 建立索引
    console.log('\n步驟 6/6: 建立索引...');
    await sql`CREATE INDEX IF NOT EXISTS idx_annotations_round ON annotations(reannotation_round)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_annotations_version ON annotations(version)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_reannotation_rounds_project ON reannotation_rounds(project_id, status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_reannotation_tasks_user ON reannotation_tasks(user_id, status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_reannotation_tasks_round ON reannotation_tasks(round_id, status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_agreement_cache_project ON agreement_scores_cache(project_id, round_number)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_audit_log_user_time ON reannotation_audit_log(user_id, changed_at)`;
    console.log('✓ 所有索引建立完成');

    console.log('\n✅ 重標註功能資料庫遷移完成！');
    console.log('\n已建立:');
    console.log('  ✓ annotations 表新增欄位 (reannotation_round, version, last_agreement_score, persist_answer, reannotation_comment)');
    console.log('  ✓ reannotation_rounds 表 (重標註輪次)');
    console.log('  ✓ reannotation_tasks 表 (任務分配)');
    console.log('  ✓ agreement_scores_cache 表 (分數快取)');
    console.log('  ✓ reannotation_audit_log 表 (審計日誌)');
    console.log('  ✓ 7 個索引');

  } catch (error) {
    console.error('\n❌ 遷移失敗:', error.message);
    console.error('\n詳細錯誤:', error);
    process.exit(1);
  }
}

migrate();
