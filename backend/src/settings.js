import crypto from 'node:crypto';
import { config } from './config.js';
import { query } from './db.js';

const defaults = {
  geminiModel: config.geminiModel || 'gemini-2.5-flash',
  speechRate: 0.8,
  speechPitch: 1,
  voiceMode: 'online',
  voiceName: '',
  personality: 'hana',
  theme: 'light',
};

const secretKey = crypto.createHash('sha256').update(String(config.settingsEncryptionKey)).digest();
const legacySecretKeys = [...new Set([config.jwtSecret].filter(Boolean).filter((value) => value !== config.settingsEncryptionKey))]
  .map((value) => crypto.createHash('sha256').update(String(value)).digest());

export function encryptSecret(value) {
  if (!value) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptSecret(value) {
  if (!value) return '';
  if (!String(value).startsWith('v1:')) return String(value);
  const [, ivRaw, tagRaw, payloadRaw] = String(value).split(':');
  const keys = [secretKey, ...legacySecretKeys];
  let lastError;
  for (const key of keys) {
    try {
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivRaw, 'base64'));
      decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
      return Buffer.concat([decipher.update(Buffer.from(payloadRaw, 'base64')), decipher.final()]).toString('utf8');
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('SECRET_DECRYPT_FAILED');
}

function secretFingerprint(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 24);
}

