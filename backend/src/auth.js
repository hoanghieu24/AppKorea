import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { query, withTransaction } from './db.js';

const JWT_ISSUER = 'hanquoc-classroom';
const JWT_AUDIENCE = 'hanquoc-web';

export const hashPassword = (password) => bcrypt.hash(password, 12);
export const verifyPassword = (password, hash) => bcrypt.compare(password, hash);

function userPayload(user) {
  return {
    id: Number(user.id),
    email: user.email,
    role: user.role,
    full_name: user.full_name,
    fullName: user.full_name,
    active: Boolean(user.active),
  };
}

export function signToken(user) {
  return jwt.sign(
    {
      id: Number(user.id),
      email: user.email,
      role: user.role,
      fullName: user.full_name,
    },
    config.jwtSecret,
    {
      expiresIn: config.jwtExpiresIn,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      subject: String(user.id),
    },
  );
}

function parseCookies(req) {
  const out = {};
  const raw = String(req.headers.cookie || '');
  for (const part of raw.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try { out[key] = decodeURIComponent(value); }
    catch { out[key] = value; }
  }
  return out;
}

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function requestMeta(req) {
  return {
    userAgent: String(req.headers['user-agent'] || '').slice(0, 255),
    ipAddress: String(req.ip || req.socket?.remoteAddress || '').slice(0, 64),
  };
}

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: config.refreshCookieSecure,
    sameSite: config.refreshCookieSameSite,
    path: '/api/auth',
    maxAge: config.refreshTokenDays * 24 * 60 * 60 * 1000,
    ...(config.refreshCookieDomain ? { domain: config.refreshCookieDomain } : {}),
  };
}

function setRefreshCookie(res, token) {
  res.cookie(config.refreshCookieName, token, refreshCookieOptions());
}

export function clearRefreshCookie(res) {
  const options = refreshCookieOptions();
  delete options.maxAge;
  res.clearCookie(config.refreshCookieName, options);
}

function createRefreshTokenValue() {
  return crypto.randomBytes(48).toString('base64url');
}

export async function issueRefreshToken(userId, req, res) {
  const token = createRefreshTokenValue();
  const expiresAt = new Date(Date.now() + config.refreshTokenDays * 24 * 60 * 60 * 1000);
  const meta = requestMeta(req);
  await query(
    `INSERT INTO auth_refresh_tokens (user_id, token_hash, expires_at, user_agent, ip_address)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, tokenHash(token), expiresAt, meta.userAgent || null, meta.ipAddress || null],
  );
  setRefreshCookie(res, token);
  return token;
}

export async function rotateRefreshToken(req, res) {
  const raw = parseCookies(req)[config.refreshCookieName];
  if (!raw) return null;

  const oldHash = tokenHash(raw);
  const newToken = createRefreshTokenValue();
  const newHash = tokenHash(newToken);
  const expiresAt = new Date(Date.now() + config.refreshTokenDays * 24 * 60 * 60 * 1000);
  const meta = requestMeta(req);

  const user = await withTransaction(async (connection) => {
    const [rows] = await connection.execute(
      `SELECT rt.id tokenId, rt.user_id userId, u.id, u.email, u.full_name, u.role, u.active
       FROM auth_refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = ? AND rt.revoked_at IS NULL AND rt.expires_at > NOW()
       LIMIT 1 FOR UPDATE`,
      [oldHash],
    );
    const row = rows[0];
    if (!row || !row.active) return null;

    await connection.execute('UPDATE auth_refresh_tokens SET revoked_at = NOW(), last_used_at = NOW() WHERE id = ?', [row.tokenId]);
    await connection.execute(
      `INSERT INTO auth_refresh_tokens (user_id, token_hash, expires_at, user_agent, ip_address)
       VALUES (?, ?, ?, ?, ?)`,
      [row.userId, newHash, expiresAt, meta.userAgent || null, meta.ipAddress || null],
    );
    return userPayload(row);
  });

  if (!user) {
    // Không xóa cookie ở đây: một request refresh cũ từ tab khác có thể về sau
    // và vô tình xóa refresh cookie mới vừa được rotate thành công.
    return null;
  }

  setRefreshCookie(res, newToken);
  return user;
}

export async function revokeRefreshToken(req, res) {
  const raw = parseCookies(req)[config.refreshCookieName];
  if (raw) {
    try {
      await query('UPDATE auth_refresh_tokens SET revoked_at = COALESCE(revoked_at, NOW()) WHERE token_hash = ?', [tokenHash(raw)]);
    } catch {
      // Logout vẫn phải xóa cookie kể cả DB tạm lỗi.
    }
  }
  clearRefreshCookie(res);
}

export async function revokeAllRefreshTokensForUser(userId) {
  await query('UPDATE auth_refresh_tokens SET revoked_at = COALESCE(revoked_at, NOW()) WHERE user_id = ? AND revoked_at IS NULL', [userId]);
}

export async function cleanupRefreshTokens() {
  return query('DELETE FROM auth_refresh_tokens WHERE expires_at < DATE_SUB(NOW(), INTERVAL 7 DAY) OR revoked_at < DATE_SUB(NOW(), INTERVAL 30 DAY)');
}

export async function requireAuth(req, res, next) {
  const raw = req.headers.authorization || '';
  const token = raw.startsWith('Bearer ') ? raw.slice(7) : '';
  if (!token) return res.status(401).json({ message: 'Bạn cần đăng nhập.' });

  let decoded;
  try {
    decoded = jwt.verify(token, config.jwtSecret, { issuer: JWT_ISSUER, audience: JWT_AUDIENCE });
  } catch {
    return res.status(401).json({ message: 'Phiên đăng nhập đã hết hạn.' });
  }

  try {
    const userId = Number(decoded.id || decoded.sub);
    if (!Number.isInteger(userId) || userId <= 0) return res.status(401).json({ message: 'Phiên đăng nhập không hợp lệ.' });
    const rows = await query('SELECT id, email, full_name, role, active FROM users WHERE id = ? LIMIT 1', [userId]);
    const current = rows[0];
    if (!current || !current.active) return res.status(401).json({ message: 'Tài khoản không còn hoạt động.' });

    // Luôn dùng role/trạng thái mới nhất trong DB, không tin role cũ nằm trong JWT.
    req.user = userPayload(current);
    return next();
  } catch (error) {
    return next(error);
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: 'Bạn không có quyền thực hiện thao tác này.' });
    }
    return next();
  };
}
