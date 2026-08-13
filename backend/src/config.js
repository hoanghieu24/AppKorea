import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });

export const config = {
  port: Number(process.env.PORT || 4000),
  clientUrl: process.env.CLIENT_URL || 'http://localhost:5173',
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '1234567',
    database: process.env.DB_NAME || 'hanquoc_classroom',
  },
  jwtSecret: process.env.JWT_SECRET || 'dev-only-change-me-before-deploy',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',
  settingsEncryptionKey: process.env.SETTINGS_ENCRYPTION_KEY || process.env.JWT_SECRET || 'dev-only-change-me-before-deploy',
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
};
