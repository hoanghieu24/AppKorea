import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { createGunzip } from 'node:zlib';
import { config } from '../src/config.js';

const input = process.argv[2];
if (!input) throw new Error('Cách dùng: npm run db:restore -- /duong-dan/backup.sql.gz');
if (config.isProduction && process.env.ALLOW_PRODUCTION_RESTORE !== 'I_UNDERSTAND') {
  throw new Error('Đã chặn restore production. Chỉ chạy khi ALLOW_PRODUCTION_RESTORE=I_UNDERSTAND.');
}

const args = [
  `--host=${config.db.host}`,
  `--port=${config.db.port}`,
  `--user=${config.db.user}`,
  '--default-character-set=utf8mb4',
  config.db.database,
];
const mysql = spawn(process.env.MYSQL_BIN || 'mysql', args, {
  env: { ...process.env, MYSQL_PWD: config.db.password },
  stdio: ['pipe', 'inherit', 'pipe'],
});
let stderr = '';
mysql.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

const source = createReadStream(resolve(input));
const content = input.endsWith('.gz') ? source.pipe(createGunzip()) : source;
const pipePromise = pipeline(content, mysql.stdin);
const exitPromise = new Promise((resolveExit, rejectExit) => {
  mysql.on('error', rejectExit);
  mysql.on('close', (code) => code === 0 ? resolveExit() : rejectExit(new Error(stderr || `mysql exit ${code}`)));
});

await Promise.all([pipePromise, exitPromise]);
console.log('Restore hoàn tất. Hãy chạy smoke test trước khi mở traffic.');
