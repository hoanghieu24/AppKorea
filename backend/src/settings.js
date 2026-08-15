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

function encryptSecret(value) {
  if (!value) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', secretKey, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptSecret(value) {
  if (!value) return '';
  if (!String(value).startsWith('v1:')) return String(value);
  const [, ivRaw, tagRaw, payloadRaw] = String(value).split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', secretKey, Buffer.from(ivRaw, 'base64'));
  decipher.setAuthTag(Buffer.from(tagRaw, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(payloadRaw, 'base64')), decipher.final()]).toString('utf8');
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

export async function getAiRuntimeSettings() {
  const map = await settingsMap();
  const hasStoredKey = map.has('gemini_api_key');
  const apiKey = hasStoredKey ? decryptSecret(map.get('gemini_api_key')) : config.geminiApiKey;
  return { apiKey, model: map.get('gemini_model') || defaults.geminiModel };
}

export async function getSafeLearningSettings() {
  const map = await settingsMap();
  const common = fromMap(map);
  const runtime = await getAiRuntimeSettings();
  return { ...common, aiConfigured: Boolean(runtime.apiKey) };
}

export async function getAdminSettings() {
  const safe = await getSafeLearningSettings();
  const runtime = await getAiRuntimeSettings();
  const apiKeyMasked = runtime.apiKey ? `${runtime.apiKey.slice(0, 4)}••••••••${runtime.apiKey.slice(-4)}` : '';
  return { ...safe, apiKeyMasked };
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
  if (input.clearApiKey) updates.set('gemini_api_key', '');
  else if (input.apiKey?.trim()) updates.set('gemini_api_key', encryptSecret(input.apiKey.trim()));

  for (const [key, value] of updates) {
    await query(
      `INSERT INTO system_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
      [key, value, userId],
    );
  }
  return getAdminSettings();
}
