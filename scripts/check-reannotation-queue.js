// 檢查重標註任務佇列
import { sql } from '@vercel/postgres';

async function checkReannotationQueue() {
    try {
        console.log('=== 檢查重標註任務佇列 ===\n');

        // 1. 檢查 reannotation_rounds 表
        console.log('1️⃣ 檢查 reannotation_rounds 表:');
        const rounds = await sql`
            SELECT
                rr.id,
                rr.project_id,
                p.name as project_name,
                rr.round_number,
                rr.task_group,
                rr.threshold,
                rr.status,
                rr.created_at
            FROM reannotation_rounds rr
            JOIN projects p ON rr.project_id = p.id
            ORDER BY rr.created_at DESC
            LIMIT 10
        `;

        if (rounds.rows.length === 0) {
            console.log('   ❌ 沒有找到任何重標註輪次！');
            console.log('   這就是為什麼你看不到重標註任務的原因。\n');
        } else {
            console.log(`   ✅ 找到 ${rounds.rows.length} 個重標註輪次:\n`);
            rounds.rows.forEach(r => {
                console.log(`   Round ${r.round_number} - ${r.project_name}`);
                console.log(`   └─ ID: ${r.id}, Group: ${r.task_group}, Status: ${r.status}, Threshold: ${r.threshold}`);
                console.log(`   └─ 建立時間: ${r.created_at}\n`);
            });
        }

        // 2. 檢查 reannotation_tasks 表
        console.log('\n2️⃣ 檢查 reannotation_tasks 表:');
        const tasks = await sql`
            SELECT
                rt.id,
                rt.round_id,
                rt.user_id,
                rt.source_data_id,
                rt.task_group,
                rt.status,
                rt.tasks_flagged
            FROM reannotation_tasks rt
            ORDER BY rt.assigned_at DESC
            LIMIT 10
        `;

        if (tasks.rows.length === 0) {
            console.log('   ❌ 沒有找到任何重標註任務！\n');
        } else {
            console.log(`   ✅ 找到 ${tasks.rows.length} 個重標註任務:\n`);
            tasks.rows.forEach(t => {
                console.log(`   Task ID: ${t.id}`);
                console.log(`   └─ Round: ${t.round_id}, User: ${t.user_id}, Source: ${t.source_data_id}`);
                console.log(`   └─ Group: ${t.task_group}, Status: ${t.status}`);
                console.log(`   └─ Flagged: ${JSON.stringify(t.tasks_flagged)}\n`);
            });
        }

        // 3. 檢查一致性分數
        console.log('\n3️⃣ 檢查一致性分數 (低於 0.8 的項目):');
        const lowScores = await sql`
            SELECT
                asc.project_id,
                p.name as project_name,
                asc.source_data_id,
                asc.task_name,
                asc.local_score,
                asc.round_number
            FROM agreement_scores_cache asc
            JOIN source_data sd ON asc.source_data_id = sd.id
            JOIN projects p ON asc.project_id = p.id
            WHERE asc.local_score < 0.8
                AND asc.round_number = 0
            ORDER BY asc.local_score ASC
            LIMIT 10
        `;

        if (lowScores.rows.length === 0) {
            console.log('   ℹ️  沒有找到分數低於 0.8 的項目\n');
        } else {
            console.log(`   ⚠️  找到 ${lowScores.rows.length} 個低分項目:\n`);
            lowScores.rows.forEach(s => {
                console.log(`   ${s.project_name} - Source ${s.source_data_id}`);
                console.log(`   └─ ${s.task_name}: ${s.local_score.toFixed(3)}\n`);
            });
        }

        // 4. 模擬查詢重標註任務 (使用 wesley 的 userId)
        console.log('\n4️⃣ 模擬查詢 wesley 的重標註任務:');

        // 先找 wesley 的 user_id
        const user = await sql`SELECT id, username FROM users WHERE username = 'wesley'`;

        if (user.rows.length === 0) {
            console.log('   ❌ 找不到 wesley 使用者\n');
        } else {
            const userId = user.rows[0].id;
            console.log(`   ✅ wesley 的 user_id: ${userId}\n`);

            // 查詢重標註任務
            const userTasks = await sql`
                SELECT
                    rt.id as task_id,
                    rt.source_data_id,
                    rt.task_group,
                    rt.status,
                    rr.round_number,
                    rr.status as round_status,
                    p.name as project_name
                FROM reannotation_tasks rt
                JOIN reannotation_rounds rr ON rt.round_id = rr.id
                JOIN projects p ON rr.project_id = p.id
                WHERE rt.user_id = ${userId}
                ORDER BY rt.assigned_at DESC
                LIMIT 10
            `;

            if (userTasks.rows.length === 0) {
                console.log('   ❌ wesley 沒有被分配任何重標註任務！');
                console.log('   原因可能是：');
                console.log('   1. 沒有建立重標註輪次 (reannotation_rounds)');
                console.log('   2. 沒有指派任務給 wesley (reannotation_tasks)');
                console.log('   3. 輪次狀態不是 active\n');
            } else {
                console.log(`   ✅ wesley 有 ${userTasks.rows.length} 個重標註任務:\n`);
                userTasks.rows.forEach(t => {
                    console.log(`   ${t.project_name} - Round ${t.round_number}`);
                    console.log(`   └─ Task ID: ${t.task_id}, Group: ${t.task_group}`);
                    console.log(`   └─ Status: ${t.status}, Round Status: ${t.round_status}\n`);
                });
            }
        }

        console.log('\n=== 診斷結果 ===\n');
        console.log('如果你看不到重標註任務，可能的原因：');
        console.log('1. ❌ 沒有建立重標註輪次 → 需要管理員在後台建立');
        console.log('2. ❌ 沒有分配任務給使用者 → 需要管理員指派任務');
        console.log('3. ❌ 輪次狀態不是 active → 需要啟動輪次');
        console.log('4. ℹ️  目前沒有低於門檻的項目 → 一致性已經很好了！\n');

    } catch (error) {
        console.error('檢查失敗:', error);
    } finally {
        process.exit(0);
    }
}

checkReannotationQueue();