function maskSecret(value) {
  const key = String(value || '');
  if (!key) return '';
  if (key.length <= 10) return `${key.slice(0, 2)}••••${key.slice(-2)}`;
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`;
}

async function settingsMap() {
  try {
    const rows = await query('SELECT setting_key settingKey, setting_value settingValue FROM system_settings');
    return new Map(rows.map((row) => [row.settingKey, row.settingValue]));
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE') return new Map();
    throw error;
  }
}

const fromMap = (map) => ({
  geminiModel: map.get('gemini_model') || defaults.geminiModel,
  speechRate: Number(map.get('speech_rate') || defaults.speechRate),
  speechPitch: Number(map.get('speech_pitch') || defaults.speechPitch),
  voiceMode: map.get('voice_mode') || defaults.voiceMode,
  voiceName: map.get('voice_name') || defaults.voiceName,
  personality: map.get('ai_personality') || defaults.personality,
  theme: map.get('learning_theme') || defaults.theme,
  announcementText: map.get('announcement_text') || '',
  announcementEnabled: map.get('announcement_enabled') === '1',
});

async function managedGeminiRows({ includeInactive = false } = {}) {
  try {
    return await query(
      `SELECT id, label, secret_encrypted secretEncrypted, fingerprint, active, priority,
              last_status lastStatus, cooldown_until cooldownUntil, failure_count failureCount,
              last_error lastError, last_used_at lastUsedAt, last_success_at lastSuccessAt,
              created_at createdAt, updated_at updatedAt
       FROM ai_api_keys
       WHERE provider = 'GEMINI' ${includeInactive ? '' : 'AND active = 1'}
       ORDER BY active DESC, priority ASC, id ASC`,
    );
  } catch (error) {
    if (error.code === 'ER_NO_SUCH_TABLE') return [];
    throw error;
  }
}

function keyCandidateFromManaged(row) {
  return {
    id: Number(row.id),
    label: row.label || `Gemini ${row.id}`,
    apiKey: decryptSecret(row.secretEncrypted),
    fingerprint: row.fingerprint,
    active: Boolean(row.active),
    priority: Number(row.priority || 100),
    lastStatus: row.lastStatus || 'UNKNOWN',
    cooldownUntil: row.cooldownUntil || null,
    failureCount: Number(row.failureCount || 0),
    source: 'database',
    managed: true,
  };
}

function keyAdminDto(candidate) {
  return {
    id: candidate.id ?? null,
    label: candidate.label,
    masked: maskSecret(candidate.apiKey),
    active: candidate.active !== false,
    priority: Number(candidate.priority || 100),
    status: candidate.lastStatus || 'UNKNOWN',
    cooldownUntil: candidate.cooldownUntil || null,
    failureCount: Number(candidate.failureCount || 0),
    source: candidate.source,
    managed: Boolean(candidate.managed),
    lastUsedAt: candidate.lastUsedAt || null,
    lastSuccessAt: candidate.lastSuccessAt || null,
    lastError: candidate.lastError || '',
  };
}

async function allGeminiCandidates({ includeInactive = false } = {}) {
  const map = await settingsMap();
  const managedRows = await managedGeminiRows({ includeInactive });
  const candidates = [];
  for (const row of managedRows) {
    try {
      candidates.push({
        ...keyCandidateFromManaged(row),
        lastUsedAt: row.lastUsedAt || null,
        lastSuccessAt: row.lastSuccessAt || null,
        lastError: row.lastError || '',
      });
    } catch {
      // Một record key hỏng/được mã hóa bằng secret không còn tồn tại không được làm sập cả pool AI.
      candidates.push({
        id: Number(row.id),
        label: row.label || `Gemini ${row.id}`,
        apiKey: '',
        fingerprint: row.fingerprint,
        active: false,
        priority: Number(row.priority || 100),
        lastStatus: 'DECRYPT_ERROR',
        cooldownUntil: null,
        failureCount: Number(row.failureCount || 0),
        source: 'database',
        managed: true,
        lastUsedAt: row.lastUsedAt || null,
        lastSuccessAt: row.lastSuccessAt || null,
        lastError: 'Không giải mã được key. Hãy xóa key này và thêm lại.',
      });
    }
  }
  const seen = new Set(candidates.map((item) => item.fingerprint).filter(Boolean));

  const legacyEncrypted = map.get('gemini_api_key');
  if (legacyEncrypted) {
    try {
      const apiKey = decryptSecret(legacyEncrypted);
      const fingerprint = secretFingerprint(apiKey);
      if (apiKey && !seen.has(fingerprint)) {
        candidates.push({
          id: null,
          label: 'Key cũ trong System Settings',
          apiKey,
          fingerprint,
          active: true,
          priority: 900,
          lastStatus: 'LEGACY',
          cooldownUntil: null,
          failureCount: 0,
          source: 'legacy',
          managed: false,
        });
        seen.add(fingerprint);
      }
    } catch {
      // Nếu key cũ không giải mã được, không để app crash. Admin sẽ thấy AI chưa có candidate này.
    }
  }

  config.geminiApiKeys.forEach((apiKey, index) => {
    const fingerprint = secretFingerprint(apiKey);
    if (!apiKey || seen.has(fingerprint)) return;
    candidates.push({
      id: null,
      label: `ENV Gemini ${index + 1}`,
      apiKey,
      fingerprint,
      active: true,
      priority: 1000 + index,
      lastStatus: 'ENV',
      cooldownUntil: null,
      failureCount: 0,
      source: 'env',
      managed: false,
    });
    seen.add(fingerprint);
  });

  return candidates;
}

export async function getAiRuntimeSettings() {
  const map = await settingsMap();
  const apiKeys = (await allGeminiCandidates()).filter((item) => item.active && item.apiKey);
  return {
    apiKey: apiKeys[0]?.apiKey || '',
    apiKeys,
    model: map.get('gemini_model') || defaults.geminiModel,
  };
}

export async function getSafeLearningSettings() {
  const map = await settingsMap();
  const common = fromMap(map);
  const runtime = await getAiRuntimeSettings();
  return { ...common, aiConfigured: runtime.apiKeys.length > 0 };
}

export async function getAdminSettings() {
  const safe = await getSafeLearningSettings();
  const allKeys = await allGeminiCandidates({ includeInactive: true });
  const apiKeys = allKeys.map(keyAdminDto);
  return {
    ...safe,
    apiKeyCount: apiKeys.filter((item) => item.active).length,
    apiKeys,
    // Giữ field cũ để frontend cũ không hỏng.
    apiKeyMasked: apiKeys[0]?.masked || '',
  };
}

function normalizeApiKeys(input) {
  const source = Array.isArray(input) ? input : String(input || '').split(/[\n,;]+/);
  return [...new Set(source.map((value) => String(value || '').trim()).filter(Boolean))];
}

export async function addGeminiApiKeys(input, userId) {
  const keys = normalizeApiKeys(input);
  if (!keys.length) return { added: 0, skipped: 0 };
  if (keys.length > 20) throw new Error('AI_KEYS_TOO_MANY');

  let added = 0;
  let skipped = 0;
  for (let index = 0; index < keys.length; index += 1) {
    const apiKey = keys[index];
    if (apiKey.length < 20 || apiKey.length > 500) throw new Error('AI_KEY_INVALID');
    const fingerprint = secretFingerprint(apiKey);
    const existing = await query('SELECT id FROM ai_api_keys WHERE provider = \'GEMINI\' AND fingerprint = ? LIMIT 1', [fingerprint]);
    if (existing[0]) {
      skipped += 1;
      continue;
    }
    await query(
      `INSERT INTO ai_api_keys
       (provider, label, secret_encrypted, fingerprint, active, priority, last_status, created_by)
       VALUES ('GEMINI', ?, ?, ?, 1, ?, 'READY', ?)`,
      [`Gemini API ${index + 1}`, encryptSecret(apiKey), fingerprint, 100 + index, userId],
    );
    added += 1;
  }
  return { added, skipped };
}

export async function deleteGeminiApiKey(id) {
  return query("DELETE FROM ai_api_keys WHERE id = ? AND provider = 'GEMINI'", [id]);
}

export async function setGeminiApiKeyActive(id, active) {
  return query(
    "UPDATE ai_api_keys SET active = ?, last_status = IF(?, 'READY', 'DISABLED'), cooldown_until = NULL WHERE id = ? AND provider = 'GEMINI'",
    [active ? 1 : 0, active ? 1 : 0, id],
  );
}

export async function updateGeminiKeyHealth(id, { status, cooldownSeconds = 0, error = '', success = false } = {}) {
  if (!id) return;
  const cooldownUntil = cooldownSeconds > 0 ? new Date(Date.now() + cooldownSeconds * 1000) : null;
  try {
    if (success) {
      await query(
        `UPDATE ai_api_keys SET last_status = 'HEALTHY', cooldown_until = NULL, failure_count = 0,
         last_error = NULL, last_used_at = NOW(), last_success_at = NOW() WHERE id = ?`,
        [id],
      );
    } else {
      await query(
        `UPDATE ai_api_keys SET last_status = ?, cooldown_until = ?, failure_count = failure_count + 1,
         last_error = ?, last_used_at = NOW() WHERE id = ?`,
        [String(status || 'ERROR').slice(0, 24), cooldownUntil, String(error || '').slice(0, 255) || null, id],
      );
    }
  } catch {
    // Failover AI không được phụ thuộc vào việc ghi trạng thái key.
  }
}

export async function saveAdminSettings(input, userId) {
  const updates = new Map([
    ['gemini_model', input.geminiModel],
    ['speech_rate', String(input.speechRate)],
    ['speech_pitch', String(input.speechPitch)],
    ['voice_mode', input.voiceMode],
    ['voice_name', input.voiceName || ''],
    ['ai_personality', input.personality],
    ['learning_theme', input.theme],
    ['announcement_text', input.announcementText || ''],
    ['announcement_enabled', input.announcementEnabled ? '1' : '0'],
  ]);

  for (const [key, value] of updates) {
    await query(
      `INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
      [key, value, userId],
    );
  }

  // Tương thích payload frontend cũ: nhập 1 key sẽ được thêm vào pool, không ghi đè key đang chạy.
  if (input.apiKey?.trim()) await addGeminiApiKeys(input.apiKey.trim(), userId);
  if (input.apiKeysText?.trim()) await addGeminiApiKeys(input.apiKeysText, userId);
  if (input.clearApiKey) {
    await query("DELETE FROM ai_api_keys WHERE provider = 'GEMINI'");
    await query("DELETE FROM system_settings WHERE setting_key = 'gemini_api_key'");
  }

  return getAdminSettings();
}

export async function getGeminiApiKeySecretById(id) {
  const rows = await managedGeminiRows({ includeInactive: true });
  const row = rows.find((item) => Number(item.id) === Number(id));
  return row ? { apiKey: decryptSecret(row.secretEncrypted), label: row.label || `Gemini ${row.id}` } : null;
}
