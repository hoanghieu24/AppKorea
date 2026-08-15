import mysql from 'mysql2/promise';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';

if (!/^[a-zA-Z0-9_]+$/.test(config.db.database)) {
  throw new Error('DB_NAME chỉ được chứa chữ, số và dấu gạch dưới.');
}

const connectionOptions = {
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  connectTimeout: config.db.connectTimeout,
  ssl: config.db.ssl || undefined,
  multipleStatements: true,
};

// Hosting production thường cấp sẵn DB và không cho user CREATE DATABASE.
// Local/dev mới tự tạo database nếu chưa có.
const connection = await mysql.createConnection(
  config.isProduction
    ? { ...connectionOptions, database: config.db.database }
    : connectionOptions,
);

try {
  if (!config.isProduction) {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${config.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.query(`USE \`${config.db.database}\``);
  }
  const schema = await readFile(fileURLToPath(new URL('../sql/schema.sql', import.meta.url)), 'utf8');
  await connection.query(schema);
  console.log(`Database ${config.db.database} đã sẵn sàng.`);
} finally {
  await connection.end();
}
