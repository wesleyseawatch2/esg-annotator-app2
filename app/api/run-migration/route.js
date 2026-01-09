import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';

export async function GET(request) {
    try {
        console.log('Creating global_alpha_cache table...');

        await sql`
            CREATE TABLE IF NOT EXISTS global_alpha_cache (
                id SERIAL PRIMARY KEY,
                project_id INTEGER NOT NULL,
                round_number INTEGER DEFAULT 0,
                task_name TEXT NOT NULL,
                global_alpha NUMERIC(5,3),
                data_count INTEGER,
                calculated_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(project_id, round_number, task_name)
            )
        `;

        console.log('Table created successfully');

        await sql`
            CREATE INDEX IF NOT EXISTS idx_global_alpha_cache_project
            ON global_alpha_cache(project_id, round_number)
        `;

        console.log('Index created successfully');

        return NextResponse.json({
            success: true,
            message: 'Migration completed successfully'
        });

    } catch(error) {
        console.error('Migration error:', error);
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
}
