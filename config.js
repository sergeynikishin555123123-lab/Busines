// config.js — ПОЛНАЯ КОНФИГУРАЦИЯ

require('dotenv').config();

const config = {
  // ============================================================
  // СЕРВЕР
  // ============================================================
  server: {
    port: parseInt(process.env.PORT) || 8080,
    publicUrl: process.env.PUBLIC_URL || 'http://localhost:8080',
  },

  // ============================================================
  // БЕЗОПАСНОСТЬ
  // ============================================================
  session: {
    secret: process.env.SESSION_SECRET || 'default-secret-change-me',
    maxAge: parseInt(process.env.SESSION_MAX_AGE) || 86400000,
  },

  // ============================================================
  // АДМИН
  // ============================================================
  admin: {
    defaultLogin: process.env.ADMIN_LOGIN || 'admin',
    defaultPassword: process.env.ADMIN_PASSWORD || 'Admin2024!Secure',
  },

  // ============================================================
  // MAX
  // ============================================================
  max: {
    baseUrl: process.env.MAX_API_URL || 'https://platform-api2.max.ru',
    token: process.env.MAX_BOT_TOKEN || '',
    webhookSecret: process.env.MAX_WEBHOOK_SECRET || 'my_super_secret_webhook_2024_abc123',
  },

  // ============================================================
  // VK
  // ============================================================
  vk: {
    groupToken: process.env.VK_GROUP_TOKEN || '',
   confirmationToken: process.env.VK_CONFIRMATION_TOKEN || '3bae5d25',
    apiVersion: process.env.VK_API_VERSION || '5.131',
    secret: process.env.VK_SECRET || '',
    groupId: process.env.VK_GROUP_ID || '',
  },

  // ============================================================
  // ХРАНИЛИЩЕ
  // ============================================================
  storage: {
    type: process.env.STORAGE_TYPE || 'local',
    localPath: process.env.UPLOADS_DIR || '/tmp/uploads',
  },

  // ============================================================
  // ПЛАТЕЖИ
  // ============================================================
  payment: {
    defaultGateway: process.env.PAYMENT_GATEWAY || 'manual',
    testMode: process.env.PAYMENT_TEST_MODE === 'true',
    // Можно добавить другие шлюзы при необходимости
  },

  // ============================================================
  // ОГРАНИЧЕНИЯ
  // ============================================================
  rateLimit: {
    messagesPerChatPerSecond: 5,
    maxFileSize: parseInt(process.env.MAX_FILE_SIZE) || 52428800,
  },

  // ============================================================
  // ЛОГИРОВАНИЕ
  // ============================================================
  logLevel: process.env.LOG_LEVEL || 'info',
};

module.exports = config;
