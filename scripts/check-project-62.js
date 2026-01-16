import { sql } from '@vercel/postgres';

const projectId = 62;

const users = await sql`
    SELECT user_id, COUNT(*) as count
    FROM annotations a
    JOIN source_data sd ON a.source_data_id = sd.id
    WHERE sd.project_id = ${projectId}
        AND a.status = 'completed'
    GROUP BY user_id
`;

console.log('專案 62 標註統計:');
users.rows.forEach(u => console.log(`  ${u.user_id}: ${u.count} 筆`));

const sample = await sql`
    SELECT
        a.source_data_id,
        a.user_id,
        a.reannotation_round,
        a.promise_status
    FROM annotations a
    JOIN source_data sd ON a.source_data_id = sd.id
    WHERE sd.project_id = ${projectId}
        AND a.status = 'completed'
    ORDER BY a.source_data_id, a.user_id
    LIMIT 15
`;

console.log('\n前幾筆標註詳情:');
let current = null;
sample.rows.forEach(r => {
    if (current !== r.source_data_id) {
        console.log(`\n資料 ${r.source_data_id}:`);
        current = r.source_data_id;
    }
    console.log(`  - ${r.user_id} (輪次${r.reannotation_round}): ${r.promise_status}`);
});

process.exit(0);
