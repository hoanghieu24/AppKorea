import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { z } from 'zod';
import { config } from './config.js';
import { query, withTransaction } from './db.js';
import { cleanupRefreshTokens, issueRefreshToken, requireAuth, requireRole, revokeAllRefreshTokensForUser, revokeRefreshToken, rotateRefreshToken, signToken, verifyPassword, hashPassword } from './auth.js';
import { aiEnabled, aiErrorResponse, generateTextWithAI, gradeEssayBatchWithAI, testGeminiConnection } from './ai.js';
import { addGeminiApiKeys, deleteGeminiApiKey, getAdminSettings, getGeminiApiKeySecretById, getSafeLearningSettings, saveAdminSettings, setGeminiApiKeyActive, updateGeminiKeyHealth } from './settings.js';
import { attemptAnswersMatch, gradeEssayFallback, gradeObjective, questionPromptForAi, reusableAttemptResult, shouldGradeWithAI } from './grading.js';
import { ensureTextbookCatalog, getTextbookLessons, getTextbookVocabulary } from './textbook.js';
import { createConcurrencyGuard, createRateLimiter } from './rateLimit.js';
import { recordSystemError, requestContextMiddleware, sanitizeLogText } from './monitoring.js';
import { markLogin, markLogout, markSeen, presenceOrderSql, presenceSelectSql, presenceSummary } from './presence.js';

const app = express();

app.set('trust proxy', config.trustProxy);
app.disable('x-powered-by');
app.use(requestContextMiddleware);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  credentials: true,
  origin(origin, callback) {
    // Cho phép server-to-server/curl không có Origin; browser chỉ được phép từ CLIENT_URL.
    if (!origin || config.clientUrls.includes(String(origin).replace(/\/$/, ''))) return callback(null, true);
    return callback(new Error('CORS_ORIGIN_DENIED'));
  },
}));
app.use(express.json({ limit: '1mb' }));

const generalRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: config.rateLimits.generalPerMinute,
  message: 'Bạn gửi quá nhiều yêu cầu trong thời gian ngắn. Vui lòng thử lại sau một chút.',
});
const loginRateLimiter = createRateLimiter({
  windowMs: 15 * 60_000,
  max: config.rateLimits.loginPer15Minutes,
  // Không khóa cả lớp khi nhiều học sinh cùng dùng một Wi-Fi/NAT: giới hạn theo IP + email.
  keyGenerator: (req) => `login:${req.ip}:${String(req.body?.email || '').trim().toLowerCase()}`,
  message: 'Tài khoản này có quá nhiều lần đăng nhập trong thời gian ngắn. Vui lòng chờ rồi thử lại.',
});
const loginIpRateLimiter = createRateLimiter({
  windowMs: 15 * 60_000,
  max: config.rateLimits.loginIpPer15Minutes,
  keyGenerator: (req) => `login-ip:${req.ip}`,
  message: 'Có quá nhiều lượt đăng nhập từ mạng này. Vui lòng chờ rồi thử lại.',
});
const refreshRateLimiter = createRateLimiter({
  windowMs: 15 * 60_000,
  max: config.rateLimits.refreshPer15Minutes,
  message: 'Có quá nhiều lần làm mới phiên đăng nhập. Vui lòng thử lại sau một chút.',
});
const aiRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: config.rateLimits.aiPerMinute,
  keyGenerator: (req) => `ai:${req.user?.id || req.ip}`,
  message: 'Bạn đang gửi yêu cầu AI quá nhanh. Hãy đợi vài giây rồi tiếp tục học nhé.',
});
const aiConcurrencyGuard = createConcurrencyGuard({
  max: config.rateLimits.aiConcurrentPerUser,
  keyGenerator: (req) => `ai:${req.user?.id || req.ip}`,
  message: 'Bạn đang có quá nhiều câu hỏi AI xử lý cùng lúc. Hãy chờ câu trước hoàn tất.',
});
const ttsRateLimiter = createRateLimiter({
  windowMs: 60_000,
  max: config.rateLimits.ttsPerMinute,
  keyGenerator: (req) => `tts:${req.user?.id || req.ip}`,
  message: 'Bạn đang phát âm quá nhanh. Vui lòng thử lại sau vài giây.',
});

app.use('/api', generalRateLimiter);

const idSchema = z.coerce.number().int().positive();
const pageSchema = z.coerce.number().int().min(1).max(100000);
const pageSizeSchema = z.coerce.number().int().min(1).max(100);

function getPagination(req, defaultPageSize = 10) {
  if (req.query.page === undefined && req.query.pageSize === undefined) return null;
  const page = pageSchema.safeParse(req.query.page ?? 1);
  const pageSize = pageSizeSchema.safeParse(req.query.pageSize ?? defaultPageSize);
  if (!page.success || !pageSize.success) return null;
  return { page: page.data, pageSize: pageSize.data, offset: (page.data - 1) * pageSize.data };
}

function getNamedPagination(req, name, defaultPageSize = 6) {
  const rawPage = req.query[`${name}Page`];
  if (rawPage === undefined) return null;
  const page = pageSchema.safeParse(rawPage);
  const pageSize = pageSizeSchema.safeParse(req.query.pageSize ?? defaultPageSize);
  if (!page.success || !pageSize.success) return null;
  return { page: page.data, pageSize: pageSize.data, offset: (page.data - 1) * pageSize.data };
}

function paginationMeta(total, pagination) {
  const safeTotal = Number(total || 0);
  return {
    page: pagination.page,
    pageSize: pagination.pageSize,
    total: safeTotal,
    totalPages: Math.max(1, Math.ceil(safeTotal / pagination.pageSize)),
    hasNext: pagination.page * pagination.pageSize < safeTotal,
    hasPrevious: pagination.page > 1,
  };
}

// LIMIT/OFFSET là số đã đi qua Zod ở getPagination/getNamedPagination.
// Nội suy hai số này tránh lỗi ER_WRONG_ARGUMENTS của một số MySQL/mysql2
// khi LIMIT/OFFSET được gửi dưới dạng prepared-statement parameters.
function paginationLimitSql(pagination) {
  if (!pagination) return '';
  return ` LIMIT ${Number(pagination.pageSize)} OFFSET ${Number(pagination.offset)}`;
}

function userDto(row) {
  const dto = { id: row.id, email: row.email, fullName: row.full_name, role: row.role, active: Boolean(row.active) };
  if (Object.prototype.hasOwnProperty.call(row, 'is_online')) dto.isOnline = Boolean(row.is_online);
  if (Object.prototype.hasOwnProperty.call(row, 'last_login_at')) dto.lastLoginAt = row.last_login_at || null;
  if (Object.prototype.hasOwnProperty.call(row, 'last_seen_at')) dto.lastSeenAt = row.last_seen_at || null;
  if (Object.prototype.hasOwnProperty.call(row, 'login_count')) dto.loginCount = Number(row.login_count || 0);
  return dto;
}

async function teacherOwnsClass(teacherId, classId) {
  const rows = await query('SELECT 1 FROM class_teachers WHERE teacher_id = ? AND class_id = ? LIMIT 1', [teacherId, classId]);
  return rows.length > 0;
}

async function studentBelongsToClass(studentId, classId) {
  const rows = await query('SELECT 1 FROM class_students WHERE student_id = ? AND class_id = ? LIMIT 1', [studentId, classId]);
  return rows.length > 0;
}

async function canReadClass(user, classId) {
  if (user.role === 'ADMIN') return true;
  if (user.role === 'TEACHER') return teacherOwnsClass(user.id, classId);
  return studentBelongsToClass(user.id, classId);
}

async function canManageClass(user, classId) {
  if (user.role === 'ADMIN') return true;
  return user.role === 'TEACHER' && teacherOwnsClass(user.id, classId);
}

function badRequest(res, message) {
  return res.status(400).json({ message });
}

app.get('/api/health', async (_req, res) => {
  const started = Date.now();
  try {
    const healthTimeout = Math.min(config.db.queryTimeout, 5000);
    await query('SELECT 1', [], { timeout: healthTimeout });
    // Bắt lỗi deploy quên chạy db:init trước khi traffic thật đi vào auth/monitoring.
    await Promise.all([
      query('SELECT 1 FROM auth_refresh_tokens LIMIT 0', [], { timeout: healthTimeout }),
      query('SELECT 1 FROM ai_api_keys LIMIT 0', [], { timeout: healthTimeout }),
      query('SELECT 1 FROM ai_usage_events LIMIT 0', [], { timeout: healthTimeout }),
      query('SELECT 1 FROM system_error_logs LIMIT 0', [], { timeout: healthTimeout }),
      query('SELECT 1 FROM user_presence LIMIT 0', [], { timeout: healthTimeout }),
    ]);
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      ok: true,
      database: 'connected',
      schema: 'ready',
      databaseLatencyMs: Date.now() - started,
      ai: await aiEnabled(),
      uptimeSeconds: Math.round(process.uptime()),
    });
  } catch (error) {
    res.setHeader('Cache-Control', 'no-store');
    const schemaMissing = error?.code === 'ER_NO_SUCH_TABLE';
    res.status(503).json({
      ok: false,
      database: schemaMissing ? 'connected' : 'disconnected',
      schema: schemaMissing ? 'migration_required' : 'unknown',
      ai: false,
    });
  }
});

app.post('/api/auth/login', loginIpRateLimiter, loginRateLimiter, async (req, res) => {
  const input = z.object({ email: z.string().email().max(190), password: z.string().min(6).max(200) }).safeParse(req.body);
  if (!input.success) return badRequest(res, 'Email hoặc mật khẩu chưa hợp lệ.');

  const rows = await query('SELECT * FROM users WHERE email = ? AND active = 1 LIMIT 1', [input.data.email.toLowerCase()]);
  const user = rows[0];
  if (!user || !(await verifyPassword(input.data.password, user.password_hash))) {
    return res.status(401).json({ message: 'Email hoặc mật khẩu không đúng.' });
  }
  await issueRefreshToken(user.id, req, res);
  await markLogin(user.id).catch((error) => console.warn('[presence] markLogin failed:', error?.message || error));
  res.setHeader('Cache-Control', 'no-store');
  res.json({ token: signToken(user), user: userDto(user) });
});

app.post('/api/auth/refresh', refreshRateLimiter, async (req, res) => {
  const user = await rotateRefreshToken(req, res);
  if (!user) return res.status(401).json({ message: 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.' });
  await markSeen(user.id).catch((error) => console.warn('[presence] markSeen on refresh failed:', error?.message || error));
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ token: signToken(user), user: userDto(user) });
});

app.post('/api/auth/logout', requireAuth, async (req, res) => {
  await revokeRefreshToken(req, res);
  await markLogout(req.user.id).catch((error) => console.warn('[presence] markLogout failed:', error?.message || error));
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ message: 'Đã đăng xuất.' });
});

app.post('/api/auth/session', requireAuth, async (req, res) => {
  // Endpoint chuyển phiên bản cũ (JWT từng lưu localStorage) sang refresh cookie HttpOnly.
  await issueRefreshToken(req.user.id, req, res);
  await markSeen(req.user.id).catch((error) => console.warn('[presence] markSeen on session failed:', error?.message || error));
  res.setHeader('Cache-Control', 'no-store');
  return res.json({ token: signToken(req.user), user: userDto(req.user) });
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ user: userDto(req.user) });
});

app.post('/api/auth/heartbeat', requireAuth, async (req, res) => {
  await markSeen(req.user.id);
  res.setHeader('Cache-Control', 'no-store');
  return res.status(204).end();
});

app.get('/api/classes', requireAuth, async (req, res) => {
  let sql = `SELECT c.id, c.name, c.code, c.description,
    COUNT(DISTINCT cs.student_id) studentCount, COUNT(DISTINCT ct.teacher_id) teacherCount
    FROM classes c
    LEFT JOIN class_students cs ON cs.class_id = c.id
    LEFT JOIN class_teachers ct ON ct.class_id = c.id`;
  const params = [];
  const conditions = ['c.active = 1'];
  if (req.user.role === 'TEACHER') {
    conditions.push('EXISTS (SELECT 1 FROM class_teachers mine WHERE mine.class_id = c.id AND mine.teacher_id = ?)');
    params.push(req.user.id);
  } else if (req.user.role === 'STUDENT') {
    conditions.push('EXISTS (SELECT 1 FROM class_students mine WHERE mine.class_id = c.id AND mine.student_id = ?)');
    params.push(req.user.id);
  }
  sql += ` WHERE ${conditions.join(' AND ')}`;
  sql += ' GROUP BY c.id ORDER BY c.created_at DESC';
  res.json({ classes: await query(sql, params) });
});

