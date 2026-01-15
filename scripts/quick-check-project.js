import { sql } from '@vercel/postgres';

const projectId = 42; // 組1_非資訊相關大學生_金融產業_mega_2886

const result = await sql`
    SELECT
        COUNT(DISTINCT user_id) as total_users,
        COUNT(DISTINCT source_data_id) as total_items,
        COUNT(*) as total_annotations
    FROM annotations a
    JOIN source_data sd ON a.source_data_id = sd.id
    WHERE sd.project_id = ${projectId}
        AND a.status = 'completed'
        AND (a.skipped IS NULL OR a.skipped = FALSE)
`;

console.log('專案統計:', result.rows[0]);

const users = await sql`
    SELECT
        user_id,
        COUNT(DISTINCT source_data_id) as items_annotated
    FROM annotations a
    JOIN source_data sd ON a.source_data_id = sd.id
    WHERE sd.project_id = ${projectId}
        AND a.status = 'completed'
        AND (a.skipped IS NULL OR a.skipped = FALSE)
    GROUP BY user_id
`;

console.log('\n各使用者標註數:');
users.rows.forEach(u => console.log(`  ${u.user_id}: ${u.items_annotated} 筆`));

process.exit(0);
