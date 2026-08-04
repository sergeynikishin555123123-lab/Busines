require('dotenv').config();

const config = {
  server: {
    port: parseInt(process.env.PORT) || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',
  },
  
  database: {
    url: process.env.DATABASE_URL || '',
    type: process.env.DB_TYPE || 'json',
  },
  
  session: {
    secret: process.env.SESSION_SECRET || 'default-secret-change-in-production',
    maxAge: parseInt(process.env.SESSION_MAX_AGE) || 86400000,
  },
  
  admin: {
    defaultLogin: process.env.DEFAULT_ADMIN_LOGIN || 'admin',
    defaultPassword: process.env.DEFAULT_ADMIN_PASSWORD || 'admin123',
  },
  
  vk: {
    groupId: parseInt(process.env.VK_GROUP_ID) || 0,
    confirmationToken: process.env.VK_CONFIRMATION_TOKEN || '',
    accessToken: process.env.VK_ACCESS_TOKEN || '',
    secret: process.env.VK_SECRET || '',
  },
  
  max: {
    botToken: process.env.MAX_BOT_TOKEN || '',
    apiUrl: process.env.MAX_API_URL || 'https://api.max.ru',
  },
  
  storage: {
    type: process.env.STORAGE_TYPE || 'local',
    localPath: process.env.STORAGE_LOCAL_PATH || './uploads',
    maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB) || 500,
    allowedExtensions: [
      '.jpg', '.jpeg', '.png', '.gif', '.svg', '.webp',
      '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
      '.mp4', '.avi', '.mov', '.wmv', '.flv', '.mkv',
      '.mp3', '.wav', '.ogg',
      '.txt', '.csv', '.json', '.xml', '.zip', '.rar',
    ],
    allowedMimeTypes: [
      'image/jpeg', 'image/png', 'image/gif', 'image/svg+xml', 'image/webp',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'video/mp4', 'video/x-msvideo', 'video/quicktime', 'video/x-ms-wmv', 'video/x-flv', 'video/x-matroska',
      'audio/mpeg', 'audio/wav', 'audio/ogg',
      'text/plain', 'text/csv', 'application/json', 'application/xml', 'application/zip', 'application/x-rar-compressed',
    ],
  },
  
  payment: {
    defaultGateway: process.env.DEFAULT_PAYMENT_GATEWAY || 'vkpay',
    vkpay: {
      merchantId: process.env.VKPAY_MERCHANT_ID || '',
      secretKey: process.env.VKPAY_SECRET_KEY || '',
    },
    yookassa: {
      shopId: process.env.YOOKASSA_SHOP_ID || '',
      secretKey: process.env.YOOKASSA_SECRET_KEY || '',
    },
    cloudpayments: {
      publicId: process.env.CLOUDPAYMENTS_PUBLIC_ID || '',
      apiSecret: process.env.CLOUDPAYMENTS_API_SECRET || '',
    },
  },
  
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    dir: process.env.LOG_DIR || './logs',
  },
};

module.exports = config;
