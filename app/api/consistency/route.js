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
        // 多撈一個 reannotation_round 欄位
        const result = await sql`
            WITH ProjectSource AS (
                SELECT 
                    id, 
                    original_data,
                    ROW_NUMBER() OVER (ORDER BY id ASC) as sequence
                FROM source_data
                WHERE project_id = ${projectId}
            )
            SELECT 
                a.source_data_id,
                a.user_id,
                a.promise_status,
                a.verification_timeline,
                a.evidence_status,
                a.evidence_quality,
                a.reannotation_round,  -- 撈取重標註輪次
                ps.sequence,
                ps.original_data
            FROM annotations a
            JOIN ProjectSource ps ON a.source_data_id = ps.id
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
                    
                    // 判斷該使用者是否已完成
                    // 邏輯：先找到這個 user 在這一題的標註資料
                    const userAnnotation = rows.find(r => r.source_data_id == uid && r.user_id == userId);
                    
                    // 如果有找到資料，且 (reannotation_round > 0 代表修過) 
                    // 或者是系統沒有這個人的資料(可能不用標)，也可以預設為 true 避免紅燈
                    const userHasReviewed = userAnnotation ? (userAnnotation.reannotation_round > 0) : false;

                    taskMap[uid] = { 
                        id: uid, 
                        sequence: row ? row.sequence : 0, 
                        preview_text: row && row.original_data ? row.original_data.substring(0, 30) + "..." : "無文本",
                        // 暫存使用者的重標狀態
                        _userHasReviewed: userHasReviewed
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
            // 補零
            const s_p = t.s_promise ?? 1;
            const s_t = t.s_timeline ?? 1;
            const s_e = t.s_evidence ?? 1;
            const s_q = t.s_quality ?? 1;

            // 判斷是否顯示「綠燈 (已檢視)」
            // 條件 A: 分數全部都是 1.0 (完全一致，無需再標)
            const isPerfect = (s_p === 1 && s_t === 1 && s_e === 1 && s_q === 1);
            
            // 條件 B: 使用者已經送出過重標註 (Round > 0)
            const isDoneByUser = t._userHasReviewed;

            return {
                ...t,
                s_promise: s_p,
                s_timeline: s_t,
                s_evidence: s_e,
                s_quality: s_q,
                // 只要「完全一致」或「我已修過」，就給綠燈
                is_reviewed: isPerfect || isDoneByUser 
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