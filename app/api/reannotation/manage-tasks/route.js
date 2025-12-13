// 檔案路徑: app/api/reannotation/manage-tasks/route.js
import { sql } from '@vercel/postgres';
import { NextResponse } from 'next/server';

/**
 * GET /api/reannotation/manage-tasks
 * 管理員查看所有重標註任務
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const projectId = searchParams.get('projectId');
    const roundId = searchParams.get('roundId');

    if (!userId) {
      return NextResponse.json({
        success: false,
        error: '缺少 userId 參數'
      }, { status: 400 });
    }

    // 驗證管理員權限
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return NextResponse.json({ success: false, error: '權限不足' }, { status: 403 });
    }

    // 建立查詢條件
    let whereConditions = ['1=1'];
    let params = [];

    if (projectId) {
      whereConditions.push('rr.project_id = $1');
      params.push(parseInt(projectId));
    }

    if (roundId) {
      const paramIndex = params.length + 1;
      whereConditions.push(`rt.round_id = $${paramIndex}`);
      params.push(parseInt(roundId));
    }

    const whereClause = whereConditions.join(' AND ');

    // 查詢所有任務
    const query = `
      SELECT
        rt.id as task_id,
        rt.source_data_id,
        rt.user_id,
        rt.task_group,
        rt.tasks_flagged,
        rt.status,
        rt.assigned_at,
        rt.submitted_at,
        u.username,
        sd.original_data,
        sd.page_number,
        rr.id as round_id,
        rr.project_id,
        rr.round_number,
        rr.task_group,
        rr.threshold,
        p.name as project_name
      FROM reannotation_tasks rt
      JOIN reannotation_rounds rr ON rt.round_id = rr.id
      JOIN users u ON rt.user_id = u.id
      JOIN source_data sd ON rt.source_data_id = sd.id
      JOIN projects p ON rr.project_id = p.id
      WHERE ${whereClause}
      ORDER BY rr.project_id, rr.round_number, rt.status, sd.page_number
    `;

    const { rows: tasks } = params.length > 0
      ? await sql.query(query, params)
      : await sql.query(query);

    // 統計資訊
    const stats = {
      total: tasks.length,
      pending: tasks.filter(t => t.status === 'pending').length,
      in_progress: tasks.filter(t => t.status === 'in_progress').length,
      submitted: tasks.filter(t => t.status === 'submitted').length,
      skipped: tasks.filter(t => t.status === 'skipped').length,
      byUser: {},
      byProject: {}
    };

    // 按使用者統計
    tasks.forEach(task => {
      if (!stats.byUser[task.username]) {
        stats.byUser[task.username] = { total: 0, pending: 0, submitted: 0 };
      }
      stats.byUser[task.username].total++;
      if (task.status === 'pending') stats.byUser[task.username].pending++;
      if (task.status === 'submitted') stats.byUser[task.username].submitted++;
    });

    // 按專案統計
    tasks.forEach(task => {
      if (!stats.byProject[task.project_name]) {
        stats.byProject[task.project_name] = { total: 0, pending: 0, submitted: 0 };
      }
      stats.byProject[task.project_name].total++;
      if (task.status === 'pending') stats.byProject[task.project_name].pending++;
      if (task.status === 'submitted') stats.byProject[task.project_name].submitted++;
    });

    return NextResponse.json({
      success: true,
      data: {
        tasks,
        stats
      }
    });

  } catch (error) {
    console.error('查詢任務失敗:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}

/**
 * DELETE /api/reannotation/manage-tasks
 * 刪除重標註任務
 */
export async function DELETE(request) {
  try {
    const { userId, taskIds } = await request.json();

    if (!userId || !taskIds || !Array.isArray(taskIds)) {
      return NextResponse.json({
        success: false,
        error: '缺少必要參數'
      }, { status: 400 });
    }

    // 驗證管理員權限
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return NextResponse.json({ success: false, error: '權限不足' }, { status: 403 });
    }

    if (taskIds.length === 0) {
      return NextResponse.json({
        success: true,
        deletedCount: 0
      });
    }

    // 刪除任務
    const placeholders = taskIds.map((_, i) => `$${i + 1}`).join(',');
    const deleteQuery = `DELETE FROM reannotation_tasks WHERE id IN (${placeholders})`;

    const result = await sql.query(deleteQuery, taskIds);

    return NextResponse.json({
      success: true,
      deletedCount: result.rowCount
    });

  } catch (error) {
    console.error('刪除任務失敗:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}

/**
 * POST /api/reannotation/manage-tasks
 * 手動新增任務給特定使用者
 */
export async function POST(request) {
  try {
    const { userId, roundId, sourceDataIds, targetUserIds } = await request.json();

    if (!userId || !roundId || !sourceDataIds || !targetUserIds) {
      return NextResponse.json({
        success: false,
        error: '缺少必要參數'
      }, { status: 400 });
    }

    // 驗證管理員權限
    const { rows: userRows } = await sql`SELECT role FROM users WHERE id = ${userId};`;
    if (userRows.length === 0 || userRows[0].role !== 'admin') {
      return NextResponse.json({ success: false, error: '權限不足' }, { status: 403 });
    }

    // 取得輪次資訊
    const { rows: roundRows } = await sql`
      SELECT * FROM reannotation_rounds WHERE id = ${roundId}
    `;

    if (roundRows.length === 0) {
      return NextResponse.json({
        success: false,
        error: '找不到此輪次'
      }, { status: 404 });
    }

    const round = roundRows[0];

    // 為每個使用者和資料建立任務
    let createdCount = 0;

    for (const sourceDataId of sourceDataIds) {
      for (const targetUserId of targetUserIds) {
        try {
          await sql`
            INSERT INTO reannotation_tasks
            (round_id, source_data_id, user_id, task_group, tasks_flagged, status)
            VALUES (
              ${roundId},
              ${sourceDataId},
              ${targetUserId},
              ${round.task_group},
              '{}',
              'pending'
            )
            ON CONFLICT (round_id, source_data_id, user_id) DO NOTHING
          `;
          createdCount++;
        } catch (err) {
          console.error(`建立任務失敗 (source_data_id: ${sourceDataId}, user_id: ${targetUserId}):`, err);
        }
      }
    }

    return NextResponse.json({
      success: true,
      createdCount
    });

  } catch (error) {
    console.error('新增任務失敗:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
