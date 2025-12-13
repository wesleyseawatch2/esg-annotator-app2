// 檔案路徑: app/api/get-completed-projects/route.js
import { sql } from '@vercel/postgres';
import { NextResponse } from 'next/server';

export async function POST(request) {
  try {
    const { userId } = await request.json();

    // 驗證管理員權限
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return NextResponse.json({ success: false, error: '權限不足' }, { status: 403 });
    }

    // 取得所有專案，並檢查每個專案是否有至少 2 位使用者完成所有標註
    const { rows: projects } = await sql`
      WITH project_stats AS (
        SELECT
          p.id as project_id,
          p.name as project_name,
          (SELECT COUNT(*) FROM source_data WHERE project_id = p.id) as total_tasks,
          u.id as user_id,
          u.username,
          (
            SELECT COUNT(*)
            FROM annotations a
            WHERE a.user_id = u.id
            AND a.source_data_id IN (SELECT id FROM source_data WHERE project_id = p.id)
            AND a.status = 'completed'
            AND (a.skipped IS NULL OR a.skipped = FALSE)
          ) as completed_tasks
        FROM projects p
        CROSS JOIN users u
        WHERE u.role != 'admin'
      ),
      completed_users AS (
        SELECT
          project_id,
          project_name,
          total_tasks,
          COUNT(*) as users_completed
        FROM project_stats
        WHERE total_tasks > 0 AND completed_tasks = total_tasks
        GROUP BY project_id, project_name, total_tasks
        HAVING COUNT(*) >= 2
      )
      SELECT
        cu.project_id as id,
        cu.project_name as name,
        cu.total_tasks,
        cu.users_completed,
        STRING_AGG(ps.username, ', ') as completed_users_names
      FROM completed_users cu
      JOIN project_stats ps ON cu.project_id = ps.project_id
      WHERE ps.completed_tasks = ps.total_tasks
      GROUP BY cu.project_id, cu.project_name, cu.total_tasks, cu.users_completed
      ORDER BY cu.project_name;
    `;

    return NextResponse.json({
      success: true,
      projects: projects.map(p => ({
        id: p.id,
        name: p.name,
        total_tasks: parseInt(p.total_tasks),
        completed_tasks: parseInt(p.total_tasks), // 對於完成的專案，這兩個數字相同
        users_completed: parseInt(p.users_completed),
        completed_users_names: p.completed_users_names
      }))
    });

  } catch (error) {
    console.error('取得已完成專案失敗:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