app.get('/api/classes/:id/members', requireAuth, async (req, res) => {
  const classId = idSchema.parse(req.params.id);
  if (!(await canManageClass(req.user, classId))) return res.status(403).json({ message: 'Không có quyền xem lớp này.' });
  const teacherPagination = getNamedPagination(req, 'teacher', 6);
  const studentPagination = getNamedPagination(req, 'student', 6);
  if (!teacherPagination && !studentPagination) {
    const [teachers, students] = await Promise.all([
      query(`SELECT u.id, u.full_name fullName, u.email FROM class_teachers ct JOIN users u ON u.id = ct.teacher_id
             WHERE ct.class_id = ? ORDER BY u.full_name`, [classId]),
      query(`SELECT u.id, u.full_name fullName, u.email,
             ROUND(AVG(s.percentage),1) averageScore, COUNT(s.id) submissions
             FROM class_students cs JOIN users u ON u.id = cs.student_id
             LEFT JOIN submissions s ON s.student_id = u.id
               AND s.assignment_id IN (SELECT id FROM assignments WHERE class_id = ?)
             WHERE cs.class_id = ? GROUP BY u.id ORDER BY u.full_name`, [classId, classId]),
    ]);
    return res.json({ teachers, students });
  }
  const tp = teacherPagination || { page: 1, pageSize: 6, offset: 0 };
  const sp = studentPagination || { page: 1, pageSize: 6, offset: 0 };
  const [teacherTotals, studentTotals, teacherIds, studentIds, teachers, students] = await Promise.all([
    query('SELECT COUNT(*) total FROM class_teachers WHERE class_id = ?', [classId]),
    query('SELECT COUNT(*) total FROM class_students WHERE class_id = ?', [classId]),
    query('SELECT teacher_id id FROM class_teachers WHERE class_id = ?', [classId]),
    query('SELECT student_id id FROM class_students WHERE class_id = ?', [classId]),
    query(`SELECT u.id, u.full_name fullName, u.email FROM class_teachers ct JOIN users u ON u.id = ct.teacher_id
           WHERE ct.class_id = ? ORDER BY u.full_name${paginationLimitSql(tp)}`, [classId]),
    query(`SELECT u.id, u.full_name fullName, u.email,
           ROUND(AVG(s.percentage),1) averageScore, COUNT(s.id) submissions
           FROM class_students cs JOIN users u ON u.id = cs.student_id
           LEFT JOIN submissions s ON s.student_id = u.id
             AND s.assignment_id IN (SELECT id FROM assignments WHERE class_id = ?)
           WHERE cs.class_id = ? GROUP BY u.id ORDER BY u.full_name${paginationLimitSql(sp)}`, [classId, classId]),
  ]);
  res.json({
    teachers,
    students,
    teacherIds: teacherIds.map((item) => Number(item.id)),
    studentIds: studentIds.map((item) => Number(item.id)),
    teacherPagination: paginationMeta(teacherTotals[0]?.total, tp),
    studentPagination: paginationMeta(studentTotals[0]?.total, sp),
  });
});

app.get('/api/teacher/students', requireAuth, requireRole('TEACHER', 'ADMIN'), async (req, res) => {
  const pagination = getPagination(req, 10);
  const classId = req.query.classId ? Number(req.query.classId) : null;
  const keyword = String(req.query.q || '').trim();

  const conditions = ["u.role = 'STUDENT'"];
  const params = [];

  if (req.user.role === 'TEACHER') {
    conditions.push('EXISTS (SELECT 1 FROM class_teachers ct WHERE ct.class_id = cs.class_id AND ct.teacher_id = ?)');
    params.push(req.user.id);
  }

  if (classId) {
    conditions.push('cs.class_id = ?');
    params.push(classId);
  }

  if (keyword) {
    conditions.push('(u.full_name LIKE ? OR u.email LIKE ?)');
    params.push(`%${keyword}%`, `%${keyword}%`);
  }

  const whereSql = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const totalRows = await query(
    `SELECT COUNT(*) total FROM (
       SELECT u.id, cs.class_id
       FROM users u
       JOIN class_students cs ON cs.student_id = u.id
       JOIN classes c ON c.id = cs.class_id
       ${whereSql}
     ) t`,
    params
  );

  const limitSql = paginationLimitSql(pagination);

  const students = await query(
    `SELECT u.id, u.email, u.full_name fullName, u.active,
            c.id classId, c.name className, c.code classCode,
            (SELECT COUNT(*) FROM submissions s JOIN assignments a ON a.id = s.assignment_id WHERE s.student_id = u.id AND a.class_id = c.id) submissionCount,
            (SELECT AVG(s.percentage) FROM submissions s JOIN assignments a ON a.id = s.assignment_id WHERE s.student_id = u.id AND a.class_id = c.id) avgPercentage
     FROM users u
     JOIN class_students cs ON cs.student_id = u.id
     JOIN classes c ON c.id = cs.class_id
     ${whereSql}
     ORDER BY c.name, u.full_name
     ${limitSql}`,
    params
  );

  res.json({
    students: students.map((s) => ({
      ...s,
      active: Boolean(s.active),
      submissionCount: Number(s.submissionCount || 0),
      avgPercentage: s.avgPercentage != null ? Math.round(Number(s.avgPercentage)) : null,
    })),
    pagination: paginationMeta(totalRows[0]?.total || 0, pagination),
  });
});

app.get('/api/admin/users', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const role = ['ADMIN', 'TEACHER', 'STUDENT'].includes(req.query.role) ? req.query.role : null;
  const keyword = String(req.query.q || '').trim().slice(0, 120);
  const conditions = [];
  const params = [];
  if (role) { conditions.push('u.role = ?'); params.push(role); }
  if (keyword) { conditions.push('(u.full_name LIKE ? OR u.email LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const pagination = req.query.all === '1' ? null : getPagination(req, 10);
  const select = `SELECT u.id, u.email, u.full_name, u.role, u.active, ${presenceSelectSql}
                  FROM users u LEFT JOIN user_presence p ON p.user_id = u.id`;
  const [summary] = await Promise.all([presenceSummary()]);
  let rows;
  if (pagination) {
    const totals = await query(`SELECT COUNT(*) total FROM users u ${where}`, params);
    rows = await query(`${select} ${where} ORDER BY ${presenceOrderSql}${paginationLimitSql(pagination)}`, params);
    return res.json({ users: rows.map(userDto), pagination: paginationMeta(totals[0]?.total, pagination), presence: summary });
  }
  rows = await query(`${select} ${where} ORDER BY ${presenceOrderSql}`, params);
  res.json({ users: rows.map(userDto), pagination: null, presence: summary });
});

app.post('/api/admin/users', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const input = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    fullName: z.string().min(2).max(120),
    role: z.enum(['ADMIN', 'TEACHER', 'STUDENT']),
  }).safeParse(req.body);
  if (!input.success) return badRequest(res, 'Thông tin tài khoản chưa hợp lệ (mật khẩu tối thiểu 8 ký tự).');

  try {
    const result = await query(
      'INSERT INTO users (email, password_hash, full_name, role) VALUES (?, ?, ?, ?)',
      [input.data.email.toLowerCase(), await hashPassword(input.data.password), input.data.fullName, input.data.role],
    );
    res.status(201).json({ id: result.insertId, message: 'Đã tạo tài khoản.' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Email này đã tồn tại.' });
    throw error;
  }
});

app.put('/api/admin/users/:id', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const userId = idSchema.parse(req.params.id);
  const input = z.object({
    email: z.string().email(),
    fullName: z.string().min(2).max(120),
    role: z.enum(['ADMIN', 'TEACHER', 'STUDENT']),
    active: z.boolean(),
    password: z.union([z.literal(''), z.string().min(8).max(128)]).optional().default(''),
  }).safeParse(req.body);
  if (!input.success) return badRequest(res, 'Thông tin tài khoản chưa hợp lệ. Mật khẩu mới phải từ 8 ký tự.');

  const rows = await query('SELECT id, role, active FROM users WHERE id = ? LIMIT 1', [userId]);
  const current = rows[0];
  if (!current) return res.status(404).json({ message: 'Không tìm thấy tài khoản.' });
  if (Number(userId) === Number(req.user.id) && (input.data.role !== 'ADMIN' || !input.data.active)) {
    return badRequest(res, 'Admin đang đăng nhập không thể tự đổi role hoặc tự khóa chính mình.');
  }

  if (current.role !== input.data.role) {
    const refs = await query(`SELECT
      (SELECT COUNT(*) FROM assignments WHERE teacher_id = ?) teacherRefs,
      ((SELECT COUNT(*) FROM submissions WHERE student_id = ?) +
       (SELECT COUNT(*) FROM assignment_attempts WHERE student_id = ?) +
       (SELECT COUNT(*) FROM skill_stats WHERE student_id = ?)) studentRefs`, [userId, userId, userId, userId]);
    if ((current.role === 'TEACHER' && Number(refs[0].teacherRefs) > 0) || (current.role === 'STUDENT' && Number(refs[0].studentRefs) > 0)) {
      return res.status(409).json({ message: 'Tài khoản đã có lịch sử học/bài tập nên không thể đổi role. Hãy khóa tài khoản và tạo tài khoản role mới.' });
    }
  }

  try {
    await withTransaction(async (connection) => {
      const values = [input.data.email.toLowerCase(), input.data.fullName, input.data.role, input.data.active ? 1 : 0];
      let sql = 'UPDATE users SET email = ?, full_name = ?, role = ?, active = ?';
      if (input.data.password) {
        sql += ', password_hash = ?';
        values.push(await hashPassword(input.data.password));
      }
      sql += ' WHERE id = ?'; values.push(userId);
      await connection.execute(sql, values);
      if (current.role !== input.data.role || !input.data.active) {
        await connection.execute('DELETE FROM class_teachers WHERE teacher_id = ?', [userId]);
        await connection.execute('DELETE FROM class_students WHERE student_id = ?', [userId]);
      }
    });
    if (!input.data.active || current.role !== input.data.role || input.data.password) {
      await revokeAllRefreshTokensForUser(userId);
    }
    return res.json({ message: 'Đã cập nhật tài khoản.' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Email này đã tồn tại.' });
    throw error;
  }
});

app.delete('/api/admin/users/:id', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const userId = idSchema.parse(req.params.id);
  if (Number(userId) === Number(req.user.id)) return badRequest(res, 'Không thể xóa tài khoản Admin đang đăng nhập.');
  const rows = await query('SELECT id, active FROM users WHERE id = ? LIMIT 1', [userId]);
  if (!rows[0]) return res.status(404).json({ message: 'Không tìm thấy tài khoản.' });
  await withTransaction(async (connection) => {
    await connection.execute('UPDATE users SET active = 0 WHERE id = ?', [userId]);
    await connection.execute('DELETE FROM class_teachers WHERE teacher_id = ?', [userId]);
    await connection.execute('DELETE FROM class_students WHERE student_id = ?', [userId]);
  });
  await revokeAllRefreshTokensForUser(userId);
  res.json({ message: 'Đã xóa tài khoản khỏi hoạt động. Lịch sử học và bài tập được giữ nguyên.' });
});

app.get('/api/admin/classes', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const pagination = req.query.all === '1' ? null : getPagination(req, 6);
  const limitSql = paginationLimitSql(pagination);
  const classes = await query(`SELECT c.id, c.name, c.code, c.description, c.active, c.created_at createdAt,
    COUNT(DISTINCT cs.student_id) studentCount, COUNT(DISTINCT ct.teacher_id) teacherCount
    FROM classes c
    LEFT JOIN class_students cs ON cs.class_id = c.id
    LEFT JOIN class_teachers ct ON ct.class_id = c.id
    GROUP BY c.id ORDER BY c.active DESC, c.created_at DESC${limitSql}`);
  if (!pagination) return res.json({ classes: classes.map((item) => ({ ...item, active: Boolean(item.active) })), pagination: null });
  const totals = await query('SELECT COUNT(*) total FROM classes');
  res.json({ classes: classes.map((item) => ({ ...item, active: Boolean(item.active) })), pagination: paginationMeta(totals[0]?.total, pagination) });
});

