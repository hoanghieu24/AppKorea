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
