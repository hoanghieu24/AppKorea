import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

// Backend dùng file backend/.env khi chạy local. Trên Render, ENV được inject trực tiếp.
dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

const nodeEnv = String(process.env.NODE_ENV || 'development').toLowerCase();
const isProduction = nodeEnv === 'production';

function intEnv(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new Error(`${name} phải là số.`);
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

function boolEnv(name, fallback = false) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).toLowerCase());
}

function csvEnv(name, fallback = []) {
  const raw = String(process.env[name] || '').trim();
  if (!raw) return fallback;
  return raw.split(',').map((item) => item.trim()).filter(Boolean);
}

function normalizeOrigin(value) {
  return String(value || '').trim().replace(/\/$/, '');
}

const clientUrls = csvEnv('CLIENT_URL', ['http://localhost:5173']).map(normalizeOrigin);
const fallbackGeminiKeys = [
  ...csvEnv('GEMINI_API_KEYS'),
  String(process.env.GEMINI_API_KEY || '').trim(),
].filter(Boolean);

const dbSslEnabled = boolEnv('DB_SSL', false);
const dbSslCaBase64 = String(process.env.DB_SSL_CA_BASE64 || '').trim();

export const config = {
  nodeEnv,
  isProduction,
  port: intEnv('PORT', 4000, { min: 1, max: 65535 }),
  clientUrls,
  clientUrl: clientUrls[0] || 'http://localhost:5173',
  trustProxy: intEnv('TRUST_PROXY', isProduction ? 1 : 0, { min: 0, max: 10 }),

  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: intEnv('DB_PORT', 3306, { min: 1, max: 65535 }),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || (isProduction ? '' : '1234567'),
    database: process.env.DB_NAME || 'hanquoc_classroom',
    connectTimeout: intEnv('DB_CONNECT_TIMEOUT_MS', 10000, { min: 1000, max: 60000 }),
    queryTimeout: intEnv('DB_QUERY_TIMEOUT_MS', 15000, { min: 1000, max: 120000 }),
    connectionLimit: intEnv('DB_CONNECTION_LIMIT', 10, { min: 1, max: 100 }),
    queueLimit: intEnv('DB_QUEUE_LIMIT', 100, { min: 1, max: 10000 }),
    ssl: dbSslEnabled
      ? {
          rejectUnauthorized: boolEnv('DB_SSL_REJECT_UNAUTHORIZED', true),
          ...(dbSslCaBase64 ? { ca: Buffer.from(dbSslCaBase64, 'base64').toString('utf8') } : {}),
        }
      : undefined,
  },

  jwtSecret: process.env.JWT_SECRET || (isProduction ? '' : 'dev-only-change-me-before-deploy'),
  // Access token ngắn. Refresh token HttpOnly giữ phiên đăng nhập lâu hơn mà không phải lưu JWT trong localStorage.
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '1h',
  refreshTokenDays: intEnv('REFRESH_TOKEN_DAYS', 30, { min: 1, max: 180 }),
  refreshCookieName: process.env.REFRESH_COOKIE_NAME || 'hq_refresh',
  refreshCookieSameSite: String(process.env.REFRESH_COOKIE_SAME_SITE || (isProduction ? 'none' : 'lax')).toLowerCase(),
  refreshCookieSecure: boolEnv('REFRESH_COOKIE_SECURE', isProduction),
  refreshCookieDomain: String(process.env.REFRESH_COOKIE_DOMAIN || '').trim(),

  settingsEncryptionKey: process.env.SETTINGS_ENCRYPTION_KEY || (isProduction ? '' : 'dev-only-settings-change-me'),
  geminiApiKeys: [...new Set(fallbackGeminiKeys)],
  geminiApiKey: fallbackGeminiKeys[0] || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  aiTimeoutMs: intEnv('AI_TIMEOUT_MS', 25000, { min: 5000, max: 60000 }),
  // Batch thật: 3-5 câu tự luận được gộp vào MỘT Gemini request. Mặc định 5 để giảm số lần gọi tối đa.
  aiGradingBatchSize: intEnv('AI_GRADING_BATCH_SIZE', 5, { min: 3, max: 5 }),
  aiKeyCooldownSeconds: intEnv('AI_KEY_COOLDOWN_SECONDS', 60, { min: 5, max: 3600 }),
  aiPromptMaxChars: intEnv('AI_PROMPT_MAX_CHARS', 12000, { min: 1000, max: 30000 }),
  aiHistoryMaxMessages: intEnv('AI_HISTORY_MAX_MESSAGES', 24, { min: 4, max: 40 }),
  aiHistoryMaxChars: intEnv('AI_HISTORY_MAX_CHARS', 40000, { min: 5000, max: 120000 }),
  ttsTimeoutMs: intEnv('TTS_TIMEOUT_MS', 12000, { min: 3000, max: 30000 }),

  rateLimits: {
    generalPerMinute: intEnv('RATE_LIMIT_GENERAL_PER_MINUTE', 1200, { min: 60, max: 10000 }),
    loginPer15Minutes: intEnv('RATE_LIMIT_LOGIN_PER_15_MINUTES', 10, { min: 3, max: 100 }),
    loginIpPer15Minutes: intEnv('RATE_LIMIT_LOGIN_IP_PER_15_MINUTES', 120, { min: 20, max: 1000 }),
    refreshPer15Minutes: intEnv('RATE_LIMIT_REFRESH_PER_15_MINUTES', 60, { min: 10, max: 500 }),
    aiPerMinute: intEnv('RATE_LIMIT_AI_PER_MINUTE', 30, { min: 5, max: 300 }),
    aiConcurrentPerUser: intEnv('RATE_LIMIT_AI_CONCURRENT_PER_USER', 2, { min: 1, max: 10 }),
    ttsPerMinute: intEnv('RATE_LIMIT_TTS_PER_MINUTE', 120, { min: 10, max: 1000 }),
  },

  // 0 = không tự xóa/đóng bài. Production mặc định an toàn: dữ liệu giáo viên không tự biến mất.
  autoCleanupDays: intEnv('AUTO_CLEANUP_DAYS', 0, { min: 0, max: 3650 }),
};