app.post('/api/admin/classes', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const input = z.object({ name: z.string().min(2).max(120), code: z.string().min(2).max(32), description: z.string().max(255).optional() }).safeParse(req.body);
  if (!input.success) return badRequest(res, 'Thông tin lớp chưa hợp lệ.');
  try {
    const result = await query(
      'INSERT INTO classes (name, code, description, created_by) VALUES (?, ?, ?, ?)',
      [input.data.name, input.data.code.toUpperCase(), input.data.description || null, req.user.id],
    );
    res.status(201).json({ id: result.insertId, message: 'Đã tạo lớp.' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Mã lớp đã tồn tại.' });
    throw error;
  }
});

app.put('/api/admin/classes/:id', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const classId = idSchema.parse(req.params.id);
  const input = z.object({
    name: z.string().min(2).max(120), code: z.string().min(2).max(32),
    description: z.string().max(255).optional().default(''), active: z.boolean(),
  }).safeParse(req.body);
  if (!input.success) return badRequest(res, 'Thông tin lớp chưa hợp lệ.');
  try {
    const result = await query('UPDATE classes SET name = ?, code = ?, description = ?, active = ? WHERE id = ?',
      [input.data.name, input.data.code.toUpperCase(), input.data.description || null, input.data.active ? 1 : 0, classId]);
    if (!result.affectedRows) return res.status(404).json({ message: 'Không tìm thấy lớp.' });
    return res.json({ message: input.data.active ? 'Đã cập nhật lớp.' : 'Đã ngừng hoạt động lớp.' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Mã lớp đã tồn tại.' });
    throw error;
  }
});

app.delete('/api/admin/classes/:id', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const classId = idSchema.parse(req.params.id);
  const result = await query('UPDATE classes SET active = 0 WHERE id = ?', [classId]);
  if (!result.affectedRows) return res.status(404).json({ message: 'Không tìm thấy lớp.' });
  res.json({ message: 'Đã xóa lớp khỏi hoạt động. Bài tập, điểm và thành viên cũ vẫn được giữ để tra cứu.' });
});

app.post('/api/admin/classes/:id/teachers', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const classId = idSchema.parse(req.params.id);
  const activeClasses = await query('SELECT id FROM classes WHERE id = ? AND active = 1 LIMIT 1', [classId]);
  if (!activeClasses[0]) return badRequest(res, 'Lớp không tồn tại hoặc đã ngừng hoạt động.');
  const teacherId = idSchema.safeParse(req.body.teacherId);
  if (!teacherId.success) return badRequest(res, 'Thiếu giáo viên.');
  const teachers = await query("SELECT id FROM users WHERE id = ? AND role = 'TEACHER' AND active = 1", [teacherId.data]);
  if (!teachers[0]) return badRequest(res, 'Tài khoản này không phải giáo viên.');
  await query('INSERT IGNORE INTO class_teachers (class_id, teacher_id) VALUES (?, ?)', [classId, teacherId.data]);
  res.json({ message: 'Đã giao giáo viên vào lớp.' });
});

app.delete('/api/admin/classes/:id/teachers/:teacherId', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const classId = idSchema.parse(req.params.id);
  const teacherId = idSchema.parse(req.params.teacherId);
  await query('DELETE FROM class_teachers WHERE class_id = ? AND teacher_id = ?', [classId, teacherId]);
  res.json({ message: 'Đã gỡ giáo viên khỏi lớp.' });
});

app.post('/api/admin/classes/:id/students', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const classId = idSchema.parse(req.params.id);
  const activeClasses = await query('SELECT id FROM classes WHERE id = ? AND active = 1 LIMIT 1', [classId]);
  if (!activeClasses[0]) return badRequest(res, 'Lớp không tồn tại hoặc đã ngừng hoạt động.');
  const studentId = idSchema.safeParse(req.body.studentId);
  if (!studentId.success) return badRequest(res, 'Thiếu học sinh.');
  const students = await query("SELECT id FROM users WHERE id = ? AND role = 'STUDENT' AND active = 1", [studentId.data]);
  if (!students[0]) return badRequest(res, 'Tài khoản này không phải học sinh.');
  await query('INSERT IGNORE INTO class_students (class_id, student_id) VALUES (?, ?)', [classId, studentId.data]);
  res.json({ message: 'Đã thêm học sinh vào lớp.' });
});

app.delete('/api/admin/classes/:id/students/:studentId', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const classId = idSchema.parse(req.params.id);
  const studentId = idSchema.parse(req.params.studentId);
  await query('DELETE FROM class_students WHERE class_id = ? AND student_id = ?', [classId, studentId]);
  res.json({ message: 'Đã gỡ học sinh khỏi lớp.' });
});

