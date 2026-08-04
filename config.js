require('dotenv').config();

module.exports = {
  server: {
    port: process.env.PORT || 8080,
    nodeEnv: process.env.NODE_ENV || 'development',
  },
  session: {
    secret: process.env.SESSION_SECRET || 'super-secret-key-change-this',
    maxAge: 24 * 60 * 60 * 1000,
  },
  admin: {
    defaultLogin: process.env.ADMIN_LOGIN || 'admin',
    defaultPassword: process.env.ADMIN_PASSWORD || 'admin123',
  },
  max: {
    token: process.env.MAX_BOT_TOKEN || '',
    baseUrl: 'https://platform-api2.max.ru',
    webhookPath: '/webhook/max',
    webhookSecret: process.env.MAX_WEBHOOK_SECRET || '',
  },
  vk: {
    token: process.env.VK_GROUP_TOKEN || '',
    confirmationToken: process.env.VK_CONFIRMATION_TOKEN || 'test',
    apiVersion: '5.131',
  },
  storage: {
    localPath: process.env.UPLOADS_DIR || '/tmp/uploads',
    maxFileSize: 20 * 1024 * 1024,
  },
  rateLimit: {
    messagesPerChatPerSecond: 2,
  },
};
