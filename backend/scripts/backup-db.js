import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { createGzip } from 'node:zlib';
import { config } from '../src/config.js';

const outputDir = resolve(process.env.BACKUP_DIR || './backups');
mkdirSync(outputDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const output = resolve(outputDir, `${config.db.database}-${stamp}.sql.gz`);
mkdirSync(dirname(output), { recursive: true });

const args = [
  `--host=${config.db.host}`,
  `--port=${config.db.port}`,
  `--user=${config.db.user}`,
  '--single-transaction',
  '--quick',
  '--skip-lock-tables',
  '--default-character-set=utf8mb4',
  config.db.database,
];

const dump = spawn(process.env.MYSQLDUMP_BIN || 'mysqldump', args, {
  env: { ...process.env, MYSQL_PWD: config.db.password },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stderr = '';
dump.stderr.on('data', (chunk) => { stderr += chunk.toString(); });

const pipePromise = pipeline(dump.stdout, createGzip({ level: 9 }), createWriteStream(output));
const exitPromise = new Promise((resolveExit, rejectExit) => {
  dump.on('error', rejectExit);
  dump.on('close', (code) => code === 0 ? resolveExit() : rejectExit(new Error(stderr || `mysqldump exit ${code}`)));
});

await Promise.all([pipePromise, exitPromise]);
console.log(`Backup đã tạo: ${output}`);