app.get('/api/tts', requireAuth, ttsRateLimiter, async (req, res) => {
  const text = String(req.query.text || '').trim();
  const lang = String(req.query.lang || 'ko').trim().toLowerCase().slice(0, 5);
  if (!text) return res.status(400).send('Thiếu nội dung');
  if (text.length > 500) return res.status(400).send('Văn bản quá dài');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ttsTimeoutMs);
  timer.unref?.();
  try {
    const langCode = lang.startsWith('vi') ? 'vi' : 'ko';
    const googleUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${langCode}&client=tw-ob&q=${encodeURIComponent(text)}`;
    const resp = await fetch(googleUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122 Safari/537.36',
        'Referer': 'https://translate.google.com/',
      },
    });
    if (!resp.ok) return res.status(502).send('Nguồn phát âm đang tạm lỗi');
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'private, max-age=86400');
    const buffer = await resp.arrayBuffer();
    return res.send(Buffer.from(buffer));
  } catch (err) {
    if (err?.name === 'AbortError') return res.status(504).send('Nguồn phát âm phản hồi quá lâu');
    console.error(`[${req.requestId}] TTS proxy error:`, sanitizeLogText(err?.message));
    return res.status(502).send('Lỗi máy chủ TTS');
  } finally {
    clearTimeout(timer);
  }
});

const adminSettingsInput = z.object({
  apiKey: z.string().max(500).optional().default(''),
  apiKeysText: z.string().max(10000).optional().default(''),
  clearApiKey: z.boolean().optional().default(false),
  geminiModel: z.string().regex(/^[a-zA-Z0-9._-]{3,80}$/),
  speechRate: z.coerce.number().min(0.5).max(1.5),
  speechPitch: z.coerce.number().min(0.5).max(2),
  voiceMode: z.enum(['online', 'local']),
  voiceName: z.string().max(160).optional().default(''),
  personality: z.enum(['hana', 'minho', 'yuri']),
  theme: z.enum(['light', 'dark']),
  announcementText: z.string().max(2000).optional().default(''),
  announcementEnabled: z.boolean().optional().default(false),
});

app.get('/api/announcement', async (_req, res) => {
  const settings = await getSafeLearningSettings();
  res.json({
    text: settings.announcementEnabled ? settings.announcementText : '',
    enabled: Boolean(settings.announcementEnabled && settings.announcementText?.trim()),
  });
});

app.get('/api/admin/settings', requireAuth, requireRole('ADMIN'), async (_req, res) => {
  res.json({ settings: await getAdminSettings() });
});

app.put('/api/admin/settings', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const input = adminSettingsInput.safeParse(req.body);
  if (!input.success) return badRequest(res, 'Cấu hình hệ thống chưa hợp lệ.');
  const settings = await saveAdminSettings(input.data, req.user.id);
  res.json({ message: 'Đã lưu cấu hình hệ thống & thông báo toàn trang.', settings });
});

app.post('/api/admin/settings/ai/keys', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const input = z.object({ apiKeysText: z.string().trim().min(20).max(10000) }).safeParse(req.body);
  if (!input.success) return badRequest(res, 'Danh sách API key chưa hợp lệ. Mỗi key để một dòng.');
  try {
    const result = await addGeminiApiKeys(input.data.apiKeysText, req.user.id);
    const settings = await getAdminSettings();
    return res.status(201).json({
      message: `Đã thêm ${result.added} API key${result.skipped ? `, bỏ qua ${result.skipped} key trùng` : ''}.`,
      settings,
    });
  } catch (error) {
    if (error.message === 'AI_KEYS_TOO_MANY') return badRequest(res, 'Mỗi lần chỉ thêm tối đa 20 API key.');
    if (error.message === 'AI_KEY_INVALID') return badRequest(res, 'Có API key quá ngắn hoặc không hợp lệ.');
    throw error;
  }
});

app.patch('/api/admin/settings/ai/keys/:id', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const keyId = idSchema.parse(req.params.id);
  const input = z.object({ active: z.boolean() }).safeParse(req.body);
  if (!input.success) return badRequest(res, 'Trạng thái API key chưa hợp lệ.');
  const result = await setGeminiApiKeyActive(keyId, input.data.active);
  if (!result.affectedRows) return res.status(404).json({ message: 'Không tìm thấy API key.' });
  return res.json({ message: input.data.active ? 'Đã bật API key.' : 'Đã tắt API key.', settings: await getAdminSettings() });
});

app.delete('/api/admin/settings/ai/keys/:id', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const keyId = idSchema.parse(req.params.id);
  const result = await deleteGeminiApiKey(keyId);
  if (!result.affectedRows) return res.status(404).json({ message: 'Không tìm thấy API key.' });
  return res.json({ message: 'Đã xóa API key khỏi hệ thống.', settings: await getAdminSettings() });
});

app.post('/api/admin/settings/ai/test', requireAuth, requireRole('ADMIN'), aiRateLimiter, aiConcurrencyGuard, async (req, res) => {
  const input = z.object({
    apiKey: z.string().max(500).optional().default(''),
    keyId: z.coerce.number().int().positive().optional(),
    geminiModel: z.string().regex(/^[a-zA-Z0-9._-]{3,80}$/),
  }).safeParse(req.body);
  if (!input.success) return badRequest(res, 'API key hoặc model chưa hợp lệ.');
  try {
    let apiKey = input.data.apiKey.trim();
    if (!apiKey && input.data.keyId) {
      const managed = await getGeminiApiKeySecretById(input.data.keyId);
      if (!managed) return res.status(404).json({ message: 'Không tìm thấy API key.' });
      apiKey = managed.apiKey;
    }
    await testGeminiConnection({ apiKey: apiKey || undefined, model: input.data.geminiModel });
    if (input.data.keyId) await updateGeminiKeyHealth(input.data.keyId, { success: true });
    return res.json({ message: 'Kết nối Gemini thành công.' });
  } catch (error) {
    const aiError = aiErrorResponse(error);
    if (input.success && input.data.keyId) await updateGeminiKeyHealth(input.data.keyId, { status: aiError.code || 'TEST_ERROR', error: sanitizeLogText(error.message, 240) });
    console.warn(`[${req.requestId}] Gemini test: ${sanitizeLogText(error.message)}`);
    return res.status(aiError.status >= 500 ? 502 : aiError.status).json({ message: aiError.message, code: aiError.code });
  }
});

app.get('/api/admin/monitoring/ai', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const days = Math.max(1, Math.min(30, Number(req.query.days) || 1));
  const [totals, statuses, users, daily] = await Promise.all([
    query(`SELECT COUNT(*) requests, SUM(status = 'SUCCESS') successCount,
      SUM(status = 'RATE_LIMITED') rateLimitedCount, SUM(status = 'UNAVAILABLE') unavailableCount,
      ROUND(AVG(latency_ms)) averageLatencyMs
      FROM ai_usage_events WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)`),
    query(`SELECT status, COUNT(*) count FROM ai_usage_events
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY) GROUP BY status ORDER BY count DESC`),
    query(`SELECT u.id, u.full_name fullName, u.email, COUNT(e.id) requestCount, SUM(e.status = 'SUCCESS') successCount
      FROM ai_usage_events e LEFT JOIN users u ON u.id = e.user_id
      WHERE e.created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
      GROUP BY e.user_id, u.id ORDER BY requestCount DESC LIMIT 20`),
    query(`SELECT DATE(created_at) day, COUNT(*) requests, SUM(status = 'SUCCESS') successCount
      FROM ai_usage_events WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${days} DAY)
      GROUP BY DATE(created_at) ORDER BY day ASC`),
  ]);
  return res.json({ days, totals: totals[0] || {}, statuses, users, daily, keys: (await getAdminSettings()).apiKeys });
});

app.get('/api/admin/monitoring/errors', requireAuth, requireRole('ADMIN'), async (req, res) => {
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 30));
  const errors = await query(`SELECT id, request_id requestId, user_id userId, method, path, status_code statusCode,
    error_code errorCode, message, created_at createdAt FROM system_error_logs ORDER BY created_at DESC LIMIT ${limit}`);
  return res.json({ errors });
});

app.get('/api/textbook/lessons', requireAuth, async (_req, res) => {
  await ensureTextbookCatalog();
  res.json({ lessons: getTextbookLessons() });
});

app.get('/api/textbook/lessons/:id/vocabulary', requireAuth, async (req, res) => {
  const lessonId = idSchema.parse(req.params.id);
  const vocabulary = await getTextbookVocabulary(lessonId);
  if (!vocabulary) return res.status(404).json({ message: 'Không tìm thấy bài này trong sách Sơ cấp 1.' });
  const pagination = req.query.all === '1' ? null : getPagination(req, 8);
  if (!pagination) return res.json({ vocabulary, pagination: null });
  res.json({
    vocabulary: vocabulary.slice(pagination.offset, pagination.offset + pagination.pageSize),
    pagination: paginationMeta(vocabulary.length, pagination),
  });
});

app.post('/api/learning/ai', requireAuth, aiRateLimiter, aiConcurrencyGuard, async (req, res) => {
  if (!(await aiEnabled())) return res.status(503).json({ message: 'Gemini chưa được Admin cấu hình.' });
  const input = z.object({
    prompt: z.string().max(config.aiPromptMaxChars).optional().default(''),
    systemPrompt: z.string().max(12000).optional().default(''),
    history: z.array(z.object({
      role: z.enum(['user', 'model']),
      parts: z.array(z.object({ text: z.string().max(6000) })).min(1).max(4),
    })).max(config.aiHistoryMaxMessages).optional().nullable(),
    temperature: z.coerce.number().min(0).max(1.5).optional(),
    maxOutputTokens: z.coerce.number().int().min(128).max(4096).optional(),
    jsonMode: z.boolean().optional().default(false),
  }).safeParse(req.body);
  if (!input.success || (!input.data.prompt && !input.data.history?.length)) return badRequest(res, 'Yêu cầu AI chưa hợp lệ.');

  const historyChars = (input.data.history || []).reduce((sum, item) => sum + item.parts.reduce((n, part) => n + part.text.length, 0), 0);
  if (historyChars > config.aiHistoryMaxChars) return badRequest(res, 'Lịch sử chat quá dài. Hãy bắt đầu một đoạn chat mới.');

  try {
    const text = await generateTextWithAI({ ...input.data, userId: req.user.id, route: 'learning-ai' });
    return res.json({ text });
  } catch (error) {
    const aiError = aiErrorResponse(error);
    console.warn(`[${req.requestId}] Learning AI: ${sanitizeLogText(error.message)}`);
    return res.status(aiError.status).json({ message: aiError.message, code: aiError.code });
  }
});

app.get('/api/learning/settings', requireAuth, requireRole('TEACHER', 'STUDENT'), async (_req, res) => {
  res.json({ settings: await getSafeLearningSettings() });
});

app.get('/api/learning/state', requireAuth, requireRole('TEACHER', 'STUDENT'), async (req, res) => {
  const rows = await query('SELECT state_json stateJson, updated_at updatedAt FROM learning_states WHERE user_id = ? LIMIT 1', [req.user.id]);
  if (!rows[0]) return res.json({ state: null, updatedAt: null });
  const state = typeof rows[0].stateJson === 'string' ? JSON.parse(rows[0].stateJson) : rows[0].stateJson;
  return res.json({ state, updatedAt: rows[0].updatedAt });
});

app.put('/api/learning/state', requireAuth, requireRole('TEACHER', 'STUDENT'), async (req, res) => {
  const input = z.object({ state: z.record(z.string(), z.unknown()) }).safeParse(req.body);
  if (!input.success) return badRequest(res, 'Trạng thái học chưa hợp lệ.');
  await query(
    `INSERT INTO learning_states (user_id, state_json) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE state_json = VALUES(state_json)`,
    [req.user.id, JSON.stringify(input.data.state)],
  );
  return res.json({ ok: true });
});

app.post('/api/classes/:id/vocabulary/import', requireAuth, requireRole('TEACHER'), async (req, res) => {
  const classId = idSchema.parse(req.params.id);
  if (!(await teacherOwnsClass(req.user.id, classId))) return res.status(403).json({ message: 'Bạn chưa được giao lớp này.' });
  const input = z.object({ vocabularyIds: z.array(z.coerce.number().int().positive()).min(1).max(300) }).safeParse(req.body);
  if (!input.success) return badRequest(res, 'Hãy chọn ít nhất một từ vựng.');
  const vocabularyIds = [...new Set(input.data.vocabularyIds.map(Number))];
  const placeholders = vocabularyIds.map(() => '?').join(', ');
  const classRows = await query('SELECT id, name, code FROM classes WHERE id = ? AND active = 1 LIMIT 1', [classId]);
  if (!classRows[0]) return res.status(404).json({ message: 'Lớp không còn tồn tại hoặc đã bị khóa.' });

  // Không báo thành công nếu client gửi ID cũ/không tồn tại. Điều này giúp tránh
  // trạng thái giáo viên thấy "đã giao" nhưng học sinh thực tế nhận 0 từ.
  const validRows = await query(`SELECT COUNT(*) total FROM vocabulary WHERE id IN (${placeholders})`, vocabularyIds);
  if (Number(validRows[0]?.total || 0) !== vocabularyIds.length) {
    return badRequest(res, 'Danh sách từ vựng đã thay đổi. Hãy tải lại bài rồi chọn lại từ.');
  }

  const result = await withTransaction(async (connection) => {
    const [insertResult] = await connection.execute(
      `INSERT IGNORE INTO class_vocabulary (class_id, vocabulary_id, added_by)
       SELECT ?, v.id, ? FROM vocabulary v WHERE v.id IN (${placeholders})`,
      [classId, req.user.id, ...vocabularyIds],
    );
    const insertedCount = Number(insertResult.affectedRows || 0);
    if (insertedCount > 0) {
      await connection.execute(
        `INSERT INTO notifications (user_id, type, title, message, reference_type, reference_id)
         SELECT student_id, 'NEW_VOCABULARY', 'Từ vựng mới', ?, 'CLASS', ?
         FROM class_students WHERE class_id = ?`,
        [`Giáo viên vừa thêm ${insertedCount} từ vào lớp ${classRows[0].name}.`, classId, classId],
      );
    }
    const [totalRows] = await connection.execute('SELECT COUNT(*) total FROM class_vocabulary WHERE class_id = ?', [classId]);
    return { insertedCount, total: Number(totalRows[0]?.total || 0) };
  });

  const alreadyCount = vocabularyIds.length - result.insertedCount;
  const detail = alreadyCount > 0 ? ` ${alreadyCount} từ đã có sẵn.` : '';
  const message = result.insertedCount > 0
    ? `Đã thêm ${result.insertedCount} từ vào lớp ${classRows[0].name}.${detail}`
    : `Không có từ mới để thêm vào lớp ${classRows[0].name}. ${vocabularyIds.length} từ đã có sẵn.`;
  res.json({
    message,
    classId,
    className: classRows[0].name,
    selectedCount: vocabularyIds.length,
    insertedCount: result.insertedCount,
    alreadyCount,
    totalClassVocabulary: result.total,
  });
});

app.get('/api/classes/:id/vocabulary', requireAuth, async (req, res) => {
  const classId = idSchema.parse(req.params.id);
  if (!(await canReadClass(req.user, classId))) return res.status(403).json({ message: 'Không có quyền xem từ vựng lớp này.' });
  if (req.query.idsOnly === '1') {
    const ids = await query('SELECT vocabulary_id id FROM class_vocabulary WHERE class_id = ? ORDER BY vocabulary_id', [classId]);
    return res.json({ ids: ids.map((item) => Number(item.id)) });
  }
  const keyword = String(req.query.q || '').trim().slice(0, 120);
  const whereSql = keyword ? 'WHERE cv.class_id = ? AND (v.korean LIKE ? OR v.meaning_vi LIKE ? OR COALESCE(v.romanization, \'\') LIKE ?)' : 'WHERE cv.class_id = ?';
  const baseParams = keyword ? [classId, `%${keyword}%`, `%${keyword}%`, `%${keyword}%`] : [classId];
  const pagination = getPagination(req, 8);
  const limitSql = paginationLimitSql(pagination);
  const params = baseParams;
  const vocabulary = await query(`SELECT v.id, v.lesson_id lessonId, l.title lessonTitle, l.topic, l.grammar,
    v.korean, v.romanization, v.meaning_vi meaningVi, v.part_of_speech partOfSpeech, v.example_kr exampleKr, v.example_vi exampleVi
    FROM class_vocabulary cv JOIN vocabulary v ON v.id = cv.vocabulary_id JOIN textbook_lessons l ON l.id = v.lesson_id
    ${whereSql} ORDER BY v.lesson_id, v.id${limitSql}`, params);
  const result = vocabulary.map((word) => ({ ...word, grammar: typeof word.grammar === 'string' ? JSON.parse(word.grammar) : word.grammar }));
  if (!pagination) return res.json({ vocabulary: result, pagination: null });
  const totals = await query(`SELECT COUNT(*) total FROM class_vocabulary cv JOIN vocabulary v ON v.id = cv.vocabulary_id ${whereSql}`, baseParams);
  res.json({ vocabulary: result, pagination: paginationMeta(totals[0]?.total, pagination) });
});

const questionInput = z.object({
  type: z.enum(['MULTIPLE_CHOICE', 'SHORT_TEXT', 'ESSAY']),
  prompt: z.string().min(2),
  options: z.array(z.string().min(1)).max(8).optional().default([]),
  correctAnswer: z.string().optional().default(''),
  explanation: z.string().optional().default(''),
  topic: z.string().min(1).max(160).optional().default('Tổng hợp'),
  points: z.coerce.number().positive().max(100).optional().default(1),
});

app.post('/api/assignments', requireAuth, requireRole('TEACHER'), async (req, res) => {
  const input = z.object({
    classId: z.coerce.number().int().positive(),
    type: z.enum(['HOMEWORK', 'TEST']),
    title: z.string().min(3).max(190),
    instructions: z.string().max(3000).optional().default(''),
    dueAt: z.string().optional().nullable(),
    timeLimitMinutes: z.coerce.number().int().positive().max(360).optional().nullable(),
    questions: z.array(questionInput).min(1).max(100),
  }).safeParse(req.body);
  if (!input.success) return badRequest(res, 'Bài tập/kiểm tra chưa hợp lệ. Kiểm tra lại câu hỏi và số điểm.');
  if (!(await teacherOwnsClass(req.user.id, input.data.classId))) return res.status(403).json({ message: 'Bạn chưa được giao lớp này.' });
  if (input.data.questions.some((q) => q.type === 'MULTIPLE_CHOICE' && q.options.length < 2)) {
    return badRequest(res, 'Câu trắc nghiệm phải có ít nhất 2 lựa chọn.');
  }

  const assignmentId = await withTransaction(async (connection) => {
    const [assignment] = await connection.execute(
      `INSERT INTO assignments (class_id, teacher_id, type, title, instructions, due_at, time_limit_minutes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [input.data.classId, req.user.id, input.data.type, input.data.title, input.data.instructions || null, input.data.dueAt || null, input.data.timeLimitMinutes || null],
    );
    for (let index = 0; index < input.data.questions.length; index += 1) {
      const question = input.data.questions[index];
      await connection.execute(
        `INSERT INTO questions (assignment_id, type, prompt, options, correct_answer, explanation, topic, points, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [assignment.insertId, question.type, question.prompt, question.options.length ? JSON.stringify(question.options) : null,
          question.correctAnswer || null, question.explanation || null, question.topic, question.points, index + 1],
      );
    }
    return assignment.insertId;
  });
  res.status(201).json({ id: assignmentId, message: 'Đã lưu bản nháp. Bạn có thể kiểm tra rồi giao cho lớp.' });
});

app.post('/api/assignments/:id/publish', requireAuth, requireRole('TEACHER'), async (req, res) => {
  const assignmentId = idSchema.parse(req.params.id);
  const rows = await query('SELECT id, class_id, title, type, status FROM assignments WHERE id = ? AND teacher_id = ? LIMIT 1', [assignmentId, req.user.id]);
  const assignment = rows[0];
  if (!assignment) return res.status(404).json({ message: 'Không tìm thấy bài của bạn.' });
  if (assignment.status !== 'DRAFT') return res.status(409).json({ message: 'Bài này đã được giao hoặc đã đóng.' });

  await withTransaction(async (connection) => {
    await connection.execute("UPDATE assignments SET status = 'PUBLISHED', published_at = NOW() WHERE id = ?", [assignmentId]);
    await connection.execute(
      `INSERT INTO notifications (user_id, type, title, message, reference_type, reference_id)
       SELECT cs.student_id, 'NEW_ASSIGNMENT', ?, ?, 'ASSIGNMENT', ?
       FROM class_students cs WHERE cs.class_id = ?`,
      [assignment.type === 'TEST' ? 'Bài kiểm tra mới' : 'Bài tập mới', assignment.title, assignmentId, assignment.class_id],
    );
  });
  res.json({ message: 'Đã giao bài. Tất cả học sinh trong lớp đã nhận thông báo.' });
});

app.get('/api/assignments', requireAuth, async (req, res) => {
  const pagination = getPagination(req, 8);
  let filterClassId = null;
  if (req.query.classId !== undefined) {
    const parsedClassId = idSchema.safeParse(req.query.classId);
    if (!parsedClassId.success) return badRequest(res, 'Lớp cần lọc không hợp lệ.');
    filterClassId = parsedClassId.data;
    if (!(await canReadClass(req.user, filterClassId))) return res.status(403).json({ message: 'Bạn không có quyền xem bài của lớp này.' });
  }
  const studentView = ['PENDING', 'DONE', 'ALL'].includes(req.query.view) ? req.query.view : 'ALL';
  let sql;
  let params;
  let countSql;
  let countParams;
  if (req.user.role === 'ADMIN') {
    sql = `SELECT a.*, c.name className, u.full_name teacherName FROM assignments a
      JOIN classes c ON c.id = a.class_id JOIN users u ON u.id = a.teacher_id
      ${filterClassId ? 'WHERE a.class_id = ?' : ''} ORDER BY a.created_at DESC`;
    params = filterClassId ? [filterClassId] : [];
    countSql = `SELECT COUNT(*) total FROM assignments a ${filterClassId ? 'WHERE a.class_id = ?' : ''}`;
    countParams = [...params];
  } else if (req.user.role === 'TEACHER') {
    sql = `SELECT a.*, c.name className, COUNT(s.id) submittedCount,
      (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id = a.class_id) studentCount
      FROM assignments a JOIN classes c ON c.id = a.class_id LEFT JOIN submissions s ON s.assignment_id = a.id
      WHERE a.teacher_id = ? ${filterClassId ? 'AND a.class_id = ?' : ''} GROUP BY a.id ORDER BY a.created_at DESC`;
    params = filterClassId ? [req.user.id, filterClassId] : [req.user.id];
    countSql = `SELECT COUNT(*) total FROM assignments a WHERE a.teacher_id = ? ${filterClassId ? 'AND a.class_id = ?' : ''}`;
    countParams = [...params];
  } else {
    const viewCondition = studentView === 'PENDING' ? 'AND s.id IS NULL' : studentView === 'DONE' ? 'AND s.id IS NOT NULL' : '';
    sql = `SELECT a.*, c.name className, s.id submissionId, s.percentage, s.score, s.max_score maxScore, s.submitted_at submittedAt
      FROM assignments a JOIN classes c ON c.id = a.class_id JOIN class_students cs ON cs.class_id = a.class_id
      LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = ?
      WHERE cs.student_id = ? AND a.status IN ('PUBLISHED','CLOSED') ${filterClassId ? 'AND a.class_id = ?' : ''} ${viewCondition}
      ORDER BY COALESCE(a.due_at, '2999-12-31'), a.created_at DESC`;
    params = filterClassId ? [req.user.id, req.user.id, filterClassId] : [req.user.id, req.user.id];
    countSql = `SELECT COUNT(*) total FROM assignments a JOIN class_students cs ON cs.class_id = a.class_id
      LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = ?
      WHERE cs.student_id = ? AND a.status IN ('PUBLISHED','CLOSED') ${filterClassId ? 'AND a.class_id = ?' : ''} ${viewCondition}`;
    countParams = [...params];
  }
  if (!pagination) return res.json({ assignments: await query(sql, params), pagination: null });
  const totals = await query(countSql, countParams);
  const assignments = await query(`${sql}${paginationLimitSql(pagination)}`, params);
  res.json({ assignments, pagination: paginationMeta(totals[0]?.total, pagination) });
});

app.get('/api/assignments/:id', requireAuth, async (req, res) => {
  const assignmentId = idSchema.parse(req.params.id);
  const rows = await query(`SELECT a.*, c.name className, u.full_name teacherName FROM assignments a
    JOIN classes c ON c.id = a.class_id JOIN users u ON u.id = a.teacher_id WHERE a.id = ? LIMIT 1`, [assignmentId]);
  const assignment = rows[0];
  if (!assignment) return res.status(404).json({ message: 'Không tìm thấy bài.' });
  if (!(await canReadClass(req.user, assignment.class_id))) return res.status(403).json({ message: 'Bạn không thuộc lớp của bài này.' });
  if (req.user.role === 'STUDENT' && assignment.status === 'DRAFT') return res.status(404).json({ message: 'Bài chưa được giao.' });

  const questions = await query(`SELECT id, type, prompt, options, correct_answer correctAnswer, explanation, topic, points, position
    FROM questions WHERE assignment_id = ? ORDER BY position`, [assignmentId]);
  let submission = null;
  let latestAttempt = null;
  if (req.user.role === 'STUDENT') {
    const submissions = await query('SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ? LIMIT 1', [assignmentId, req.user.id]);
    submission = submissions[0] || null;
    if (!submission) {
      if (assignment.type === 'HOMEWORK') {
        const attempts = await query(`SELECT id attemptId, attempt_no attemptNo, answers_json answersJson, result_json resultJson,
          score, max_score maxScore, percentage, ai_summary summary, ai_used aiUsed, created_at createdAt
          FROM assignment_attempts WHERE assignment_id = ? AND student_id = ? ORDER BY attempt_no DESC LIMIT 1`, [assignmentId, req.user.id]);
        if (attempts[0]) {
          latestAttempt = {
            ...attempts[0],
            answers: typeof attempts[0].answersJson === 'string' ? JSON.parse(attempts[0].answersJson) : attempts[0].answersJson,
            results: typeof attempts[0].resultJson === 'string' ? JSON.parse(attempts[0].resultJson) : attempts[0].resultJson,
            aiUsed: Boolean(attempts[0].aiUsed),
          };
          delete latestAttempt.answersJson;
          delete latestAttempt.resultJson;
        }
      }
      for (const question of questions) {
        delete question.correctAnswer;
        delete question.explanation;
      }
    } else {
      const answers = await query(`SELECT sa.question_id questionId, sa.answer_text answerText, sa.is_correct isCorrect,
        sa.points_awarded pointsAwarded, sa.feedback, sa.graded_by_ai gradedByAi
        FROM submission_answers sa WHERE sa.submission_id = ?`, [submission.id]);
      submission.answers = answers.map((answer) => ({ ...answer, isCorrect: Boolean(answer.isCorrect), gradedByAi: Boolean(answer.gradedByAi) }));
    }
  }
  res.json({
    assignment,
    questions: questions.map((question) => ({ ...question, options: typeof question.options === 'string' ? JSON.parse(question.options) : question.options || [] })),
    submission,
    latestAttempt,
    aiEnabled: await aiEnabled(),
  });
});

const answerInput = z.record(z.string(), z.union([z.string(), z.number(), z.null()]));


function normalizeStrictAnswer(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/[“”"'`´’‘.,!?;:()[\]{}<>~…·ㆍ\-_/\\|+=*#@%^&]/g, '')
    .replace(/\s+/g, '');
}

function levenshteinDistance(a, b) {
  const left = [...String(a || '')];
  const right = [...String(b || '')];
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  const prev = Array.from({ length: right.length + 1 }, (_, i) => i);
  const curr = new Array(right.length + 1);

  for (let i = 1; i <= left.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        curr[j - 1] + 1,
        prev[j] + 1,
        prev[j - 1] + cost,
      );
    }
    for (let j = 0; j <= right.length; j += 1) prev[j] = curr[j];
  }
  return prev[right.length];
}

