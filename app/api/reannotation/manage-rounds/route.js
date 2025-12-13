// 檔案路徑: app/api/reannotation/manage-rounds/route.js
import { sql } from '@vercel/postgres';
import { NextResponse } from 'next/server';

/**
 * GET /api/reannotation/manage-rounds
 * 管理員查看所有重標註輪次
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

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

    // 查詢所有輪次及其統計資訊
    const { rows: rounds } = await sql`
      SELECT
        rr.id as round_id,
        rr.project_id,
        rr.round_number,
        rr.task_group,
        rr.threshold,
        rr.created_at,
        rr.status,
        rr.completed_at,
        p.name as project_name,
        u.username as created_by_name,
        COUNT(DISTINCT rt.id) as total_tasks,
        COUNT(DISTINCT CASE WHEN rt.status = 'pending' THEN rt.id END) as pending_tasks,
        COUNT(DISTINCT CASE WHEN rt.status = 'submitted' THEN rt.id END) as submitted_tasks,
        COUNT(DISTINCT rt.user_id) as total_users,
        COUNT(DISTINCT rt.source_data_id) as total_items
      FROM reannotation_rounds rr
      JOIN projects p ON rr.project_id = p.id
      LEFT JOIN users u ON rr.created_by = u.id
      LEFT JOIN reannotation_tasks rt ON rr.id = rt.round_id
      GROUP BY rr.id, p.name, u.username
      ORDER BY rr.created_at DESC
    `;

    return NextResponse.json({
      success: true,
      data: { rounds }
    });

  } catch (error) {
    console.error('查詢輪次失敗:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}

/**
 * DELETE /api/reannotation/manage-rounds
 * 刪除整個輪次及其所有任務
 */
export async function DELETE(request) {
  try {
    const { userId, roundIds } = await request.json();

    if (!userId || !roundIds || !Array.isArray(roundIds)) {
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

    if (roundIds.length === 0) {
      return NextResponse.json({
        success: true,
        deletedCount: 0
      });
    }

    // 刪除輪次（會自動級聯刪除相關任務）
    const placeholders = roundIds.map((_, i) => `$${i + 1}`).join(',');
    const deleteQuery = `DELETE FROM reannotation_rounds WHERE id IN (${placeholders})`;

    const result = await sql.query(deleteQuery, roundIds);

    return NextResponse.json({
      success: true,
      deletedCount: result.rowCount
    });

  } catch (error) {
    console.error('刪除輪次失敗:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}

/**
 * PATCH /api/reannotation/manage-rounds
 * 更新輪次狀態或從輪次中移除特定使用者的所有任務
 */
export async function PATCH(request) {
  try {
    const { userId, roundId, action, targetUserIds } = await request.json();

    if (!userId || !roundId || !action) {
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

    if (action === 'remove_users') {
      // 從輪次中移除特定使用者的所有任務
      if (!targetUserIds || !Array.isArray(targetUserIds) || targetUserIds.length === 0) {
        return NextResponse.json({
          success: false,
          error: '缺少 targetUserIds 參數'
        }, { status: 400 });
      }

      const placeholders = targetUserIds.map((_, i) => `$${i + 2}`).join(',');
      const deleteQuery = `
        DELETE FROM reannotation_tasks
        WHERE round_id = $1 AND user_id IN (${placeholders})
      `;

      const result = await sql.query(deleteQuery, [roundId, ...targetUserIds]);

      return NextResponse.json({
        success: true,
        deletedTasksCount: result.rowCount
      });

    } else if (action === 'complete') {
      // 標記輪次為已完成
      await sql`
        UPDATE reannotation_rounds
        SET status = 'completed', completed_at = NOW()
        WHERE id = ${roundId}
      `;

      return NextResponse.json({
        success: true,
        message: '輪次已標記為完成'
      });

    } else if (action === 'cancel') {
      // 取消輪次
      await sql`
        UPDATE reannotation_rounds
        SET status = 'cancelled'
        WHERE id = ${roundId}
      `;

      return NextResponse.json({
        success: true,
        message: '輪次已取消'
      });

    } else {
      return NextResponse.json({
        success: false,
        error: '不支援的操作'
      }, { status: 400 });
    }

  } catch (error) {
    console.error('更新輪次失敗:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
