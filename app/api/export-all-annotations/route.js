import { sql } from '@vercel/postgres';
import { NextResponse } from 'next/server';

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const format = searchParams.get('format') || 'json'; // 'json' or 'csv'

        // 1. 獲取所有初次標註專案（不管是否完成）
        const initialProjects = await sql`
            SELECT DISTINCT
                p.id as project_id,
                p.name as project_name,
                pg.name as group_name
            FROM projects p
            LEFT JOIN project_groups pg ON p.group_id = pg.id
            WHERE EXISTS (
                SELECT 1
                FROM annotations a
                JOIN source_data sd ON a.source_data_id = sd.id
                WHERE sd.project_id = p.id
                    AND a.reannotation_round = 0
            )
            ORDER BY pg.name, p.name
        `;

        // 2. 獲取所有重標註輪次（不管是否完成）
        const reannotationRounds = await sql`
            SELECT
                rr.id as round_id,
                rr.project_id,
                p.name as project_name,
                pg.name as group_name,
                rr.round_number,
                rr.task_group
            FROM reannotation_rounds rr
            JOIN projects p ON rr.project_id = p.id
            LEFT JOIN project_groups pg ON p.group_id = pg.id
            ORDER BY pg.name, p.name, rr.round_number, rr.task_group
        `;

        const allAnnotations = [];

        // 3. 處理初次標註專案（包含所有狀態）
        for (const project of initialProjects.rows) {
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
                    a.status,
                    a.skipped,
                    a.created_at
                FROM annotations a
                JOIN source_data sd ON a.source_data_id = sd.id
                JOIN users u ON a.user_id = u.id
                WHERE sd.project_id = ${project.project_id}
                    AND a.reannotation_round = 0
                ORDER BY a.source_data_id, a.user_id, a.version DESC, a.created_at DESC
            `;

            annotations.rows.forEach(ann => {
                allAnnotations.push({
                    group_name: project.group_name || '未分組',
                    project_name: project.project_name,
                    annotation_type: '初次標註',
                    round_number: 0,
                    task_group: '全部',
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

        // 4. 處理重標註輪次（包含所有狀態，混合重標註和原始資料）
        for (const round of reannotationRounds.rows) {
            const annotations = await sql`
                WITH reannotated_data AS (
                    -- 重標註的資料（使用最新版本）
                    SELECT DISTINCT ON (a.source_data_id, a.user_id)
                        a.source_data_id,
                        a.user_id,
                        a.promise_status,
                        a.verification_timeline,
                        a.evidence_status,
                        a.evidence_quality,
                        a.persist_answer,
                        a.reannotation_comment,
                        a.status,
                        a.skipped,
                        a.created_at
                    FROM annotations a
                    JOIN source_data sd ON a.source_data_id = sd.id
                    WHERE sd.project_id = ${round.project_id}
                        AND a.reannotation_round = ${round.round_number}
                    ORDER BY a.source_data_id, a.user_id, a.version DESC, a.created_at DESC
                ),
                original_data AS (
                    -- 原始資料（沒被重標註的）
                    SELECT DISTINCT ON (a.source_data_id, a.user_id)
                        a.source_data_id,
                        a.user_id,
                        a.promise_status,
                        a.verification_timeline,
                        a.evidence_status,
                        a.evidence_quality,
                        a.persist_answer,
                        a.reannotation_comment,
                        a.status,
                        a.skipped,
                        a.created_at
                    FROM annotations a
                    JOIN source_data sd ON a.source_data_id = sd.id
                    WHERE sd.project_id = ${round.project_id}
                        AND a.reannotation_round = 0
                        AND a.source_data_id NOT IN (
                            SELECT DISTINCT source_data_id
                            FROM reannotated_data
                        )
                    ORDER BY a.source_data_id, a.user_id, a.version DESC, a.created_at DESC
                )
                SELECT
                    sd.id as source_data_id,
                    sd.original_data,
                    a.user_id,
                    u.username,
                    a.promise_status,
                    a.verification_timeline,
                    a.evidence_status,
                    a.evidence_quality,
                    a.persist_answer,
                    a.reannotation_comment,
                    a.status,
                    a.skipped,
                    a.created_at
                FROM (
                    SELECT * FROM reannotated_data
                    UNION ALL
                    SELECT * FROM original_data
                ) a
                JOIN source_data sd ON a.source_data_id = sd.id
                JOIN users u ON a.user_id = u.id
                WHERE sd.project_id = ${round.project_id}
                ORDER BY sd.id, a.user_id
            `;

            annotations.rows.forEach(ann => {
                allAnnotations.push({
                    group_name: round.group_name || '未分組',
                    project_name: round.project_name,
                    annotation_type: '重標註',
                    round_number: round.round_number,
                    task_group: round.task_group,
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

        // 5. 根據格式返回資料
        if (format === 'csv') {
            // 生成 CSV
            const headers = [
                '組別', '專案名稱', '標註類型', '輪次', '任務組別',
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
            return NextResponse.json({
                success: true,
                data: allAnnotations,
                totalCount: allAnnotations.length,
                summary: {
                    initialProjects: initialProjects.rows.length,
                    reannotationRounds: reannotationRounds.rows.length,
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
