import { sql } from '@vercel/postgres';
import { NextResponse } from 'next/server';

export async function GET(request) {
    try {
        // 查詢所有應該被匯出的重標註輪次
        const shouldExport = await sql`
            SELECT
                rr.id as round_id,
                rr.project_id,
                p.name as project_name,
                pg.name as group_name,
                rr.round_number,
                rr.task_group,
                COUNT(DISTINCT rt.user_id) as users_with_completed_tasks
            FROM reannotation_rounds rr
            JOIN projects p ON rr.project_id = p.id
            LEFT JOIN project_groups pg ON p.group_id = pg.id
            JOIN reannotation_tasks rt ON rt.round_id = rr.id
            WHERE rt.status IN ('submitted', 'skipped')
            GROUP BY rr.id, rr.project_id, p.name, pg.name, rr.round_number, rr.task_group
            HAVING COUNT(DISTINCT rt.user_id) >= 3
            ORDER BY pg.name, p.name, rr.round_number, rr.task_group
        `;

        // 查詢每個輪次實際有多少標註資料（使用混合邏輯）
        const roundsWithData = [];
        for (const round of shouldExport.rows) {
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
                    COUNT(CASE WHEN status = 'completed' AND (skipped IS NULL OR skipped = FALSE) THEN 1 END) as completed_annotations
                FROM (
                    SELECT * FROM reannotated_data
                    UNION ALL
                    SELECT * FROM original_data
                ) merged
            `;

            roundsWithData.push({
                ...round,
                completed_annotations: parseInt(annotationsCount.rows[0].completed_annotations)
            });
        }

        return NextResponse.json({
            success: true,
            totalRounds: roundsWithData.length,
            rounds: roundsWithData
        });
    } catch (error) {
        console.error('查詢匯出輪次錯誤:', error);
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
}
