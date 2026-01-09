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

    // 取得所有專案，並計算每個專案有多少位使用者完成所有標註（使用最新版本）
    const { rows: projects } = await sql`
      WITH latest_annotations AS (
        -- 取得每個使用者對每筆資料的最新標註
        SELECT DISTINCT ON (a.source_data_id, a.user_id)
          a.source_data_id,
          a.user_id,
          a.status,
          a.skipped,
          sd.project_id
        FROM annotations a
        JOIN source_data sd ON a.source_data_id = sd.id
        ORDER BY a.source_data_id, a.user_id, a.version DESC, a.created_at DESC
      ),
      user_project_stats AS (
        -- 計算每個使用者在每個專案的完成狀況
        SELECT
          p.id as project_id,
          p.name as project_name,
          u.id as user_id,
          u.username,
          (SELECT COUNT(*) FROM source_data WHERE project_id = p.id) as total_tasks,
          COUNT(la.source_data_id) FILTER (
            WHERE la.status = 'completed'
            AND (la.skipped IS NULL OR la.skipped = FALSE)
          ) as completed_tasks
        FROM projects p
        CROSS JOIN users u
        LEFT JOIN latest_annotations la ON la.project_id = p.id AND la.user_id = u.id
        WHERE u.role != 'admin'
        GROUP BY p.id, p.name, u.id, u.username
      ),
      completed_users_per_project AS (
        -- 計算每個專案有多少位使用者完成所有任務
        SELECT
          project_id,
          project_name,
          total_tasks,
          COUNT(*) as users_completed,
          STRING_AGG(username, ', ') as completed_users_names
        FROM user_project_stats
        WHERE total_tasks > 0 AND completed_tasks = total_tasks
        GROUP BY project_id, project_name, total_tasks
      )
      -- 最終結果：列出所有有標註資料的專案
      SELECT
        p.id,
        p.name,
        COALESCE(cup.total_tasks, (SELECT COUNT(*) FROM source_data WHERE project_id = p.id)) as total_tasks,
        COALESCE(cup.users_completed, 0) as users_completed,
        COALESCE(cup.completed_users_names, '') as completed_users_names
      FROM projects p
      LEFT JOIN completed_users_per_project cup ON p.id = cup.project_id
      WHERE EXISTS (SELECT 1 FROM source_data WHERE project_id = p.id)
      ORDER BY p.name;
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
