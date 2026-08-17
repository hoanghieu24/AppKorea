import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const root = process.cwd();
const failures = [];
const ok = (condition, message) => { if (!condition) failures.push(message); };

async function text(path) { return readFile(join(root, path), 'utf8'); }

for (const path of ['package.json', 'package-lock.json', 'frontend/package.json', 'frontend/package-lock.json', 'frontend/vercel.json']) {
  try { JSON.parse(await text(path)); }
  catch (error) { failures.push(`${path}: JSON không hợp lệ (${error.message})`); }
}

const rootPackage = JSON.parse(await text('package.json'));
ok(rootPackage.workspaces?.includes('backend') && rootPackage.workspaces?.includes('frontend'), 'Root workspaces phải là backend/frontend.');
ok(!rootPackage.workspaces?.includes('server') && !rootPackage.workspaces?.includes('client'), 'Root workspaces còn path server/client cũ.');

const schema = await text('backend/sql/schema.sql');
function checkCreateTableDuplicateColumns(sql) {
  const createRe = /CREATE TABLE IF NOT EXISTS\s+`?([a-zA-Z0-9_]+)`?\s*\(([\s\S]*?)\) ENGINE=/g;
  let match;
  while ((match = createRe.exec(sql))) {
    const table = match[1];
    const seen = new Set();
    for (const line of match[2].split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || /^(PRIMARY|UNIQUE|INDEX|KEY|CONSTRAINT|FOREIGN|CHECK)\b/i.test(trimmed)) continue;
      const col = trimmed.match(/^`?([a-zA-Z0-9_]+)`?\s+/)?.[1]?.toLowerCase();
      if (!col) continue;
      if (seen.has(col)) failures.push(`Schema: cột ${table}.${col} bị khai báo trùng.`);
      seen.add(col);
    }
  }
}
checkCreateTableDuplicateColumns(schema);

const app = await text('backend/src/app.js');
ok(!app.includes("role = 'STUDENT' AND status = 'ACTIVE'"), 'Backend còn query users.status=ACTIVE sai schema.');
ok(!app.includes('s.created_at submittedAt'), 'Backend còn dùng s.created_at thay vì s.submitted_at.');
ok(app.includes("app.get('/api/tts', requireAuth, ttsRateLimiter"), 'TTS chưa được bảo vệ bởi auth + rate limit.');
ok(app.includes("app.get('/api/health'"), 'Thiếu health endpoint.');
ok(app.includes("SELECT DISTINCT cs.student_id") && app.includes("ct.teacher_id = ?"), 'Teacher ALL announcement chưa giới hạn theo lớp được giao.');
ok(app.includes('Bạn không có quyền gửi thông báo cho lớp này.'), 'Thiếu ownership check khi Teacher gửi thông báo theo classId.');
ok(app.includes('Bạn không có quyền dùng AI với dữ liệu bài này.'), 'Teacher AI context thiếu ownership check chống IDOR.');
ok(app.includes('loginIpRateLimiter, loginRateLimiter'), 'Login chưa có rate limit chống spray + giới hạn theo tài khoản.');
ok(schema.includes('CREATE TABLE IF NOT EXISTS user_presence'), 'Thiếu bảng user_presence cho trạng thái online.');
ok(app.includes("app.post('/api/auth/heartbeat', requireAuth"), 'Thiếu heartbeat presence có auth.');
ok(app.includes('presenceSummary()') && app.includes('presenceSelectSql'), 'Admin users chưa trả presence summary/trạng thái online.');

const config = await text('backend/src/config.js');
ok(config.includes('validateProductionConfig'), 'Thiếu production ENV validation.');
ok(config.includes("JWT_EXPIRES_IN") && config.includes("'1h'"), 'JWT access token chưa có default ngắn hạn.');
ok(config.includes('DB_QUEUE_LIMIT'), 'DB queue chưa có giới hạn cấu hình.');

const frontendApi = await text('frontend/src/api.js');
ok(!/localStorage\.setItem\([^\n]*token/i.test(frontendApi), 'Frontend đang persist token trực tiếp vào localStorage.');
ok(frontendApi.includes("credentials: 'include'"), 'Frontend fetch chưa gửi HttpOnly session cookie.');
const shell = await text('frontend/src/components/Shell.jsx');
ok(shell.includes("api('/auth/heartbeat'") && shell.includes('60_000'), 'Frontend chưa gửi heartbeat 60 giây.');
const adminManagement = await text('frontend/src/pages/AdminManagementPage.jsx');
ok(adminManagement.includes('Đăng nhập gần nhất') && adminManagement.includes('Số lần đăng nhập'), 'Admin chưa hiển thị lịch sử đăng nhập/presence.');

const legacy = await text('frontend/public/legacy/app.js');
const legacyHtml = await text('frontend/public/legacy/index.html');
ok(!legacy.includes('hq_api_key'), 'Legacy vẫn lưu Gemini API key trong localStorage.');
ok(!legacy.includes('generateContent?key='), 'Legacy vẫn gọi Gemini bằng API key từ browser.');
ok(!legacyHtml.includes('apiKeyInput'), 'Legacy settings vẫn có ô nhập API key.');
ok(!legacyHtml.includes('aistudio.google.com/apikey'), 'Legacy vẫn hướng học sinh đi lấy API key.');
ok(legacy.includes('const safeText = escapePracticeHtml(text);'), 'Legacy AI chat chưa escape nội dung trước innerHTML.');
ok(legacy.includes("return neutralizeMarkup(String(data.text || '')).trim();"), 'Legacy chưa trung hòa markup ở AI boundary.');
ok(!/innerHTML[^\n]*\$\{e\.message\}/.test(legacy), 'Legacy còn render error.message trực tiếp vào innerHTML.');

const readme = await text('README.md');
for (const fixed of ['Admin@123', 'Teacher@123', 'Student@123']) {
  ok(!readme.includes(fixed), `README còn mật khẩu demo cố định: ${fixed}`);
}

const vercel = JSON.parse(await text('frontend/vercel.json'));
const headersText = JSON.stringify(vercel.headers || []);
ok(headersText.includes('Content-Security-Policy'), 'Vercel thiếu CSP.');
ok(headersText.includes('X-Content-Type-Options'), 'Vercel thiếu X-Content-Type-Options.');

async function walk(dir) {
  const out = [];
  for (const name of await readdir(dir)) {
    if (['node_modules', '.git', 'dist', 'backups'].includes(name)) continue;
    const full = join(dir, name);
    const info = await stat(full);
    if (info.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out;
}
const sourceFiles = (await walk(root)).filter((path) => ['.js', '.jsx', '.json', '.md', '.html', '.env', '.example'].includes(extname(path)) || path.endsWith('.env.example'));
const secretPattern = /AIza[0-9A-Za-z_-]{25,}/g;
for (const file of sourceFiles) {
  const content = await readFile(file, 'utf8').catch(() => '');
  const matches = content.match(secretPattern) || [];
  for (const match of matches) {
    // Placeholder UI examples like "AIza..." do not match this minimum length.
    failures.push(`Có chuỗi trông giống Gemini API key trong ${relative(root, file)}: ${match.slice(0, 8)}…`);
  }
}

if (failures.length) {
  console.error(`Preflight thất bại (${failures.length}):`);
  failures.forEach((item) => console.error(`- ${item}`));
  process.exit(1);
}
console.log('Preflight OK: schema, auth storage, secrets, legacy AI và deploy config đã qua static check.');
