// 檔案路徑: app/api/reannotation/queue/route.js
import { sql } from '@vercel/postgres';
import { NextResponse } from 'next/server';

/**
 * GET /api/reannotation/queue
 * 取得使用者的重標註任務清單
 *
 * Query params:
 * - userId: 使用者ID
 * - projectId: 專案ID (optional)
 * - taskGroup: 任務分組 'group1' 或 'group2' (optional)
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const projectId = searchParams.get('projectId');
    const taskGroup = searchParams.get('taskGroup');

    if (!userId) {
      return NextResponse.json({
        success: false,
        error: '缺少 userId 參數'
      }, { status: 400 });
    }

    // 建立查詢條件
    let whereConditions = ['rt.user_id = $1', 'rr.status = \'active\''];
    let params = [parseInt(userId)];
    let paramIndex = 2;

    if (projectId) {
      whereConditions.push(`rr.project_id = $${paramIndex}`);
      params.push(parseInt(projectId));
      paramIndex++;
    }

    if (taskGroup) {
      whereConditions.push(`rt.task_group = $${paramIndex}`);
      params.push(taskGroup);
      paramIndex++;
    }

    const whereClause = whereConditions.join(' AND ');

    // 查詢使用者的重標註任務（只查詢有權限的專案群組）
    const { rows: tasks } = await sql.query(`
      SELECT
        rt.id as task_id,
        rt.source_data_id,
        rt.task_group,
        rt.tasks_flagged,
        rt.status,
        rt.assigned_at,
        sd.original_data,
        sd.page_number,
        sd.source_url,
        rr.id as round_id,
        rr.project_id,
        rr.round_number,
        rr.threshold,
        p.name as project_name,
        a.promise_status,
        a.verification_timeline,
        a.evidence_status,
        a.evidence_quality,
        a.promise_string,
        a.evidence_string,
        a.persist_answer,
        a.reannotation_comment,
        a.last_agreement_score
      FROM reannotation_tasks rt
      JOIN reannotation_rounds rr ON rt.round_id = rr.id
      JOIN source_data sd ON rt.source_data_id = sd.id
      JOIN projects p ON rr.project_id = p.id
      LEFT JOIN annotations a ON rt.source_data_id = a.source_data_id AND a.user_id = rt.user_id
      WHERE ${whereClause}
        AND (
          p.group_id IS NULL
          OR p.group_id IN (
            SELECT group_id
            FROM user_group_permissions
            WHERE user_id = $1
          )
        )
      ORDER BY rr.project_id, rt.task_group, sd.page_number, sd.id
    `, params);

    // 按專案和任務組分組
    const groupedTasks = {};

    tasks.forEach(task => {
      const key = `${task.project_id}_${task.task_group}`;
      if (!groupedTasks[key]) {
        groupedTasks[key] = {
          projectId: task.project_id,
          projectName: task.project_name,
          taskGroup: task.task_group,
          roundId: task.round_id,
          roundNumber: task.round_number,
          threshold: parseFloat(task.threshold),
          tasks: []
        };
      }

      groupedTasks[key].tasks.push({
        taskId: task.task_id,
        sourceDataId: task.source_data_id,
        originalData: task.original_data,
        pageNumber: task.page_number,
        sourceUrl: task.source_url,
        tasksFlagged: task.tasks_flagged,
        status: task.status,
        assignedAt: task.assigned_at,
        currentAnswers: {
          promise_status: task.promise_status,
          verification_timeline: task.verification_timeline,
          evidence_status: task.evidence_status,
          evidence_quality: task.evidence_quality,
          promise_string: task.promise_string,
          evidence_string: task.evidence_string,
        },
        persistAnswer: task.persist_answer,
        comment: task.reannotation_comment,
        lastScores: task.last_agreement_score || {}
      });
    });

    // 取得每個專案的標註指引 (模擬資料，實際應從資料庫讀取)
    const guidelines = {
      group1: {
        promise_status: {
          title: '承諾狀態判定標準',
          items: [
            '「Yes」：文本明確提及未來將執行的ESG行動、目標或計畫',
            '「No」：文本僅描述現況、過去成果，或無明確未來承諾',
            '關鍵詞：「將」、「計畫」、「目標」、「承諾」等'
          ]
        },
        verification_timeline: {
          title: '驗證時間軸標準',
          items: [
            'within_2_years: 2年內可驗證',
            'between_2_and_5_years: 2-5年內可驗證',
            'longer_than_5_years: 5年以上',
            'already: 已經實現/持續進行中'
          ]
        }
      },
      group2: {
        evidence_status: {
          title: '證據狀態判定標準',
          items: [
            '「Yes」：報告中有提供可驗證承諾的具體證據',
            '「No」：報告中未提供相關證據',
            '證據包含：數據、圖表、第三方認證、具體案例等'
          ]
        },
        evidence_quality: {
          title: '證據品質評估標準',
          items: [
            'Clear: 證據明確、完整、可量化',
            'Not Clear: 證據模糊、不完整或難以驗證',
            'Misleading: 證據具有誤導性或與承諾不符'
          ]
        }
      }
    };

    // 統計資訊
    const stats = {
      totalTasks: tasks.length,
      pendingTasks: tasks.filter(t => t.status === 'pending').length,
      inProgressTasks: tasks.filter(t => t.status === 'in_progress').length,
      submittedTasks: tasks.filter(t => t.status === 'submitted').length,
      byGroup: {}
    };

    Object.values(groupedTasks).forEach(group => {
      stats.byGroup[group.taskGroup] = group.tasks.length;
    });

    return NextResponse.json({
      success: true,
      data: {
        tasks: Object.values(groupedTasks),
        guidelines,
        stats
      }
    });

  } catch (error) {
    console.error('取得重標註清單失敗:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
