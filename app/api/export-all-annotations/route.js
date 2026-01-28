import { sql } from '@vercel/postgres';
import { NextResponse } from 'next/server';

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const format = searchParams.get('format') || 'json'; // 'json' or 'csv'

        const allAnnotations = [];

        // 1. 獲取所有專案及其所有輪次的標註資料（直接從 annotations 表查詢）
        // 這樣可以確保即使 reannotation_rounds 表沒有記錄，也能匯出重標註資料
        const allProjectRounds = await sql`
            SELECT DISTINCT
                p.id as project_id,
                p.name as project_name,
                pg.name as group_name,
                COALESCE(a.reannotation_round, 0) as reannotation_round
            FROM projects p
            LEFT JOIN project_groups pg ON p.group_id = pg.id
            JOIN source_data sd ON sd.project_id = p.id
            JOIN annotations a ON a.source_data_id = sd.id
            ORDER BY pg.name, p.name, reannotation_round
        `;

        // 2. 獲取 reannotation_rounds 表的資訊（用於取得 task_group 等額外資訊）
        const reannotationRoundsInfo = await sql`
            SELECT
                project_id,
                round_number,
                task_group
            FROM reannotation_rounds
        `;

        // 建立查詢用的 Map
        const roundInfoMap = new Map();
        reannotationRoundsInfo.rows.forEach(r => {
            const key = `${r.project_id}-${r.round_number}`;
            roundInfoMap.set(key, r.task_group);
        });

        // 3. 處理每個專案的每個輪次
        for (const projectRound of allProjectRounds.rows) {
            const { project_id, project_name, group_name, reannotation_round } = projectRound;

            // 查詢該專案該輪次的所有標註（取最新版本）
            const annotations = await sql`
                SELECT DISTINCT ON (a.source_data_id, a.user_id)
                    a.source_data_id,
                    sd.original_data,
                    a.user_id,
                    u.username,
                    a.promise_status,
                    a.verification_timeline,
                    a.evidence_status,
                    a.evidence_quality,
                    a.persist_answer,
                    a.reannotation_comment,
                    a.reannotation_round,
                    a.status,
                    a.skipped,
                    a.created_at
                FROM annotations a
                JOIN source_data sd ON a.source_data_id = sd.id
                JOIN users u ON a.user_id = u.id
                WHERE sd.project_id = ${project_id}
                    AND COALESCE(a.reannotation_round, 0) = ${reannotation_round}
                ORDER BY a.source_data_id, a.user_id, a.version DESC, a.created_at DESC
            `;

            // 判斷標註類型和取得 task_group
            const isReannotation = reannotation_round > 0;
            const roundKey = `${project_id}-${reannotation_round}`;
            const taskGroup = roundInfoMap.get(roundKey) || (isReannotation ? '未記錄' : '全部');

            annotations.rows.forEach(ann => {
                allAnnotations.push({
                    group_name: group_name || '未分組',
                    project_name: project_name,
                    annotation_type: isReannotation ? '重標註' : '初次標註',
                    round_number: reannotation_round,
                    task_group: taskGroup,
                    reannotation_round: ann.reannotation_round || 0,
                    source_data_id: ann.source_data_id,
                    original_data: ann.original_data,
                    user_id: ann.user_id,
                    username: ann.username,
                    promise_status: ann.promise_status,
                    verification_timeline: ann.verification_timeline,
                    evidence_status: ann.evidence_status,
                    evidence_quality: ann.evidence_quality,
                    persist_answer: ann.persist_answer,
                    reannotation_comment: ann.reannotation_comment,
                    status: ann.status,
                    skipped: ann.skipped,
                    created_at: ann.created_at
                });
            });
        }

        // 4. 根據格式返回資料
        if (format === 'csv') {
            // 生成 CSV
            const headers = [
                '組別', '專案名稱', '標註類型', '輪次', '任務組別', 'reannotation_round',
                '資料ID', '原始文本', '用戶ID', '用戶名稱',
                '承諾狀態', '驗證時間', '證據狀態', '證據品質',
                '堅持答案', '重標註備註', '狀態', '已跳過', '標註時間'
            ];

            const csvRows = allAnnotations.map(ann => {
                // 輔助函數：將欄位值轉換為 CSV 格式（處理引號和逗號）
                const escapeCSV = (value) => {
                    if (value === null || value === undefined) return '""';
                    const str = String(value);
                    // 如果包含逗號、引號或換行，就用雙引號包起來
                    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
                        return `"${str.replace(/"/g, '""')}"`;
                    }
                    return `"${str}"`;
                };

                return [
                    escapeCSV(ann.group_name),
                    escapeCSV(ann.project_name),
                    escapeCSV(ann.annotation_type),
                    escapeCSV(ann.round_number),
                    escapeCSV(ann.task_group),
                    escapeCSV(ann.reannotation_round),
                    escapeCSV(ann.source_data_id),
                    escapeCSV(ann.original_data),
                    escapeCSV(ann.user_id),
                    escapeCSV(ann.username),
                    escapeCSV(ann.promise_status || ''),
                    escapeCSV(ann.verification_timeline || ''),
                    escapeCSV(ann.evidence_status || ''),
                    escapeCSV(ann.evidence_quality || ''),
                    escapeCSV(ann.persist_answer || ''),
                    escapeCSV(ann.reannotation_comment || ''),
                    escapeCSV(ann.status || ''),
                    escapeCSV(ann.skipped ? '是' : '否'),
                    escapeCSV(ann.created_at ? new Date(ann.created_at).toLocaleString('zh-TW') : '')
                ].join(',');
            });

            const csv = [headers.join(','), ...csvRows].join('\n');

            return new NextResponse('\ufeff' + csv, {
                headers: {
                    'Content-Type': 'text/csv;charset=utf-8',
                    'Content-Disposition': `attachment; filename="all_annotations_${new Date().toISOString().split('T')[0]}.csv"`
                }
            });
        } else {
            // 返回 JSON
            // 統計資訊
            const initialCount = allAnnotations.filter(a => a.reannotation_round === 0).length;
            const reannotationCount = allAnnotations.filter(a => a.reannotation_round > 0).length;
            const uniqueProjects = [...new Set(allAnnotations.map(a => a.project_name))].length;
            const uniqueRounds = [...new Set(allAnnotations.filter(a => a.reannotation_round > 0).map(a => `${a.project_name}-${a.reannotation_round}`))].length;

            return NextResponse.json({
                success: true,
                data: allAnnotations,
                totalCount: allAnnotations.length,
                summary: {
                    uniqueProjects: uniqueProjects,
                    initialAnnotations: initialCount,
                    reannotationAnnotations: reannotationCount,
                    uniqueReannotationRounds: uniqueRounds,
                    totalAnnotations: allAnnotations.length
                }
            });
        }
    } catch (error) {
        console.error('匯出標註資料錯誤:', error);
        return NextResponse.json({
            success: false,
            error: error.message
        }, { status: 500 });
    }
}
