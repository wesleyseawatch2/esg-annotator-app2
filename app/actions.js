// 檔案路徑: app/actions.js
'use server';
import { sql } from '@vercel/postgres';
import { revalidatePath } from 'next/cache';

export async function registerUser(username, password) {
  try {
    const { rows } = await sql`SELECT * FROM users WHERE username = ${username};`;
    if (rows.length > 0) {
      return { success: false, error: '此使用者名稱已被註冊' };
    }
    await sql`INSERT INTO users (username, password) VALUES (${username}, ${password});`;
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function loginUser(username, password) {
  try {
    const { rows } = await sql`SELECT * FROM users WHERE username = ${username};`;
    if (rows.length === 0) {
      return { success: false, error: '找不到此使用者' };
    }
    const user = rows[0];
    if (user.password !== password) {
      return { success: false, error: '密碼錯誤' };
    }
    return { success: true, user: { id: user.id, username: user.username, role: user.role } }; 
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function getProjectsWithProgress(userId) {
  try {
    const { rows } = await sql`
      SELECT
        p.id,
        p.name,
        p.page_offset,
        (SELECT COUNT(*) FROM source_data WHERE project_id = p.id) as total_tasks,
        (
          SELECT COUNT(*)
          FROM annotations a
          WHERE a.user_id = ${userId}
          AND a.source_data_id IN (SELECT id FROM source_data WHERE project_id = p.id)
        ) as completed_tasks
      FROM projects p
      ORDER BY p.name;
    `;
    return { projects: rows };
  } catch (error) {
    return { error: error.message };
  }
}

export async function getNextTaskForUser(projectId, userId) {
  try {
    const { rows } = await sql`
      SELECT sd.*
      FROM source_data sd
      WHERE sd.project_id = ${projectId}
      AND NOT EXISTS (
        SELECT 1 FROM annotations a WHERE a.source_data_id = sd.id AND a.user_id = ${userId}
      )
      ORDER BY sd.page_number, sd.id
      LIMIT 1;
    `;

    if (rows.length > 0) {
        return { task: rows[0] };
    }
    
    return { task: null };
  } catch (error) {
    return { error: error.message };
  }
}

export async function getPreviousTaskForUser(projectId, userId, currentId) {
  try {
    const { rows } = await sql`
      SELECT 
        sd.*,
        a.esg_type,
        a.promise_status,
        a.promise_string,
        a.verification_timeline,
        a.evidence_status,
        a.evidence_string,
        a.evidence_quality
      FROM source_data sd
      JOIN annotations a ON sd.id = a.source_data_id
      WHERE sd.project_id = ${projectId} 
      AND a.user_id = ${userId}
      AND sd.id < ${currentId}
      ORDER BY sd.page_number DESC, sd.id DESC
      LIMIT 1;
    `;

    if (rows.length > 0) {
        return { task: rows[0] };
    }
    
    return { task: null };
  } catch (error) {
    return { error: error.message };
  }
}

export async function resetProjectAnnotations(projectId, userId) {
  try {
    await sql`
      DELETE FROM annotations 
      WHERE user_id = ${userId} 
      AND source_data_id IN (
        SELECT id FROM source_data WHERE project_id = ${projectId}
      );
    `;
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function saveAnnotation(data) {
  const {
    source_data_id, user_id, esg_type, promise_status,
    promise_string, verification_timeline, evidence_status,
    evidence_string, evidence_quality
  } = data;
  try {
    // 將字串轉換為陣列（如果是逗號分隔的字串）
    const esgTypeArray = typeof esg_type === 'string' ? esg_type.split(',').filter(Boolean) : esg_type;

    await sql`
      INSERT INTO annotations (
        source_data_id, user_id, esg_type, promise_status, promise_string,
        verification_timeline, evidence_status, evidence_string, evidence_quality, status, updated_at
      ) VALUES (
        ${source_data_id}, ${user_id}, ${esgTypeArray}, ${promise_status}, ${promise_string},
        ${verification_timeline}, ${evidence_status}, ${evidence_string}, ${evidence_quality}, 'completed', NOW()
      )
      ON CONFLICT (source_data_id, user_id)
      DO UPDATE SET
        esg_type = EXCLUDED.esg_type,
        promise_status = EXCLUDED.promise_status,
        promise_string = EXCLUDED.promise_string,
        verification_timeline = EXCLUDED.verification_timeline,
        evidence_status = EXCLUDED.evidence_status,
        evidence_string = EXCLUDED.evidence_string,
        evidence_quality = EXCLUDED.evidence_quality,
        status = 'completed',
        updated_at = NOW();
    `;
    revalidatePath('/');
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

export async function getAllUsersProgress() {
  try {
    const { rows } = await sql`
      SELECT
        u.id as user_id,
        u.username,
        u.role,
        p.id as project_id,
        p.name as project_name,
        (SELECT COUNT(*) FROM source_data WHERE project_id = p.id) as total_tasks,
        (
          SELECT COUNT(*)
          FROM annotations a
          WHERE a.user_id = u.id
          AND a.source_data_id IN (SELECT id FROM source_data WHERE project_id = p.id)
        ) as completed_tasks
      FROM users u
      CROSS JOIN projects p
      ORDER BY p.name, u.username;
    `;
    return { success: true, data: rows };
  } catch (error) {
    return { success: false, error: error.message };
  }
}