import { sql } from '@vercel/postgres';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

async function main() {
  try {
    // 從列表中提取的項目名稱關鍵詞
    const keywords = [
      'mega_2886', 'cathay_2882', 'ctbc_2891', '台新_2893', 'nbnc_2892', 'ksi_2883', 'yuanta_2885',
      'umc_2303', 'asen_3711', 'mediatek_2454', 'tsmc_2330',
      'acl_2395', 'wm_3045', 'emc_2383', 'novatek_3034', 'argan_3008', 'yageo_2327',
      'tchfc_5680', 'chailease_5871', 'esfh_2884', 'hnfhc_2880', 'scsb_5876', 'taishin_2887',
      'wistron_3231', 'btc_2301', 'avc_3017', 'pegation_4938', 'qci_2382', 'wiwynn_6669',
      'honhai_2317', 'icc_1101', 'fpc_1301', 'hotaimotor_2207', 'honhai_2317',
      'accton_2345', 'fpec_6446', 'wanhai_2615', 'fet_4904', 'fpcc_6505', 'ymtc_2609', 'upc_1303'
    ];

    // 查詢所有包含這些關鍵詞的項目
    const { rows: projects } = await sql`
      SELECT id, name 
      FROM projects
      ORDER BY id
    `;

    const filteredProjects = projects.filter(p => {
      const nameLower = p.name.toLowerCase();
      return keywords.some(kw => nameLower.includes(kw.toLowerCase()));
    });

    console.log(`找到 ${filteredProjects.length} 個匹配的項目:\n`);
    filteredProjects.forEach(p => {
      console.log(`${p.id}: ${p.name}`);
    });

  } catch (error) {
    console.error('錯誤:', error);
  }
}

main();
