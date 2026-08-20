import mysql from 'mysql2/promise';
import { config } from './config.js';

let pool;

export function getPool() {
  if (!pool) {
    const { queryTimeout: _queryTimeout, ...dbConfig } = config.db;
    pool = mysql.createPool({
      ...dbConfig,
      waitForConnections: true,
      connectionLimit: config.db.connectionLimit,
      queueLimit: config.db.queueLimit,
      charset: 'utf8mb4',
      decimalNumbers: true,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
    });
  }
  return pool;
}

export async function query(sql, params = [], options = {}) {
  const timeout = Number(options.timeout || config.db.queryTimeout);
  const [rows] = await getPool().execute({ sql, values: params, timeout });
  return rows;
}

export async function withTransaction(fn) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    // Mọi statement trong transaction cũng dùng query timeout, không chỉ query() ngoài transaction.
    const tx = {
      execute(sql, values = [], options = {}) {
        const timeout = Number(options.timeout || config.db.queryTimeout);
        return connection.execute({ sql, values, timeout });
      },
    };
    const result = await fn(tx);
    await connection.commit();
    return result;
  } catch (error) {
    try { await connection.rollback(); } catch { /* connection có thể đã mất */ }
    throw error;
  } finally {
    connection.release();
  }
}

export async function closePool() {
  if (!pool) return;
  const current = pool;
  pool = undefined;
  await current.end();
}

export async function ensureSubmissionReviewSchema() {
  const columns = await query(`SELECT COLUMN_NAME columnName
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'submissions'
      AND COLUMN_NAME IN ('teacher_feedback', 'teacher_reviewed_at')`);
  const existing = new Set(columns.map((column) => column.columnName));
  const additions = [
    ['teacher_feedback', 'ALTER TABLE submissions ADD COLUMN teacher_feedback TEXT NULL AFTER ai_summary'],
    ['teacher_reviewed_at', 'ALTER TABLE submissions ADD COLUMN teacher_reviewed_at DATETIME NULL AFTER teacher_feedback'],
  ];

  for (const [columnName, sql] of additions) {
    if (existing.has(columnName)) continue;
    try {
      await query(sql);
    } catch (error) {
      // Hai instance Render có thể cùng khởi động và cùng nhìn thấy cột chưa tồn tại.
      // Instance thêm sau được phép bỏ qua lỗi trùng cột, các lỗi DB khác vẫn phải báo thật.
      if (error?.code !== 'ER_DUP_FIELDNAME') throw error;
    }
  }
}

export async function ensureAssignmentAudioSchema() {
  await query(`CREATE TABLE IF NOT EXISTS assignment_audio (
    assignment_id BIGINT UNSIGNED PRIMARY KEY,
    file_name VARCHAR(255) NOT NULL,
    mime_type VARCHAR(80) NOT NULL,
    size_bytes INT UNSIGNED NOT NULL,
    audio_data LONGBLOB NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_assignment_audio_assignment FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

export async function ensureSchema() {
  try {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const schemaSql = await readFile(fileURLToPath(new URL('../sql/schema.sql', import.meta.url)), 'utf8');
    const statements = schemaSql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.startsWith('--') && !s.startsWith('/*'));
    for (const statement of statements) {
      await query(statement).catch(() => {});
    }
    console.log('[DB] Database schema verified & ready.');
  } catch (err) {
    console.warn('[DB NOTICE] Schema verification notice:', err?.message);
  }
}
