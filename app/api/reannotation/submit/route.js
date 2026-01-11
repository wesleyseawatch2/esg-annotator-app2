// 檔案路徑: app/api/reannotation/submit/route.js
import { sql } from '@vercel/postgres';
import { NextResponse } from 'next/server';

/**
 * POST /api/reannotation/submit
 * 送出重標註結果
 *
 * Body:
 * {
 *   taskId: number,
 *   userId: number,
 *   sourceDataId: number,
 *   answers: {
 *     promise_status?: string,
 *     verification_timeline?: string,
 *     evidence_status?: string,
 *     evidence_quality?: string,
 *     promise_string?: string,
 *     evidence_string?: string
 *   },
 *   persistAnswer?: boolean,
 *   comment?: string
 * }
 */
export async function POST(request) {
  try {
    const body = await request.json();
    const {
      taskId,
      userId,
      sourceDataId,
      answers,
      persistAnswer = false,
      comment = ''
    } = body;

    // 驗證必要參數
    if (!taskId || !userId || !sourceDataId || !answers) {
      return NextResponse.json({
        success: false,
        error: '缺少必要參數'
      }, { status: 400 });
    }

    // 開始交易
    await sql.query('BEGIN');

    try {
      // 1. 取得任務資訊
      const { rows: taskRows } = await sql`
        SELECT
          rt.*,
          rr.round_number,
          rr.project_id
        FROM reannotation_tasks rt
        JOIN reannotation_rounds rr ON rt.round_id = rr.id
        WHERE rt.id = ${taskId} AND rt.user_id = ${userId}
      `;

      if (taskRows.length === 0) {
        await sql.query('ROLLBACK');
        return NextResponse.json({
          success: false,
          error: '找不到此重標註任務'
        }, { status: 404 });
      }

      const task = taskRows[0];

      // 2. 取得原始標註資料和專案資訊
      const { rows: oldAnnotations } = await sql`
        SELECT a.*, sd.project_id
        FROM annotations a
        JOIN source_data sd ON a.source_data_id = sd.id
        WHERE a.source_data_id = ${sourceDataId} AND a.user_id = ${userId}
      `;

      const oldAnnotation = oldAnnotations.length > 0 ? oldAnnotations[0] : null;

      // 3. 記錄審計日誌 (變更記錄)
      const auditEntries = [];
      const taskNames = Object.keys(answers);

      for (const taskName of taskNames) {
        const oldValue = oldAnnotation ? oldAnnotation[taskName] : null;
        const newValue = answers[taskName];

        if (oldValue !== newValue) {
          auditEntries.push({
            sourceDataId,
            userId,
            taskName,
            oldValue: oldValue ? String(oldValue) : null,
            newValue: newValue ? String(newValue) : null,
            roundNumber: task.round_number,
            changeReason: comment || '重標註修改'
          });
        }
      }

      // 插入審計日誌
      for (const entry of auditEntries) {
        await sql`
          INSERT INTO reannotation_audit_log
          (source_data_id, user_id, task_name, old_value, new_value, round_number, change_reason)
          VALUES (
            ${entry.sourceDataId},
            ${entry.userId},
            ${entry.taskName},
            ${entry.oldValue},
            ${entry.newValue},
            ${entry.roundNumber},
            ${entry.changeReason}
          )
        `;
      }

      // 4. 插入新的標註記錄（不覆蓋原本的）
      const currentVersion = oldAnnotation ? (oldAnnotation.version || 1) : 1;
      const newVersion = currentVersion + 1;

      if (!oldAnnotation) {
        await sql.query('ROLLBACK');
        return NextResponse.json({
          success: false,
          error: '找不到原始標註資料'
        }, { status: 404 });
      }

      // 複製原始標註的所有欄位，然後更新重標註的部分
      const currentSaveCount = oldAnnotation.save_count || 0;
      const newAnnotation = {
        source_data_id: sourceDataId,
        user_id: userId,
        esg_type: oldAnnotation.esg_type,
        promise_status: answers.promise_status || oldAnnotation.promise_status,
        verification_timeline: answers.verification_timeline || oldAnnotation.verification_timeline,
        evidence_status: answers.evidence_status || oldAnnotation.evidence_status,
        evidence_quality: answers.evidence_quality || oldAnnotation.evidence_quality,
        promise_string: answers.promise_string || oldAnnotation.promise_string,
        evidence_string: answers.evidence_string || oldAnnotation.evidence_string,
        status: oldAnnotation.status,
        skipped: oldAnnotation.skipped,
        reannotation_round: task.round_number,
        version: newVersion,
        persist_answer: persistAnswer,
        reannotation_comment: comment,
        save_count: currentSaveCount + 1  // 每次重標註儲存時增加 save_count
      };

      // 插入新的標註記錄（如果已存在則更新）
      await sql`
        INSERT INTO annotations (
          source_data_id, user_id, esg_type,
          promise_status, verification_timeline, evidence_status, evidence_quality,
          promise_string, evidence_string,
          status, skipped,
          reannotation_round, version, persist_answer, reannotation_comment,
          save_count,
          created_at, updated_at
        ) VALUES (
          ${newAnnotation.source_data_id},
          ${newAnnotation.user_id},
          ${newAnnotation.esg_type},
          ${newAnnotation.promise_status},
          ${newAnnotation.verification_timeline},
          ${newAnnotation.evidence_status},
          ${newAnnotation.evidence_quality},
          ${newAnnotation.promise_string},
          ${newAnnotation.evidence_string},
          ${newAnnotation.status},
          ${newAnnotation.skipped},
          ${newAnnotation.reannotation_round},
          ${newAnnotation.version},
          ${newAnnotation.persist_answer},
          ${newAnnotation.reannotation_comment},
          ${newAnnotation.save_count},
          NOW(),
          NOW()
        )
        ON CONFLICT (source_data_id, user_id, version)
        DO UPDATE SET
          esg_type = EXCLUDED.esg_type,
          promise_status = EXCLUDED.promise_status,
          verification_timeline = EXCLUDED.verification_timeline,
          evidence_status = EXCLUDED.evidence_status,
          evidence_quality = EXCLUDED.evidence_quality,
          promise_string = EXCLUDED.promise_string,
          evidence_string = EXCLUDED.evidence_string,
          status = EXCLUDED.status,
          skipped = EXCLUDED.skipped,
          persist_answer = EXCLUDED.persist_answer,
          reannotation_comment = EXCLUDED.reannotation_comment,
          save_count = EXCLUDED.save_count,
          updated_at = NOW()
      `;

      // 5. 更新任務狀態
      await sql`
        UPDATE reannotation_tasks
        SET status = 'submitted', submitted_at = NOW()
        WHERE id = ${taskId}
      `;

      // 6. 清除此資料的一致性分數快取 (因為答案已改變)
      await sql`
        DELETE FROM agreement_scores_cache
        WHERE project_id = ${task.project_id}
        AND source_data_id = ${sourceDataId}
        AND round_number = ${task.round_number}
      `;

      await sql.query('COMMIT');

      return NextResponse.json({
        success: true,
        data: {
          taskId,
          sourceDataId,
          changesCount: auditEntries.length,
          newVersion,
          submitted: true
        }
      });

    } catch (error) {
      await sql.query('ROLLBACK');
      throw error;
    }

  } catch (error) {
    console.error('送出重標註失敗:', error);
    return NextResponse.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
}
