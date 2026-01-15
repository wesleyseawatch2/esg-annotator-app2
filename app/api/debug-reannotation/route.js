import { sql } from '@vercel/postgres';
import { NextResponse } from 'next/server';

export async function GET(request) {
    try {
        // 查詢所有重標註輪次
        const allRounds = await sql`
            SELECT
                rr.id as round_id,
                rr.project_id,
                p.name as project_name,
                pg.name as group_name,
                rr.round_number,
                rr.task_group,
                rr.status,
                rr.created_at,
                COUNT(DISTINCT rt.user_id) as users_count,
                COUNT(DISTINCT rt.source_data_id) as tasks_count,
                COUNT(DISTINCT CASE WHEN rt.status IN ('submitted', 'skipped') THEN rt.user_id END) as completed_users
            FROM reannotation_rounds rr
            JOIN projects p ON rr.project_id = p.id
            LEFT JOIN project_groups pg ON p.group_id = pg.id
            LEFT JOIN reannotation_tasks rt ON rt.round_id = rr.id
            GROUP BY rr.id, rr.project_id, p.name, pg.name, rr.round_number, rr.task_group, rr.status, rr.created_at
            ORDER BY pg.name, p.name, rr.round_number, rr.task_group
        `;

        // 查詢特定專案的詳細資訊
        const targetProjectPattern = '%第二周進度%';
        const targetRounds = await sql`
            SELECT
                rr.id as round_id,
                rr.project_id,
                p.name as project_name,
                pg.name as group_name,
                rr.round_number,
                rr.task_group,
                rr.status,
                rr.created_at,
                rr.threshold
            FROM reannotation_rounds rr
            JOIN projects p ON rr.project_id = p.id
            LEFT JOIN project_groups pg ON p.group_id = pg.id
            WHERE p.name LIKE ${targetProjectPattern}
            ORDER BY rr.round_number, rr.task_group
        `;

        // 查詢該輪次的任務詳情
        const tasksDetails = [];
        for (const round of targetRounds.rows) {
            const tasks = await sql`
                SELECT
                    rt.id as task_id,
                    rt.source_data_id,
                    rt.user_id,
                    u.username,
                    rt.task_group,
                    rt.status,
                    rt.assigned_at,
                    rt.submitted_at
                FROM reannotation_tasks rt
                JOIN users u ON rt.user_id = u.id
                WHERE rt.round_id = ${round.round_id}
                ORDER BY rt.source_data_id, rt.user_id
            `;

            tasksDetails.push({
                round: round,
                tasks: tasks.rows
            });
        }

        return NextResponse.json({
            success: true,
            allRounds: allRounds.rows,
            targetRounds: targetRounds.rows,
            tasksDetails: tasksDetails,
            summary: {
                totalRounds: allRounds.rows.length,
                targetRoundsCount: targetRounds.rows.length
            }
        });
    } catch (error) {
        console.error('查詢重標註資料錯誤:', error);
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
}