function validateProductionConfig() {
  if (!isProduction) return;

  const missing = [];
  for (const [name, value] of [
    ['CLIENT_URL', clientUrls.length ? clientUrls.join(',') : ''],
    ['DB_HOST', config.db.host],
    ['DB_USER', config.db.user],
    ['DB_PASSWORD', config.db.password],
    ['DB_NAME', config.db.database],
    ['JWT_SECRET', config.jwtSecret],
    ['SETTINGS_ENCRYPTION_KEY', config.settingsEncryptionKey],
  ]) {
    if (!String(value || '').trim()) missing.push(name);
  }

  if (missing.length) {
    throw new Error(`Thiếu biến môi trường production: ${missing.join(', ')}`);
  }
  if (config.jwtSecret.length < 32) throw new Error('JWT_SECRET production phải dài ít nhất 32 ký tự.');
  if (config.settingsEncryptionKey.length < 32) throw new Error('SETTINGS_ENCRYPTION_KEY production phải dài ít nhất 32 ký tự.');
  if (config.jwtSecret === config.settingsEncryptionKey) {
    throw new Error('JWT_SECRET và SETTINGS_ENCRYPTION_KEY phải là hai secret khác nhau trên production.');
  }
  if (!['lax', 'strict', 'none'].includes(config.refreshCookieSameSite)) {
    throw new Error('REFRESH_COOKIE_SAME_SITE chỉ nhận lax, strict hoặc none.');
  }
  if (config.refreshCookieSameSite === 'none' && !config.refreshCookieSecure) {
    throw new Error('SameSite=None bắt buộc REFRESH_COOKIE_SECURE=true trên production.');
  }
  if (clientUrls.some((origin) => !/^https:\/\//i.test(origin))) {
    throw new Error('CLIENT_URL production phải dùng HTTPS.');
  }
}

validateProductionConfig();
