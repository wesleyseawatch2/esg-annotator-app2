// app/api/consistency/route.js

import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { calculateNominalAlpha } from '@/lib/krippendorff';

export const dynamic = 'force-dynamic';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    const userId = searchParams.get('userId');

    if (!projectId) {
        return NextResponse.json({ error: 'Missing projectId' }, { status: 400 });
    }

    try {
        // --- 1. 從資料庫撈資料 ---
        const result = await sql`
            WITH ProjectSource AS (
                SELECT 
                    id, 
                    original_data,
                    ROW_NUMBER() OVER (ORDER BY id ASC) as sequence
                FROM source_data
                WHERE project_id = ${projectId}
            ),
            ModifyCounts AS (
                SELECT source_data_id, COUNT(*) as log_count
                FROM reannotation_audit_log
                WHERE user_id = ${userId}
                GROUP BY source_data_id
            ),
            LatestAnnotations AS (
                SELECT DISTINCT ON (a.source_data_id, a.user_id)
                    a.source_data_id,
                    a.user_id,
                    a.promise_status,
                    a.verification_timeline,
                    a.evidence_status,
                    a.evidence_quality,
                    a.reannotation_round,
                    a.status,
                    a.skipped
                FROM annotations a
                JOIN source_data sd ON a.source_data_id = sd.id
                WHERE sd.project_id = ${projectId}
                ORDER BY a.source_data_id, a.user_id, a.reannotation_round DESC, a.version DESC, a.created_at DESC
            )
            SELECT 
                la.source_data_id,
                la.user_id,
                la.promise_status,
                la.verification_timeline,
                la.evidence_status,
                la.evidence_quality,
                la.reannotation_round,
                COALESCE(mc.log_count, 0) as modify_count, -- 用 Log 數量作為重標次數
                ps.sequence,
                ps.original_data
            FROM LatestAnnotations la
            JOIN ProjectSource ps ON la.source_data_id = ps.id
            LEFT JOIN ModifyCounts mc ON la.source_data_id = mc.source_data_id
            WHERE la.status = 'completed' 
                AND (la.skipped IS NULL OR la.skipped = FALSE)
            ORDER BY ps.sequence, la.user_id
        `;

        const rows = result.rows;

        if (rows.length === 0) {
            return NextResponse.json({ success: true, tasks: [], global_alphas: {} });
        }

        // --- 2. 準備計算 ---
        const dims = ['promise_status', 'verification_timeline', 'evidence_status', 'evidence_quality'];
        const taskMap = {}; 
        const globalAlphas = {};

        // 找出當前使用者標註過的資料 ID
        const userIdNum = parseInt(userId);
        const userAnnotatedIds = new Set(rows.filter(r => r.user_id === userIdNum).map(r => r.source_data_id));

        // --- 3. 執行算法 ---
        dims.forEach(dim => {
            const inputData = rows.map(r => ({
                unitId: r.source_data_id,
                coderId: r.user_id,
                value: r[dim]
            }));

            const { alpha, unitScores } = calculateNominalAlpha(inputData);
            globalAlphas[dim] = alpha;

            Object.keys(unitScores).forEach(uid => {
                if (!taskMap[uid]) {
                    const row = rows.find(r => r.source_data_id == uid);
                    // 這裡的 modify_count 已經是從 audit_log 算出來的了
                    const userRow = rows.find(r => r.source_data_id == uid && r.user_id === userIdNum);
                    
                    taskMap[uid] = { 
                        id: uid, 
                        sequence: row ? row.sequence : 0, 
                        preview_text: row && row.original_data ? row.original_data.substring(0, 30) + "..." : "無文本",
                        _modifyCount: userRow ? parseInt(userRow.modify_count) : 0,
                        _userAnnotated: userAnnotatedIds.has(parseInt(uid))
                    };
                }
                
                const keyMap = {
                    'promise_status': 's_promise',
                    'verification_timeline': 's_timeline',
                    'evidence_status': 's_evidence',
                    'evidence_quality': 's_quality'
                };
                taskMap[uid][keyMap[dim]] = unitScores[uid];
            });
        });

        // --- 4. 格式化輸出與狀態判定 ---
        const tasks = Object.values(taskMap)
            .filter(t => t._userAnnotated) // 只回傳使用者自己標過的
            .map(t => {
                const s_p = t.s_promise ?? 1;
                const s_t = t.s_timeline ?? 1;
                const s_e = t.s_evidence ?? 1;
                const s_q = t.s_quality ?? 1;

                // 判斷是否低分 (需要重標)
                const hasLowScore = (s_p < 0.8 || s_t < 0.8 || s_e < 0.8 || s_q < 0.8);
                
                // 狀態燈號邏輯：全滿分 OR 有修改過 -> 綠燈
                const isPerfect = (s_p === 1 && s_t === 1 && s_e === 1 && s_q === 1);
                const isReviewed = isPerfect || t._modifyCount >= 1;

                return {
                    ...t,
                    s_promise: s_p,
                    s_timeline: s_t,
                    s_evidence: s_e,
                    s_quality: s_q,
                    is_reviewed: isReviewed,
                    modify_count: t._modifyCount,
                    needs_reannotation: hasLowScore
                };
            })
            .sort((a, b) => a.sequence - b.sequence);

        return NextResponse.json({
            success: true,
            global_alphas: globalAlphas,
            tasks: tasks
        });

    } catch (error) {
        console.error('Calculation error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}