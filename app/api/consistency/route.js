// app/api/consistency/route.js

import { NextResponse } from 'next/server';
import { sql } from '@vercel/postgres';
import { calculateNominalAlpha } from '@/lib/krippendorff';

export const dynamic = 'force-dynamic';

export async function GET(request) {
    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get('projectId');
    const userId = searchParams.get('userId'); // 取得 userId

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
            -- 計算每個任務被該使用者修改過幾次
            ModificationCounts AS (
                SELECT source_data_id, COUNT(*) as modify_count
                FROM reannotation_audit_log
                WHERE user_id = ${userId}
                GROUP BY source_data_id
            )
            SELECT 
                a.source_data_id,
                a.user_id,
                a.promise_status,
                a.verification_timeline,
                a.evidence_status,
                a.evidence_quality,
                a.reannotation_round,
                ps.sequence,
                ps.original_data,
                COALESCE(mc.modify_count, 0) as modify_count  -- 取出次數，若無則為0
            FROM annotations a
            JOIN ProjectSource ps ON a.source_data_id = ps.id
            LEFT JOIN ModificationCounts mc ON a.source_data_id = mc.source_data_id
        `;

        const rows = result.rows;

        if (rows.length === 0) {
            return NextResponse.json({ success: true, tasks: [], global_alphas: {} });
        }

        // --- 2. 準備計算 ---
        const dims = ['promise_status', 'verification_timeline', 'evidence_status', 'evidence_quality'];
        const taskMap = {}; 
        const globalAlphas = {};

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
                    
                    // 判斷邏輯：
                    // 1. 分數完美 (全1.0) -> 綠燈
                    // 2. 或者，已重標次數 >= 1 -> 綠燈
                    const modifyCount = row ? parseInt(row.modify_count) : 0;
                    
                    taskMap[uid] = { 
                        id: uid, 
                        sequence: row ? row.sequence : 0, 
                        preview_text: row && row.original_data ? row.original_data.substring(0, 30) + "..." : "無文本",
                        _modifyCount: modifyCount // 暫存次數
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
        const tasks = Object.values(taskMap).map(t => {
            const s_p = t.s_promise ?? 1;
            const s_t = t.s_timeline ?? 1;
            const s_e = t.s_evidence ?? 1;
            const s_q = t.s_quality ?? 1;

            // 篩選邏輯判斷 (前端會用到)
            // 是否有任何一個分數低於 0.8
            const hasLowScore = (s_p < 0.8 || s_t < 0.8 || s_e < 0.8 || s_q < 0.8);

            // 狀態燈號邏輯
            // 如果所有分數都完美(=1)，或者修改次數 >= 1，都算已完成(is_reviewed)
            const isPerfect = (s_p === 1 && s_t === 1 && s_e === 1 && s_q === 1);
            const isReviewed = isPerfect || t._modifyCount >= 1;

            return {
                ...t,
                s_promise: s_p,
                s_timeline: s_t,
                s_evidence: s_e,
                s_quality: s_q,
                is_reviewed: isReviewed,
                modify_count: t._modifyCount,   // 傳回前端顯示
                needs_reannotation: hasLowScore // 標記是否需要重標 (低於0.8)
            };
        }).sort((a, b) => a.sequence - b.sequence);

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