import { sql } from '@vercel/postgres';
import { NextResponse } from 'next/server';

export async function GET(request) {
    try {
        // 查詢所有重標註進度，檢查是否有異常
        const progressData = await sql`
            SELECT
                u.id as user_id,
                u.username,
                p.id as project_id,
                p.name as project_name,
                pg.name as group_name,
                rr.round_number,
                rr.task_group,
                COUNT(DISTINCT rt.source_data_id) as total_tasks,
                COUNT(DISTINCT CASE
                    WHEN rt.status IN ('submitted', 'skipped')
                    THEN rt.source_data_id
                END) as completed_tasks,
                COUNT(*) as total_task_records,
                COUNT(CASE WHEN rt.status IN ('submitted', 'skipped') THEN 1 END) as completed_task_records
            FROM reannotation_tasks rt
            JOIN reannotation_rounds rr ON rt.round_id = rr.id
            JOIN projects p ON rr.project_id = p.id
            JOIN users u ON rt.user_id = u.id
            LEFT JOIN project_groups pg ON p.group_id = pg.id
            GROUP BY u.id, u.username, p.id, p.name, pg.name, rr.round_number, rr.task_group
            ORDER BY pg.name, p.name, rr.round_number, rr.task_group, u.username
        `;

        // 找出完成率超過100%的記錄
        const issues = progressData.rows.filter(row => {
            const completionRate = (parseInt(row.completed_tasks) / parseInt(row.total_tasks)) * 100;
            return completionRate > 100;
        });

        // 找出還沒完成的輪次（每個輪次需要3個用戶完成）
        const roundsStatus = await sql`
            SELECT
                p.name as project_name,
                pg.name as group_name,
                rr.round_number,
                rr.task_group,
                COUNT(DISTINCT rt.user_id) as total_users,
                COUNT(DISTINCT CASE WHEN rt.status IN ('submitted', 'skipped') THEN rt.user_id END) as completed_users,
                STRING_AGG(DISTINCT CASE
                    WHEN rt.status IN ('submitted', 'skipped') THEN u.username
                END, ', ') as completed_usernames,
                STRING_AGG(DISTINCT CASE
                    WHEN rt.status NOT IN ('submitted', 'skipped') THEN u.username
                END, ', ') as pending_usernames
            FROM reannotation_rounds rr
            JOIN projects p ON rr.project_id = p.id
            LEFT JOIN project_groups pg ON p.group_id = pg.id
            JOIN reannotation_tasks rt ON rt.round_id = rr.id
            JOIN users u ON rt.user_id = u.id
            GROUP BY p.name, pg.name, rr.round_number, rr.task_group
            ORDER BY pg.name, p.name, rr.round_number, rr.task_group
        `;

        const incompleteRounds = roundsStatus.rows.filter(row =>
            parseInt(row.completed_users) < 3
        );

        return NextResponse.json({
            success: true,
            summary: {
                totalRecords: progressData.rows.length,
                issuesCount: issues.length,
                totalRounds: roundsStatus.rows.length,
                incompleteRoundsCount: incompleteRounds.length
            },
            completionRateIssues: issues,
            incompleteRounds: incompleteRounds,
            allProgress: progressData.rows
        });
    } catch (error) {
        console.error('查詢進度問題錯誤:', error);
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
}
