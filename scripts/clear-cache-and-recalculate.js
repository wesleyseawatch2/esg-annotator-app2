// Script to clear old cache and trigger recalculation
import { sql } from '@vercel/postgres';

async function clearCacheAndRecalculate() {
    try {
        console.log('=== 清除舊的一致性分數快取 ===\n');

        // 1. 檢查現有快取數量
        const beforeCount = await sql`
            SELECT COUNT(*) as count FROM agreement_scores_cache
        `;
        console.log(`清除前快取數量: ${beforeCount.rows[0].count}`);

        const beforeGlobalCount = await sql`
            SELECT COUNT(*) as count FROM global_alpha_cache
        `;
        console.log(`清除前 Global Alpha 快取數量: ${beforeGlobalCount.rows[0].count}\n`);

        // 2. 清除所有快取
        await sql`DELETE FROM agreement_scores_cache`;
        console.log('✓ 已清除 agreement_scores_cache');

        await sql`DELETE FROM global_alpha_cache`;
        console.log('✓ 已清除 global_alpha_cache\n');

        // 3. 驗證清除結果
        const afterCount = await sql`
            SELECT COUNT(*) as count FROM agreement_scores_cache
        `;
        const afterGlobalCount = await sql`
            SELECT COUNT(*) as count FROM global_alpha_cache
        `;

        console.log(`清除後快取數量: ${afterCount.rows[0].count}`);
        console.log(`清除後 Global Alpha 快取數量: ${afterGlobalCount.rows[0].count}\n`);

        console.log('=== 清除完成 ===');
        console.log('請到一致性分析儀表板點擊「執行智能分析」按鈕重新計算所有分數');

    } catch (error) {
        console.error('執行失敗:', error);
    } finally {
        process.exit(0);
    }
}

clearCacheAndRecalculate();
