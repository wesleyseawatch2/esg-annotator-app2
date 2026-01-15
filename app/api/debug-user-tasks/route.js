import { sql } from '@vercel/postgres';
import { NextResponse } from 'next/server';

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const username = searchParams.get('username') || 'faisa941206@gmail.com';
        const projectName = searchParams.get('project') || '組2_非資訊相關學士生_半導體產業_第二周進度(aseh_3711)';

        // 查詢該用戶在該專案的所有 reannotation_tasks
        const tasks = await sql`
            SELECT
                rt.id as task_id,
                rt.source_data_id,
                rt.status,
                rt.assigned_at,
                rt.submitted_at,
                rr.round_number,
                rr.task_group
            FROM reannotation_tasks rt
            JOIN reannotation_rounds rr ON rt.round_id = rr.id
            JOIN projects p ON rr.project_id = p.id
            JOIN users u ON rt.user_id = u.id
            WHERE u.username = ${username}
                AND p.name = ${projectName}
            ORDER BY rt.source_data_id, rt.id
        `;

        // 檢查是否有重複的 source_data_id
        const sourceDataCounts = {};
        tasks.rows.forEach(task => {
            const id = task.source_data_id;
            sourceDataCounts[id] = (sourceDataCounts[id] || 0) + 1;
        });

        const duplicates = Object.entries(sourceDataCounts)
            .filter(([id, count]) => count > 1)
            .map(([id, count]) => ({
                source_data_id: id,
                count: count,
                tasks: tasks.rows.filter(t => t.source_data_id === parseInt(id))
            }));

        // 統計資料
        const stats = {
            total_tasks: tasks.rows.length,
            unique_source_data: Object.keys(sourceDataCounts).length,
            submitted_tasks: tasks.rows.filter(t => t.status === 'submitted').length,
            skipped_tasks: tasks.rows.filter(t => t.status === 'skipped').length,
            pending_tasks: tasks.rows.filter(t => t.status === 'pending').length,
            has_duplicates: duplicates.length > 0,
            duplicate_count: duplicates.length
        };

        return NextResponse.json({
            success: true,
            username,
            projectName,
            stats,
            duplicates,
            allTasks: tasks.rows
        });
    } catch (error) {
        console.error('查詢用戶任務錯誤:', error);
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
}