function splitAcceptedAnswers(referenceAnswer) {
  const raw = String(referenceAnswer || '').trim();
  if (!raw) return [];
  return raw
    .split(/\s*\|\|\s*|\r?\n+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function gradeShortTextStrict(question, answer) {
  const maxPoints = Number(question.points || 0);
  const rawAnswer = String(answer || '').trim();
  const accepted = splitAcceptedAnswers(question.correct_answer);

  if (!rawAnswer) {
    return {
      awarded: 0,
      isCorrect: false,
      gradedByAi: false,
      feedback: 'Bạn chưa nhập câu trả lời.',
    };
  }

  if (!accepted.length) return gradeObjective(question, rawAnswer);

  const normalizedAnswer = normalizeStrictAnswer(rawAnswer);
  const normalizedRefs = accepted.map(normalizeStrictAnswer).filter(Boolean);

  if (normalizedRefs.includes(normalizedAnswer)) {
    return {
      awarded: maxPoints,
      isCorrect: true,
      gradedByAi: false,
      feedback: 'Chính xác.',
    };
  }

  const referenceHasHangul = normalizedRefs.some((item) => /[가-힣]/.test(item));
  if (referenceHasHangul && !/[가-힣]/.test(normalizedAnswer)) {
    return {
      awarded: 0,
      isCorrect: false,
      gradedByAi: false,
      feedback: `Câu này cần trả lời bằng tiếng Hàn. Đáp án tham khảo: ${accepted[0]}.`,
    };
  }

  let bestRef = normalizedRefs[0] || '';
  let bestSimilarity = 0;
  for (const ref of normalizedRefs) {
    const distance = levenshteinDistance(normalizedAnswer, ref);
    const similarity = Math.max(0, 1 - distance / Math.max(normalizedAnswer.length, ref.length, 1));
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      bestRef = ref;
    }
  }

  // Nếu câu đúng bị chèn thêm chữ rác ở đầu/cuối (VD: 하아다안녕하세요)
  // thì tuyệt đối không được 100 điểm dù vẫn "chứa" đáp án đúng.
  const containsCorrectWithExtra =
    bestRef &&
    normalizedAnswer !== bestRef &&
    normalizedAnswer.includes(bestRef);

  let ratio = 0;
  let feedback = `Chưa chính xác. Đáp án tham khảo: ${accepted[0]}.`;

  if (containsCorrectWithExtra) {
    ratio = 0.4;
    feedback = `Có phần đáp án đúng nhưng bị thừa ký tự/từ. Chấm nghiêm: chưa đạt. Câu chuẩn: ${accepted[0]}.`;
  } else if (bestSimilarity >= 0.95) {
    ratio = 0.8;
    feedback = `Sai rất nhẹ nhưng vẫn chưa chính xác hoàn toàn. Câu chuẩn: ${accepted[0]}.`;
  } else if (bestSimilarity >= 0.88) {
    ratio = 0.65;
    feedback = `Có lỗi chính tả/ký tự. Chấm nghiêm nên không được tính đúng hoàn toàn. Câu chuẩn: ${accepted[0]}.`;
  } else if (bestSimilarity >= 0.78) {
    ratio = 0.4;
    feedback = `Sai khá rõ. Hãy viết lại đúng từ/cấu trúc. Câu chuẩn: ${accepted[0]}.`;
  } else {
    ratio = 0;
    feedback = `Chưa đúng. Câu chuẩn: ${accepted[0]}.`;
  }

  const awarded = Number((maxPoints * ratio).toFixed(2));
  return {
    awarded,
    isCorrect: false,
    gradedByAi: false,
    feedback,
  };
}


function shouldStrictCheckEssay(question) {
  const reference = String(question.correct_answer || '').trim();
  if (!reference) return false;

  // Bài dịch/từ vựng/câu ngắn có đáp án mẫu thì 100% chỉ khi thật sự đúng.
  // Không áp dụng cho bài tự luận dài không có đáp án chuẩn rõ ràng.
  const normalizedReference = normalizeStrictAnswer(reference);
  return normalizedReference.length > 0 && normalizedReference.length <= 120;
}

function capEssayScoreAgainstReference(question, answer, result) {
  if (!shouldStrictCheckEssay(question)) return result;

  const strict = gradeShortTextStrict(question, answer);
  const maxPoints = Number(question.points || 0);

  // Khớp đáp án chuẩn => được phép 100%.
  if (strict.isCorrect) {
    return {
      ...result,
      awarded: maxPoints,
      isCorrect: true,
      feedback: result.feedback || 'Chính xác.',
    };
  }

  // Có lỗi chính tả/ký tự/trợ từ/... thì tuyệt đối không cho full điểm,
  // dù AI có chấm dễ tay.
  const strictAwarded = Number(strict.awarded || 0);
  const aiAwarded = Math.max(0, Math.min(maxPoints, Number(result?.awarded || 0)));

  // Với câu ngắn có đáp án chuẩn: lấy mức nghiêm hơn giữa rule và AI.
  // Nhờ đó kiểu 안녕하세오 ≠ 안녕하세요 sẽ không còn 1/1.
  const awarded = Math.min(aiAwarded, strictAwarded);

  return {
    ...result,
    awarded,
    isCorrect: false,
    feedback: strict.feedback || result.feedback || 'Chưa chính xác.',
  };
}

function chunkEssayJobs(items, maxItems, maxInputChars = 9000) {
  const output = [];
  let current = [];
  let currentChars = 0;

  for (const item of items) {
    const estimatedChars = String(item?.question?.prompt || '').length
      + String(item?.question?.correct_answer || '').length
      + String(item?.answer || '').length
      + 180;
    const wouldOverflow = current.length && (current.length >= maxItems || currentChars + estimatedChars > maxInputChars);
    if (wouldOverflow) {
      output.push(current);
      current = [];
      currentChars = 0;
    }
    current.push(item);
    currentChars += estimatedChars;
  }
  if (current.length) output.push(current);
  return output;
}

function buildLocalAssignmentSummary(results, weakTopics) {
  if (!results.length) return 'Chưa có câu trả lời để nhận xét.';
  const wrong = results.filter((item) => !item.isCorrect);
  if (!wrong.length) return 'Bài làm rất tốt. Các câu đều đạt yêu cầu; hãy tiếp tục duy trì cách học hiện tại.';

  const topicText = weakTopics.length ? `Cần ôn thêm: ${weakTopics.join(', ')}.` : 'Một vài câu vẫn cần xem lại.';
  const usefulFeedback = wrong
    .map((item) => String(item.feedback || '').trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(' ');
  return `${topicText}${usefulFeedback ? ` ${usefulFeedback}` : ''}`.slice(0, 900);
}

function parseAttemptJson(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function attemptGradeResponse(attempt, questions, { reused = false } = {}) {
  const results = parseAttemptJson(attempt.result_json, []);
  const weakTopics = [...new Set(results
    .filter((item) => Number(item.points) > 0 && Number(item.awarded) / Number(item.points) < 0.7)
    .map((item) => item.topic)
    .filter(Boolean))];
  return {
    attemptId: Number(attempt.id),
    attemptNo: Number(attempt.attempt_no),
    results,
    score: Number(attempt.score),
    maxScore: Number(attempt.max_score),
    percentage: Number(attempt.percentage),
    summary: attempt.ai_summary || buildLocalAssignmentSummary(results, weakTopics),
    weakTopics,
    aiUsed: Boolean(attempt.ai_used),
    reused,
    aiStats: { essayQuestions: 0, batches: 0, providerCalls: 0, reusedQuestions: questions.length },
  };
}

async function gradeAssignmentAnswers(questions, answers, metadata = {}, previousAttempt = null) {
  const useAi = await aiEnabled();
  const resultByQuestionId = new Map();
  const aiJobs = [];
  const aiStats = { essayQuestions: 0, batches: 0, providerCalls: 0, reusedQuestions: 0 };
  const previousAnswers = parseAttemptJson(previousAttempt?.answers_json, {});
  const previousResults = parseAttemptJson(previousAttempt?.result_json, []);

  // Các dạng có đáp án xác định được chấm local, không tiêu tốn Gemini request.
  for (const question of questions) {
    const answer = String(answers[String(question.id)] ?? '');
    const reused = reusableAttemptResult(question, answer, previousAnswers, previousResults);
    if (reused) {
      resultByQuestionId.set(Number(question.id), {
        ...reused,
        questionId: Number(question.id),
        topic: question.topic,
        points: Number(question.points),
        answer,
        referenceAnswer: question.correct_answer || '',
      });
      aiStats.reusedQuestions += 1;
      continue;
    }
    let result;

    if (question.type === 'ESSAY') {
      // Luôn có fallback trước. Nếu AI batch lỗi, học sinh vẫn nhận được kết quả thay vì treo cả bài.
      result = gradeEssayFallback(question, answer);
      if (useAi && answer.trim()) {
        aiJobs.push({ question, answer });
      }
    } else if (shouldGradeWithAI(question)) {
      result = answer.trim()
        ? { awarded: 0, isCorrect: false, feedback: useAi ? 'AI đang đánh giá câu trả lời.' : 'Chưa có đáp án mẫu và AI hiện chưa được bật.', gradedByAi: false }
        : { awarded: 0, isCorrect: false, feedback: 'Bạn chưa trả lời câu này.', gradedByAi: false };
      if (useAi && answer.trim()) aiJobs.push({ question, answer });
    } else if (question.type === 'SHORT_TEXT') {
      result = gradeShortTextStrict(question, answer);
    } else {
      result = gradeObjective(question, answer);
    }

    resultByQuestionId.set(Number(question.id), {
      questionId: Number(question.id), topic: question.topic, points: Number(question.points), answer,
      referenceAnswer: question.correct_answer || '', awarded: Number(result.awarded), isCorrect: Boolean(result.isCorrect),
      feedback: result.feedback || '', gradedByAi: Boolean(result.gradedByAi),
    });
  }

  aiStats.essayQuestions = aiJobs.length;

  // PHƯƠNG ÁN 2: tối đa 5 câu tự luận = 1 Gemini request.
  // Ví dụ 12 câu tự luận => 3 request (5 + 5 + 2), thay vì 12-24 request như trước.
  for (const batch of chunkEssayJobs(aiJobs, config.aiGradingBatchSize)) {
    try {
      aiStats.batches += 1;
      const batchResult = await gradeEssayBatchWithAI({
        items: batch.map(({ question, answer }) => ({
          questionId: Number(question.id),
          prompt: questionPromptForAi(question),
          referenceAnswer: question.correct_answer,
          answer,
          maxPoints: Number(question.points),
        })),
        ...metadata,
        route: `${metadata.route || 'assignment-check'}-batch`,
      });
      aiStats.providerCalls += Math.max(0, Number(batchResult?.providerAttempts) || 0);
      const aiRows = Array.isArray(batchResult?.results) ? batchResult.results : [];

      const aiById = new Map(aiRows.filter(Boolean).map((row) => [Number(row.questionId), row]));
      for (const { question, answer } of batch) {
        const current = resultByQuestionId.get(Number(question.id));
        const aiResult = aiById.get(Number(question.id));
        if (!aiResult) {
          current.feedback = `${current.feedback || ''} AI chưa trả đủ dữ liệu cho câu này nên hệ thống dùng chấm dự phòng.`.trim();
          continue;
        }

        // Với câu ngắn có đáp án mẫu, rule local là lớp bảo vệ cuối để AI không cho 100% khi sai ký tự/trợ từ.
        const checked = capEssayScoreAgainstReference(question, answer, aiResult);
        resultByQuestionId.set(Number(question.id), {
          ...current,
          awarded: Number(checked.awarded),
          isCorrect: Boolean(checked.isCorrect),
          feedback: checked.feedback || current.feedback || '',
          gradedByAi: true,
        });
      }
    } catch {
      for (const { question } of batch) {
        const current = resultByQuestionId.get(Number(question.id));
        current.feedback = `${current.feedback || ''} AI tạm thời không phản hồi nên hệ thống dùng chấm dự phòng.`.trim();
      }
    }
  }

  const results = questions.map((question) => resultByQuestionId.get(Number(question.id)));
  const maxScore = results.reduce((sum, item) => sum + item.points, 0);
  const score = results.reduce((sum, item) => sum + item.awarded, 0);
  const percentage = maxScore ? Number(((score / maxScore) * 100).toFixed(2)) : 0;
  const topicRows = new Map();
  for (const item of results) {
    const current = topicRows.get(item.topic) || { points: 0, max: 0 };
    current.points += item.awarded; current.max += item.points; topicRows.set(item.topic, current);
  }
  const weakTopics = [...topicRows.entries()].filter(([, data]) => data.max && data.points / data.max < 0.7).map(([topic]) => topic);

  // Không gọi Gemini thêm một lượt chỉ để viết summary: tiết kiệm request cho lớp đông.
  const summary = buildLocalAssignmentSummary(results, weakTopics);
  return { results, score, maxScore, percentage, weakTopics, summary, aiUsed: results.some((item) => item.gradedByAi), aiStats };
}

async function createFinalSubmission({ assignment, studentId, grade, attemptId = null }) {
  return withTransaction(async (connection) => {
    const [submission] = await connection.execute(
      `INSERT INTO submissions (assignment_id, student_id, status, score, max_score, percentage, ai_summary, graded_at)
       VALUES (?, ?, 'GRADED', ?, ?, ?, ?, NOW())`,
      [assignment.id, studentId, grade.score, grade.maxScore, grade.percentage, grade.summary],
    );
    for (const item of grade.results) {
      await connection.execute(
        `INSERT INTO submission_answers (submission_id, question_id, answer_text, is_correct, points_awarded, feedback, graded_by_ai)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [submission.insertId, item.questionId, item.answer, item.isCorrect ? 1 : 0, item.awarded, item.feedback, item.gradedByAi ? 1 : 0],
      );
      const ratio = item.points ? item.awarded / item.points : 0;
      await connection.execute(
        `INSERT INTO skill_stats (student_id, topic, attempted, correct_count, last_score) VALUES (?, ?, 1, ?, ?)
         ON DUPLICATE KEY UPDATE attempted = attempted + 1, correct_count = correct_count + VALUES(correct_count), last_score = VALUES(last_score)`,
        [studentId, item.topic, ratio, ratio * 100],
      );
    }
    if (attemptId) {
      await connection.execute('UPDATE assignment_attempts SET submission_id = ?, submitted_at = NOW() WHERE id = ?', [submission.insertId, attemptId]);
    }
    await connection.execute(
      `INSERT INTO notifications (user_id, type, title, message, reference_type, reference_id)
       VALUES (?, 'SUBMISSION_RECEIVED', 'Học sinh đã nộp bài', ?, 'ASSIGNMENT', ?)`,
      [assignment.teacher_id, `Có học sinh vừa nộp: ${assignment.title}`, assignment.id],
    );
    return submission.insertId;
  });
}

app.post(['/api/assignments/:id/check', '/api/assignments/:id/attempt'], requireAuth, requireRole('STUDENT'), aiRateLimiter, aiConcurrencyGuard, async (req, res) => {
  const assignmentId = idSchema.parse(req.params.id);
  const input = z.object({ answers: answerInput }).safeParse(req.body);
  if (!input.success) return badRequest(res, 'Dữ liệu bài làm chưa hợp lệ.');
  const assignments = await query("SELECT * FROM assignments WHERE id = ? AND type = 'HOMEWORK' AND status = 'PUBLISHED' LIMIT 1", [assignmentId]);
  const assignment = assignments[0];
  if (!assignment || !(await studentBelongsToClass(req.user.id, assignment.class_id))) return res.status(403).json({ message: 'Bạn không thể check bài này.' });
  const existed = await query('SELECT id FROM submissions WHERE assignment_id = ? AND student_id = ? LIMIT 1', [assignmentId, req.user.id]);
  if (existed[0]) return res.status(409).json({ message: 'Bài đã nộp chính thức nên không thể check thêm.' });

  const questions = await query('SELECT * FROM questions WHERE assignment_id = ? ORDER BY position', [assignmentId]);
  const previousRows = await query(`SELECT * FROM assignment_attempts
    WHERE assignment_id = ? AND student_id = ? AND submission_id IS NULL
    ORDER BY attempt_no DESC LIMIT 1`, [assignmentId, req.user.id]);
  const previousAttempt = previousRows[0] || null;
  const previousAnswers = parseAttemptJson(previousAttempt?.answers_json, {});

  if (previousAttempt && attemptAnswersMatch(questions, input.data.answers, previousAnswers)) {
    const reusedGrade = attemptGradeResponse(previousAttempt, questions, { reused: true });
    return res.json({
      message: `Đáp án chưa thay đổi nên giữ nguyên kết quả lần ${reusedGrade.attemptNo}. AI không chấm lại.`,
      ...reusedGrade,
    });
  }

  const grade = await gradeAssignmentAnswers(
    questions,
    input.data.answers,
    { userId: req.user.id, route: 'assignment-check' },
    previousAttempt,
  );
  const numberRows = await query('SELECT COALESCE(MAX(attempt_no), 0) + 1 nextAttempt FROM assignment_attempts WHERE assignment_id = ? AND student_id = ?', [assignmentId, req.user.id]);
  const attemptNo = Number(numberRows[0]?.nextAttempt || 1);
  const inserted = await query(
    `INSERT INTO assignment_attempts (assignment_id, student_id, attempt_no, answers_json, result_json, score, max_score, percentage, ai_summary, ai_used)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [assignmentId, req.user.id, attemptNo, JSON.stringify(input.data.answers), JSON.stringify(grade.results), grade.score, grade.maxScore, grade.percentage, grade.summary, grade.aiUsed ? 1 : 0],
  );
  res.status(201).json({
    message: `AI đã check lần ${attemptNo}. Đây chưa phải bài nộp chính thức.`,
    attemptId: inserted.insertId, attemptNo, reused: false, ...grade,
  });
});

app.post('/api/assignments/:id/submit', requireAuth, requireRole('STUDENT'), aiRateLimiter, aiConcurrencyGuard, async (req, res) => {
  const assignmentId = idSchema.parse(req.params.id);
  const assignments = await query("SELECT * FROM assignments WHERE id = ? AND status = 'PUBLISHED' LIMIT 1", [assignmentId]);
  const assignment = assignments[0];
  if (!assignment || !(await studentBelongsToClass(req.user.id, assignment.class_id))) return res.status(403).json({ message: 'Bạn không thể nộp bài này.' });
  const existed = await query('SELECT id FROM submissions WHERE assignment_id = ? AND student_id = ? LIMIT 1', [assignmentId, req.user.id]);
  if (existed[0]) return res.status(409).json({ message: 'Bài này đã được nộp. Mỗi học sinh chỉ nộp một lần.' });

  let grade;
  let attemptId = null;
  if (assignment.type === 'HOMEWORK') {
    const input = z.object({ attemptId: z.coerce.number().int().positive() }).safeParse(req.body);
    if (!input.success) return badRequest(res, 'Hãy bấm Check bằng AI trước khi nộp cho giáo viên.');
    const attempts = await query(`SELECT * FROM assignment_attempts WHERE id = ? AND assignment_id = ? AND student_id = ? AND submission_id IS NULL LIMIT 1`, [input.data.attemptId, assignmentId, req.user.id]);
    const attempt = attempts[0];
    if (!attempt) return badRequest(res, 'Lần check AI này không còn hợp lệ. Hãy check lại.');
    grade = {
      results: typeof attempt.result_json === 'string' ? JSON.parse(attempt.result_json) : attempt.result_json,
      score: Number(attempt.score), maxScore: Number(attempt.max_score), percentage: Number(attempt.percentage),
      summary: attempt.ai_summary, aiUsed: Boolean(attempt.ai_used),
    };
    grade.weakTopics = [...new Set(grade.results.filter((item) => item.points && item.awarded / item.points < 0.7).map((item) => item.topic))];
    attemptId = attempt.id;
  } else {
    const input = z.object({ answers: answerInput }).safeParse(req.body);
    if (!input.success) return badRequest(res, 'Dữ liệu bài kiểm tra chưa hợp lệ.');
    const questions = await query('SELECT * FROM questions WHERE assignment_id = ? ORDER BY position', [assignmentId]);
    grade = await gradeAssignmentAnswers(questions, input.data.answers, { userId: req.user.id, route: 'assignment-submit' });
  }

  const submissionId = await createFinalSubmission({ assignment, studentId: req.user.id, grade, attemptId });
  res.status(201).json({ message: 'Đã nộp bài chính thức cho giáo viên.', submissionId, ...grade });
});

app.get('/api/assignments/:id/report', requireAuth, async (req, res) => {
  const assignmentId = idSchema.parse(req.params.id);
  const pagination = getPagination(req, 8);
  const assignments = await query('SELECT * FROM assignments WHERE id = ? LIMIT 1', [assignmentId]);
  const assignment = assignments[0];
  if (!assignment || !(await canManageClass(req.user, assignment.class_id))) return res.status(403).json({ message: 'Không có quyền xem báo cáo bài này.' });

  const reportTotals = await query(`SELECT COUNT(*) total, SUM(CASE WHEN s.id IS NOT NULL THEN 1 ELSE 0 END) submittedCount
    FROM class_students cs LEFT JOIN submissions s ON s.student_id = cs.student_id AND s.assignment_id = ?
    WHERE cs.class_id = ?`, [assignmentId, assignment.class_id]);
  const limitSql = paginationLimitSql(pagination);
  const studentParams = [assignmentId, assignment.class_id];
  const students = await query(`SELECT u.id, u.full_name fullName, u.email, s.id submissionId, s.percentage,
    s.score, s.max_score maxScore, s.submitted_at submittedAt, s.ai_summary summary
    FROM class_students cs JOIN users u ON u.id = cs.student_id
    LEFT JOIN submissions s ON s.student_id = u.id AND s.assignment_id = ?
    WHERE cs.class_id = ? ORDER BY u.full_name${limitSql}`, studentParams);
  const studentIds = students.map((student) => student.id);
  const attemptCountByStudent = new Map();
  const latestAttemptByStudent = new Map();
  if (studentIds.length) {
    const placeholders = studentIds.map(() => '?').join(',');
    const attemptCounts = await query(`SELECT student_id studentId, COUNT(*) attemptCount
      FROM assignment_attempts WHERE assignment_id = ? AND student_id IN (${placeholders})
      GROUP BY student_id`, [assignmentId, ...studentIds]);
    for (const row of attemptCounts) attemptCountByStudent.set(Number(row.studentId), Number(row.attemptCount || 0));

    // Chỉ lấy lần Check AI gần nhất của mỗi học sinh. Giáo viên vẫn xem được
    // chi tiết câu trả lời cuối cùng nhưng API không trả toàn bộ lịch sử attempt nữa.
    const latestAttempts = await query(`SELECT aa.id, aa.student_id studentId, aa.attempt_no attemptNo, aa.score,
      aa.max_score maxScore, aa.percentage, aa.result_json resultJson, aa.ai_summary summary,
      aa.ai_used aiUsed, aa.submission_id submissionId, aa.created_at createdAt, aa.submitted_at submittedAt
      FROM assignment_attempts aa
      INNER JOIN (
        SELECT student_id, MAX(attempt_no) maxAttemptNo
        FROM assignment_attempts
        WHERE assignment_id = ? AND student_id IN (${placeholders})
        GROUP BY student_id
      ) latest ON latest.student_id = aa.student_id AND latest.maxAttemptNo = aa.attempt_no
      WHERE aa.assignment_id = ?`, [assignmentId, ...studentIds, assignmentId]);

    for (const attempt of latestAttempts) {
      const results = typeof attempt.resultJson === 'string' ? JSON.parse(attempt.resultJson) : attempt.resultJson || [];
      const { resultJson: _hiddenResultJson, ...safeAttempt } = attempt;
      latestAttemptByStudent.set(Number(attempt.studentId), {
        ...safeAttempt,
        results,
        aiUsed: Boolean(attempt.aiUsed),
        submitted: Boolean(attempt.submissionId),
      });
    }
  }
  let stats = [];
  if (studentIds.length) {
    const placeholders = studentIds.map(() => '?').join(',');
    stats = await query(`SELECT student_id studentId, topic, attempted, correct_count correctCount,
      ROUND(correct_count / attempted * 100, 1) mastery FROM skill_stats
      WHERE student_id IN (${placeholders}) ORDER BY mastery ASC, attempted DESC`, studentIds);
  }
  const weakByStudent = new Map();
  for (const stat of stats) {
    if (stat.mastery >= 75) continue;
    const list = weakByStudent.get(stat.studentId) || [];
    if (list.length < 3) list.push({ topic: stat.topic, mastery: stat.mastery });
    weakByStudent.set(stat.studentId, list);
  }
  res.json({
    total: Number(reportTotals[0]?.total || 0),
    submittedCount: Number(reportTotals[0]?.submittedCount || 0),
    pagination: pagination ? paginationMeta(reportTotals[0]?.total, pagination) : null,
    students: students.map((student) => ({
      ...student,
      submitted: Boolean(student.submissionId),
      attemptCount: attemptCountByStudent.get(Number(student.id)) || 0,
      latestAttempt: latestAttemptByStudent.get(Number(student.id)) || null,
      weakTopics: weakByStudent.get(student.id) || weakByStudent.get(Number(student.id)) || [],
    })),
  });
});

app.get('/api/students/me/recommendations', requireAuth, requireRole('STUDENT'), async (req, res) => {
  const stats = await query(`SELECT topic, attempted, correct_count correctCount, ROUND(correct_count / attempted * 100, 1) mastery,
    last_score lastScore FROM skill_stats WHERE student_id = ? ORDER BY mastery ASC, attempted DESC LIMIT 8`, [req.user.id]);
  res.json({
    recommendations: stats.filter((item) => item.mastery < 80).map((item) => ({
      ...item,
      message: `Ôn thêm ${item.topic} — mức nắm vững hiện tại khoảng ${item.mastery}%.`,
    })),
  });
});

app.post('/api/practice/vocabulary/:id/record', requireAuth, requireRole('STUDENT'), async (req, res) => {
  const vocabularyId = idSchema.parse(req.params.id);
  const input = z.object({ correct: z.boolean() }).safeParse(req.body);
  if (!input.success) return badRequest(res, 'Kết quả luyện tập chưa hợp lệ.');
  const rows = await query(`SELECT v.lesson_id lessonId FROM vocabulary v JOIN class_vocabulary cv ON cv.vocabulary_id = v.id
    JOIN class_students cs ON cs.class_id = cv.class_id WHERE v.id = ? AND cs.student_id = ? LIMIT 1`, [vocabularyId, req.user.id]);
  if (!rows[0]) return res.status(403).json({ message: 'Từ này chưa được giao cho lớp của bạn.' });
  const topic = `Từ vựng · Bài ${rows[0].lessonId}`;
  const correctValue = input.data.correct ? 1 : 0;
  await query(`INSERT INTO skill_stats (student_id, topic, attempted, correct_count, last_score) VALUES (?, ?, 1, ?, ?)
    ON DUPLICATE KEY UPDATE attempted = attempted + 1, correct_count = correct_count + VALUES(correct_count), last_score = VALUES(last_score)`,
    [req.user.id, topic, correctValue, correctValue * 100]);
  res.json({ message: 'Đã cập nhật tiến độ ôn tập.' });
});

app.get('/api/notifications', requireAuth, async (req, res) => {
  const pagination = getPagination(req, 10);
  const totals = await query(`SELECT COUNT(*) total,
    SUM(CASE WHEN read_at IS NULL THEN 1 ELSE 0 END) unreadCount FROM notifications WHERE user_id = ?`, [req.user.id]);
  const params = [req.user.id];
  const limitSql = pagination ? paginationLimitSql(pagination) : ' LIMIT 50';
  const notifications = await query(`SELECT id, type, title, message, reference_type referenceType, reference_id referenceId,
    read_at readAt, created_at createdAt FROM notifications WHERE user_id = ? ORDER BY created_at DESC${limitSql}`, params);
  res.json({
    notifications,
    unreadCount: Number(totals[0]?.unreadCount || 0),
    pagination: pagination ? paginationMeta(totals[0]?.total, pagination) : null,
  });
});

app.patch('/api/notifications/:id/read', requireAuth, async (req, res) => {
  const notificationId = idSchema.parse(req.params.id);
  await query('UPDATE notifications SET read_at = COALESCE(read_at, NOW()) WHERE id = ? AND user_id = ?', [notificationId, req.user.id]);
  res.json({ ok: true });
});

app.post('/api/notifications/announce', requireAuth, requireRole('TEACHER', 'ADMIN'), async (req, res) => {
  const schema = z.object({
    title: z.string().trim().min(1, 'Vui lòng nhập tiêu đề thông báo.').max(100),
    message: z.string().trim().min(1, 'Vui lòng nhập nội dung thông báo.').max(500),
    classId: z.union([z.string(), z.number()]).optional().default('ALL'),
  });
  const parse = schema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ message: parse.error.issues[0]?.message || 'Dữ liệu gửi lên chưa đúng.' });

  const { title, message, classId } = parse.data;
  let count = 0;
  if (String(classId) === 'ALL') {
    if (req.user.role === 'ADMIN') {
      const result = await query(
        `INSERT INTO notifications (user_id, type, title, message, reference_type, reference_id)
         SELECT id, 'ANNOUNCEMENT', ?, ?, 'ANNOUNCEMENT', NULL
         FROM users WHERE role = 'STUDENT' AND active = 1`,
        [title, message],
      );
      count = result.affectedRows || 0;
    } else {
      // Giáo viên chỉ được gửi "ALL" tới học sinh trong các lớp mình phụ trách.
      // DISTINCT tránh gửi trùng nếu một học sinh nằm ở nhiều lớp của cùng giáo viên.
      const result = await query(
        `INSERT INTO notifications (user_id, type, title, message, reference_type, reference_id)
         SELECT DISTINCT cs.student_id, 'ANNOUNCEMENT', ?, ?, 'ANNOUNCEMENT', NULL
         FROM class_students cs
         JOIN class_teachers ct ON ct.class_id = cs.class_id
         JOIN users u ON u.id = cs.student_id
         WHERE ct.teacher_id = ? AND u.role = 'STUDENT' AND u.active = 1`,
        [title, message, req.user.id],
      );
      count = result.affectedRows || 0;
    }
  } else {
    const parsedClassId = idSchema.safeParse(classId);
    if (!parsedClassId.success) return badRequest(res, 'Lớp nhận thông báo không hợp lệ.');
    const classNum = parsedClassId.data;
    if (req.user.role === 'TEACHER' && !(await teacherOwnsClass(req.user.id, classNum))) {
      return res.status(403).json({ message: 'Bạn không có quyền gửi thông báo cho lớp này.' });
    }
    const result = await query(
      `INSERT INTO notifications (user_id, type, title, message, reference_type, reference_id)
       SELECT cs.student_id, 'ANNOUNCEMENT', ?, ?, 'CLASS', ?
       FROM class_students cs JOIN users u ON u.id = cs.student_id
       WHERE cs.class_id = ? AND u.role = 'STUDENT' AND u.active = 1`,
      [title, message, classNum, classNum],
    );
    count = result.affectedRows || 0;
  }
  res.json({ message: `Đã gửi thông báo thành công đến ${count} học sinh!`, sentCount: count });
});


// Teacher AI ask about students
app.post('/api/teacher/ai-ask', requireAuth, requireRole('TEACHER', 'ADMIN'), aiRateLimiter, aiConcurrencyGuard, async (req, res) => {
  if (!(await aiEnabled())) return res.status(503).json({ message: 'Gemini chưa được Admin cấu hình.' });
  const input = z.object({
    question: z.string().min(2).max(2000),
    assignmentId: z.coerce.number().int().positive().optional(),
    studentId: z.coerce.number().int().positive().optional(),
  }).safeParse(req.body);
  if (!input.success) return res.status(400).json({ message: 'Câu hỏi không hợp lệ.' });

  const { question, assignmentId, studentId } = input.data;
  const teacherId = req.user.id;
  const teacherName = req.user.full_name || req.user.email;

  // Chặn IDOR: giáo viên không được truyền assignmentId của lớp khác để đọc điểm/dữ liệu học sinh qua AI.
  if (assignmentId) {
    const assignmentRows = await query('SELECT id, class_id FROM assignments WHERE id = ? LIMIT 1', [assignmentId]);
    if (!assignmentRows[0]) return res.status(404).json({ message: 'Không tìm thấy bài tập.' });
    if (req.user.role === 'TEACHER' && !(await teacherOwnsClass(req.user.id, assignmentRows[0].class_id))) {
      return res.status(403).json({ message: 'Bạn không có quyền dùng AI với dữ liệu bài này.' });
    }
  }

  // Build rich context directly from DB
  let contextLines = [`Giáo viên: ${teacherName}`];
  try {
    if (assignmentId) {
      // --- Context cho 1 bài tập cụ thể ---
      const [asgn] = await query(
        `SELECT a.id, a.title, a.type, a.status, a.due_at, c.name className, c.id classId,
          (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id = a.class_id) totalStudents
         FROM assignments a JOIN classes c ON c.id = a.class_id
         WHERE a.id = ?`, [assignmentId]
      );
      if (asgn) {
        contextLines.push(`\n=== BÀI TẬP ===`);
        contextLines.push(`Tên: "${asgn.title}" | Loại: ${asgn.type} | Lớp: ${asgn.className} | Hạn nộp: ${asgn.due_at ? new Date(asgn.due_at).toLocaleDateString('vi-VN') : 'không giới hạn'}`);
        contextLines.push(`Sĩ số lớp: ${asgn.totalStudents} học sinh`);
      }

      // Danh sách học sinh và kết quả
      const students = await query(
        `SELECT u.id, u.full_name,
          s.id subId, s.score, s.max_score, s.percentage, s.ai_summary, s.submitted_at submittedAt,
          (SELECT COUNT(*) FROM assignment_attempts WHERE assignment_id = a.id AND student_id = u.id) attemptCount
         FROM class_students cs
         JOIN users u ON u.id = cs.student_id
         JOIN assignments a ON a.id = ?
         LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = u.id
         WHERE cs.class_id = a.class_id
         ORDER BY (s.percentage IS NULL), s.percentage DESC`, [assignmentId]
      );

      if (students.length) {
        const submitted = students.filter(s => s.subId);
        const notSubmitted = students.filter(s => !s.subId);
        const avg = submitted.length ? Math.round(submitted.reduce((a, s) => a + Number(s.percentage || 0), 0) / submitted.length) : null;

        contextLines.push(`\n=== KẾT QUẢ TỔNG QUAN ===`);
        contextLines.push(`Đã nộp: ${submitted.length}/${students.length} | Điểm trung bình: ${avg ?? 'chưa có'}%`);

        if (submitted.length) {
          contextLines.push(`\n--- Danh sách học sinh đã nộp (sắp xếp theo điểm giảm dần) ---`);
          submitted.forEach((s, i) => {
            contextLines.push(`${i+1}. ${s.full_name}: ${Math.round(s.percentage || 0)}% (${s.score}/${s.max_score} điểm)${s.ai_summary ? ' | Nhận xét: ' + s.ai_summary : ''}`);
          });
        }
        if (notSubmitted.length) {
          contextLines.push(`\n--- Chưa nộp bài ---`);
          contextLines.push(notSubmitted.map(s => s.full_name + (s.attemptCount > 0 ? ` (đã check AI ${s.attemptCount} lần)` : '')).join(', '));
        }
      }

      // Câu hỏi và thống kê đúng/sai
      const qStats = await query(
        `SELECT q.prompt, q.correct_answer, q.type,
          COUNT(aa.id) total,
          SUM(aa.is_correct) correct,
          ROUND(100 * SUM(aa.is_correct) / NULLIF(COUNT(aa.id),0), 0) pctCorrect
         FROM questions q
         LEFT JOIN submission_answers aa ON aa.question_id = q.id
         JOIN submissions s ON s.id = aa.submission_id AND s.assignment_id = ?
         WHERE q.assignment_id = ?
         GROUP BY q.id ORDER BY pctCorrect ASC`, [assignmentId, assignmentId]
      );
      if (qStats.length) {
        contextLines.push(`\n=== THỐNG KÊ TỪNG CÂU HỎI ===`);
        qStats.forEach((q, i) => {
          const rate = q.pctCorrect ?? '—';
          contextLines.push(`Câu ${i+1}: "${q.prompt}" → Tỷ lệ đúng: ${rate}%${q.correct_answer ? ' | Đáp án: ' + q.correct_answer : ''}`);
        });
      }

      // Nếu hỏi về 1 học sinh cụ thể
      if (studentId) {
        const [stu] = await query(
          `SELECT u.full_name, s.score, s.max_score, s.percentage, s.ai_summary
           FROM submissions s JOIN users u ON u.id = s.student_id
           WHERE s.assignment_id = ? AND s.student_id = ?`, [assignmentId, studentId]
        );
        if (stu) {
          contextLines.push(`\n=== HỌC SINH ĐANG XEM ===`);
          contextLines.push(`${stu.full_name}: ${Math.round(stu.percentage || 0)}% | Nhận xét AI: ${stu.ai_summary || 'chưa có'}`);
        }
        const wrongAns = await query(
          `SELECT q.prompt, aa.answer_text answer, q.correct_answer, aa.feedback
           FROM submission_answers aa JOIN questions q ON q.id = aa.question_id
           JOIN submissions s ON s.id = aa.submission_id
           WHERE s.assignment_id = ? AND s.student_id = ? AND aa.is_correct = 0`, [assignmentId, studentId]
        );
        if (wrongAns.length) {
          contextLines.push(`Các câu sai của học sinh này:`);
          wrongAns.forEach((w, i) => contextLines.push(`  ${i+1}. Câu: "${w.prompt}" → HS trả lời: "${w.answer || '(bỏ trống)'}" | Đúng: "${w.correct_answer || 'tự luận'}" | Nhận xét: ${w.feedback || '—'}`));
        }
      }

    } else {
      // --- Không có assignmentId: lấy tổng quan tất cả lớp của GV ---
      contextLines.push(`\n=== TỔNG QUAN LỚP HỌC ===`);

      // Chỉ lấy các lớp giáo viên hiện đang được phân công; assignment cũ không tự cấp lại quyền lớp.
      const classes = req.user.role === 'ADMIN'
        ? await query(
          `SELECT c.id, c.name,
            (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id = c.id) studentCount
           FROM classes c WHERE c.active = 1 ORDER BY c.created_at DESC LIMIT 10`,
        )
        : await query(
          `SELECT c.id, c.name,
            (SELECT COUNT(*) FROM class_students cs WHERE cs.class_id = c.id) studentCount
           FROM classes c JOIN class_teachers ct ON ct.class_id = c.id
           WHERE ct.teacher_id = ? AND c.active = 1 ORDER BY c.created_at DESC LIMIT 10`, [teacherId]
        );

      if (!classes.length) {
        contextLines.push('Giáo viên chưa phụ trách lớp nào hoặc chưa có bài tập nào.');
      } else {
        for (const cls of classes) {
          const [stats] = await query(
            `SELECT COUNT(DISTINCT a.id) aCount, ROUND(AVG(s.percentage),1) avgPct,
              (SELECT COUNT(*) FROM submissions s2 JOIN assignments a2 ON a2.id = s2.assignment_id WHERE a2.class_id = ? AND a2.teacher_id = ?) subCount
             FROM assignments a LEFT JOIN submissions s ON s.assignment_id = a.id
             WHERE a.class_id = ? AND a.teacher_id = ?`, [cls.id, teacherId, cls.id, teacherId]
          );
          contextLines.push(`Lớp "${cls.name}": ${cls.studentCount} HS | ${stats.aCount} bài tập | ${stats.subCount} bài đã nộp | Điểm TB: ${stats.avgPct ?? 'chưa có'}%`);

          // Top 3 HS yếu nhất
          const weak = await query(
            `SELECT u.full_name, ROUND(AVG(s.percentage),0) avgPct
             FROM submissions s JOIN users u ON u.id = s.student_id
             JOIN assignments a ON a.id = s.assignment_id
             WHERE a.class_id = ? AND a.teacher_id = ?
             GROUP BY u.id ORDER BY avgPct ASC LIMIT 3`, [cls.id, teacherId]
          );
          if (weak.length) contextLines.push(`  → HS cần chú ý: ${weak.map(w => `${w.full_name} (${w.avgPct}%)`).join(', ')}`);
        }
      }
    }
  } catch (e) {
    console.warn('AI-ask context error:', sanitizeLogText(e.message));
    contextLines.push('[Một phần dữ liệu lớp học tạm thời chưa đọc được từ hệ thống.]');
  }

  const fullContext = contextLines.join('\n');
  const systemPrompt = `Bạn là trợ lý AI thông minh hỗ trợ giáo viên tiếng Hàn. Bạn đã được cung cấp đầy đủ dữ liệu lớp học từ hệ thống, hãy dựa vào đó để trả lời trực tiếp, cụ thể, không hỏi lại giáo viên "vui lòng cung cấp thêm thông tin". Nếu không có đủ dữ liệu một phần nào đó, hãy nói rõ phần đó chưa có dữ liệu. Trả lời bằng tiếng Việt, ngắn gọn, thực tế và có ích.\n\nDỮ LIỆU HIỆN TẠI TỪ HỆ THỐNG:\n${fullContext}`;

  try {
    const answer = await generateTextWithAI({ prompt: question, systemPrompt, temperature: 0.35, maxOutputTokens: 800, userId: req.user.id, route: 'teacher-ai-ask' });
    res.json({ answer: answer.trim() });
  } catch (err) {
    const aiError = aiErrorResponse(err);
    res.status(aiError.status).json({ message: aiError.message, code: aiError.code });
  }
});

// Bảo trì nhẹ. Không tự đóng/xóa bài đã publish trên production.
async function runMaintenance() {
  try {
    await cleanupRefreshTokens();
    await query('DELETE FROM ai_usage_events WHERE created_at < DATE_SUB(NOW(), INTERVAL 90 DAY)');
    await query('DELETE FROM system_error_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)');

    if (config.autoCleanupDays > 0) {
      const result = await query(
        `DELETE FROM assignments WHERE created_at < DATE_SUB(NOW(), INTERVAL ${config.autoCleanupDays} DAY) AND status = 'DRAFT'`,
      );
      if (result.affectedRows > 0) console.log(`[maintenance] Deleted ${result.affectedRows} stale DRAFT assignments.`);
    }
  } catch (error) {
    console.warn('[maintenance] Error:', sanitizeLogText(error.message));
  }
}
setTimeout(runMaintenance, 5000).unref?.();
setInterval(runMaintenance, 24 * 60 * 60 * 1000).unref?.();

app.use((req, res) => res.status(404).json({ message: `Không có API ${req.method} ${req.path}` }));

app.use((error, req, res, _next) => {
  if (error?.name === 'ZodError') return res.status(400).json({ message: 'ID hoặc dữ liệu gửi lên chưa hợp lệ.' });
  if (error?.message === 'CORS_ORIGIN_DENIED') return res.status(403).json({ message: 'Nguồn truy cập không được phép.' });
  if (error?.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Dữ liệu đã tồn tại hoặc thao tác đã được thực hiện trước đó.' });

  const isDbTimeout = ['PROTOCOL_SEQUENCE_TIMEOUT', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED'].includes(error?.code);
  const statusCode = isDbTimeout ? 503 : 500;
  console.error(`[${req.requestId || '-'}]`, sanitizeLogText(error?.stack || error?.message, 1500));
  void recordSystemError({ req, error, statusCode });
  return res.status(statusCode).json({
    message: isDbTimeout ? 'Cơ sở dữ liệu đang phản hồi chậm. Vui lòng thử lại.' : 'Có lỗi máy chủ. Vui lòng thử lại sau.',
    requestId: req.requestId,
  });
});

export default app;
