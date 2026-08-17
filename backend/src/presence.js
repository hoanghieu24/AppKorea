import { query } from './db.js';

const ONLINE_WINDOW_SECONDS = 130;

export async function ensurePresenceSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS user_presence (
      user_id BIGINT UNSIGNED PRIMARY KEY,
      last_login_at DATETIME NULL,
      last_seen_at DATETIME NULL,
      last_logout_at DATETIME NULL,
      login_count INT UNSIGNED NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_user_presence_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_user_presence_seen (last_seen_at),
      INDEX idx_user_presence_login (last_login_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function markLogin(userId) {
  await query(
    `INSERT INTO user_presence (user_id, last_login_at, last_seen_at, last_logout_at, login_count)
     VALUES (?, NOW(), NOW(), NULL, 1)
     ON DUPLICATE KEY UPDATE
       last_login_at = NOW(),
       last_seen_at = NOW(),
       last_logout_at = NULL,
       login_count = login_count + 1`,
    [userId],
  );
}

export async function markSeen(userId) {
  await query(
    `INSERT INTO user_presence (user_id, last_seen_at, login_count)
     VALUES (?, NOW(), 0)
     ON DUPLICATE KEY UPDATE last_seen_at = NOW()`,
    [userId],
  );
}

export async function markLogout(userId) {
  await query(
    `INSERT INTO user_presence (user_id, last_seen_at, last_logout_at, login_count)
     VALUES (?, NOW(), NOW(), 0)
     ON DUPLICATE KEY UPDATE last_seen_at = NOW(), last_logout_at = NOW()`,
    [userId],
  );
}

export const presenceSelectSql = `
  p.last_login_at AS last_login_at,
  p.last_seen_at AS last_seen_at,
  p.login_count AS login_count,
  CASE
    WHEN p.last_seen_at IS NOT NULL
      AND p.last_seen_at >= DATE_SUB(NOW(), INTERVAL ${ONLINE_WINDOW_SECONDS} SECOND)
      AND (p.last_logout_at IS NULL OR p.last_seen_at > p.last_logout_at)
    THEN 1 ELSE 0
  END AS is_online
`;

export const presenceOrderSql = `is_online DESC, role, full_name`;

export async function presenceSummary() {
  const rows = await query(`
    SELECT
      SUM(CASE WHEN u.active = 1 AND p.last_seen_at IS NOT NULL
        AND p.last_seen_at >= DATE_SUB(NOW(), INTERVAL ${ONLINE_WINDOW_SECONDS} SECOND)
        AND (p.last_logout_at IS NULL OR p.last_seen_at > p.last_logout_at)
        THEN 1 ELSE 0 END) AS onlineTotal,
      SUM(CASE WHEN u.active = 1 AND u.role = 'STUDENT' AND p.last_seen_at IS NOT NULL
        AND p.last_seen_at >= DATE_SUB(NOW(), INTERVAL ${ONLINE_WINDOW_SECONDS} SECOND)
        AND (p.last_logout_at IS NULL OR p.last_seen_at > p.last_logout_at)
        THEN 1 ELSE 0 END) AS onlineStudents,
      SUM(CASE WHEN u.active = 1 AND u.role = 'TEACHER' AND p.last_seen_at IS NOT NULL
        AND p.last_seen_at >= DATE_SUB(NOW(), INTERVAL ${ONLINE_WINDOW_SECONDS} SECOND)
        AND (p.last_logout_at IS NULL OR p.last_seen_at > p.last_logout_at)
        THEN 1 ELSE 0 END) AS onlineTeachers,
      SUM(CASE WHEN u.active = 1 AND u.role = 'ADMIN' AND p.last_seen_at IS NOT NULL
        AND p.last_seen_at >= DATE_SUB(NOW(), INTERVAL ${ONLINE_WINDOW_SECONDS} SECOND)
        AND (p.last_logout_at IS NULL OR p.last_seen_at > p.last_logout_at)
        THEN 1 ELSE 0 END) AS onlineAdmins
    FROM users u
    LEFT JOIN user_presence p ON p.user_id = u.id
  `);
  const row = rows[0] || {};
  return {
    onlineTotal: Number(row.onlineTotal || 0),
    onlineStudents: Number(row.onlineStudents || 0),
    onlineTeachers: Number(row.onlineTeachers || 0),
    onlineAdmins: Number(row.onlineAdmins || 0),
    onlineWindowSeconds: ONLINE_WINDOW_SECONDS,
  };
}
