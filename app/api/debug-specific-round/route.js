import { sql } from '@vercel/postgres';
import { NextResponse } from 'next/server';

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const roundId = searchParams.get('roundId') || '16';

        // 查詢輪次基本資訊
        const roundInfo = await sql`
            SELECT
                rr.id as round_id,
                rr.project_id,
                p.name as project_name,
                pg.name as group_name,
                rr.round_number,
                rr.task_group,
                rr.status
            FROM reannotation_rounds rr
            JOIN projects p ON rr.project_id = p.id
            LEFT JOIN project_groups pg ON p.group_id = pg.id
            WHERE rr.id = ${roundId}
        `;

        // 查詢任務統計
        const taskStats = await sql`
            SELECT
                COUNT(DISTINCT rt.user_id) as total_users,
                COUNT(DISTINCT rt.source_data_id) as total_sources,
                COUNT(DISTINCT CASE WHEN rt.status IN ('submitted', 'skipped') THEN rt.user_id END) as completed_users,
                COUNT(DISTINCT CASE WHEN rt.status IN ('submitted', 'skipped') THEN rt.source_data_id END) as completed_sources,
                COUNT(*) as total_tasks,
                COUNT(CASE WHEN rt.status IN ('submitted', 'skipped') THEN 1 END) as completed_tasks
            FROM reannotation_tasks rt
            WHERE rt.round_id = ${roundId}
        `;

        // 查詢每個用戶的完成狀況
        const userStats = await sql`
            SELECT
                u.id as user_id,
                u.username,
                COUNT(*) as total_tasks,
                COUNT(CASE WHEN rt.status = 'submitted' THEN 1 END) as submitted_tasks,
                COUNT(CASE WHEN rt.status = 'skipped' THEN 1 END) as skipped_tasks,
                COUNT(CASE WHEN rt.status = 'pending' THEN 1 END) as pending_tasks
            FROM reannotation_tasks rt
            JOIN users u ON rt.user_id = u.id
            WHERE rt.round_id = ${roundId}
            GROUP BY u.id, u.username
            ORDER BY u.username
        `;

        // 查詢是否符合匯出條件（至少3個用戶完成）
        const exportCheck = await sql`
            SELECT
                rr.id as round_id,
                COUNT(DISTINCT rt.user_id) as users_with_completed_tasks
            FROM reannotation_rounds rr
            JOIN reannotation_tasks rt ON rt.round_id = rr.id
            WHERE rr.id = ${roundId}
                AND rt.status IN ('submitted', 'skipped')
            GROUP BY rr.id
            HAVING COUNT(DISTINCT rt.user_id) >= 3
        `;

        // 查詢實際的標註資料（使用混合邏輯）
        if (roundInfo.rows.length > 0) {
            const round = roundInfo.rows[0];
            const annotationsCount = await sql`
                WITH reannotated_data AS (
                    SELECT DISTINCT ON (a.source_data_id, a.user_id)
                        a.source_data_id,
                        a.user_id,
                        a.status,
                        a.skipped
                    FROM annotations a
                    JOIN source_data sd ON a.source_data_id = sd.id
                    WHERE sd.project_id = ${round.project_id}
                        AND a.reannotation_round = ${round.round_number}
                    ORDER BY a.source_data_id, a.user_id, a.version DESC, a.created_at DESC
                ),
                original_data AS (
                    SELECT DISTINCT ON (a.source_data_id, a.user_id)
                        a.source_data_id,
                        a.user_id,
                        a.status,
                        a.skipped
                    FROM annotations a
                    JOIN source_data sd ON a.source_data_id = sd.id
                    WHERE sd.project_id = ${round.project_id}
                        AND a.reannotation_round = 0
                        AND a.source_data_id NOT IN (
                            SELECT DISTINCT source_data_id
                            FROM reannotated_data
                        )
                    ORDER BY a.source_data_id, a.user_id, a.version DESC, a.created_at DESC
                )
                SELECT
                    COUNT(*) as total_annotations,
                    COUNT(CASE WHEN status = 'completed' AND (skipped IS NULL OR skipped = FALSE) THEN 1 END) as completed_annotations,
                    COUNT(DISTINCT source_data_id) as unique_sources,
                    COUNT(DISTINCT user_id) as unique_users
                FROM (
                    SELECT * FROM reannotated_data
                    UNION ALL
                    SELECT * FROM original_data
                ) merged
            `;

            return NextResponse.json({
                success: true,
                roundInfo: roundInfo.rows[0],
                taskStats: taskStats.rows[0],
                userStats: userStats.rows,
                exportCheck: {
                    meetsRequirement: exportCheck.rows.length > 0,
                    details: exportCheck.rows[0] || null
                },
                annotationsCount: annotationsCount.rows[0]
            });
        }

        return NextResponse.json({
            success: false,
            error: 'Round not found'
        });
    } catch (error) {
        console.error('查詢重標註輪次錯誤:', error);
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
}
