import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export async function GET(request) {
    try {
        console.log('Running reannotation feature migration...');

        // 1. Add columns to annotations table
        await sql`
            ALTER TABLE annotations
            ADD COLUMN IF NOT EXISTS reannotation_round INTEGER DEFAULT 0,
            ADD COLUMN IF NOT EXISTS version INTEGER DEFAULT 1,
            ADD COLUMN IF NOT EXISTS last_agreement_score JSONB DEFAULT '{}',
            ADD COLUMN IF NOT EXISTS persist_answer BOOLEAN DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS reannotation_comment TEXT
        `;
        console.log('Added columns to annotations table');

        // 2. Create reannotation_rounds table
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
        console.log('Created reannotation_rounds table');

        // 3. Create reannotation_tasks table
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
        console.log('Created reannotation_tasks table');

        // 4. Create agreement_scores_cache table
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
        console.log('Created agreement_scores_cache table');

        // 5. Create reannotation_audit_log table
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
        console.log('Created reannotation_audit_log table');

        // 6. Create indexes
        await sql`CREATE INDEX IF NOT EXISTS idx_annotations_round ON annotations(reannotation_round)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_annotations_version ON annotations(version)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_reannotation_rounds_project ON reannotation_rounds(project_id, status)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_reannotation_tasks_user ON reannotation_tasks(user_id, status)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_reannotation_tasks_round ON reannotation_tasks(round_id, status)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_agreement_cache_project ON agreement_scores_cache(project_id, round_number)`;
        await sql`CREATE INDEX IF NOT EXISTS idx_audit_log_user_time ON reannotation_audit_log(user_id, changed_at)`;
        console.log('Created all indexes');

        return NextResponse.json({
            success: true,
            message: 'Reannotation feature migration completed successfully'
        });

    } catch(error) {
        console.error('Migration error:', error);
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
}
