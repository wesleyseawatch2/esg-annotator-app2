import { sql } from '@vercel/postgres';
import { NextResponse } from 'next/server';

export async function GET(request) {
  try {
    // 查詢所有組1的專案
    const { rows: projects } = await sql`
      SELECT id, name
      FROM projects
      WHERE name LIKE '組1_%'
      ORDER BY name
    `;

    // 查詢每個專案的詳細資訊
    const projectDetails = [];
    for (const project of projects) {
      const { rows: sourceDataCount } = await sql`
        SELECT COUNT(*) as count FROM source_data WHERE project_id = ${project.id}
      `;

      // 查詢每個使用者的最新標註完成狀況
      const { rows: userStats } = await sql`
        WITH latest_annotations AS (
          SELECT DISTINCT ON (a.source_data_id, a.user_id)
            a.source_data_id,
            a.user_id,
            a.status,
            a.skipped,
            u.username
          FROM annotations a
          JOIN users u ON a.user_id = u.id
          JOIN source_data sd ON a.source_data_id = sd.id
          WHERE sd.project_id = ${project.id}
            AND u.role != 'admin'
          ORDER BY a.source_data_id, a.user_id, a.version DESC, a.created_at DESC
        )
        SELECT
          user_id,
          username,
          COUNT(*) FILTER (WHERE status = 'completed' AND (skipped IS NULL OR skipped = FALSE)) as completed_count,
          COUNT(*) as total_annotations
        FROM latest_annotations
        GROUP BY user_id, username
        ORDER BY username
      `;

      projectDetails.push({
        id: project.id,
        name: project.name,
        total_tasks: parseInt(sourceDataCount[0].count),
        user_stats: userStats.map(u => ({
          user_id: u.user_id,
          username: u.username,
          completed: parseInt(u.completed_count),
          total: parseInt(u.total_annotations)
        }))
      });
    }

    return NextResponse.json({
      success: true,
      total_projects: projects.length,
      projects: projectDetails
    });

  } catch (error) {
    console.error('查詢失敗:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
