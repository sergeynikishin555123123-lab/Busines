// config.js
require('dotenv').config();

module.exports = {
    server: {
        port: process.env.PORT || 8080,
        nodeEnv: process.env.NODE_ENV || 'development',
        publicUrl: process.env.PUBLIC_URL || 'https://sergeynikishin555123123-lab-busines-4cdb.twc1.net',
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
        // ПРАВИЛЬНЫЙ URL
        baseUrl: 'https://platform-api2.max.ru',
        webhookPath: '/webhook/max',
        webhookSecret: process.env.MAX_WEBHOOK_SECRET || '',
    },

    vk: {
        token: process.env.VK_GROUP_TOKEN || '',
        confirmationToken: process.env.VK_CONFIRMATION_TOKEN || 'test',
        apiVersion: process.env.VK_API_VERSION || '5.131',
        secret: process.env.VK_SECRET || '',
        groupId: process.env.VK_GROUP_ID || '',
    },

    storage: {
        localPath: process.env.UPLOADS_DIR || '/tmp/uploads',
        maxFileSize: 20 * 1024 * 1024,
    },

    rateLimit: {
        messagesPerChatPerSecond: 2,
    },

   payment: {
        defaultGateway: process.env.PAYMENT_GATEWAY || 'manual',
        yookassa: {
            shopId: process.env.YOOKASSA_SHOP_ID || '',
            secretKey: process.env.YOOKASSA_SECRET_KEY || '',
            returnUrl: process.env.YOOKASSA_RETURN_URL || '',
        },
        stripe: {
            secretKey: process.env.STRIPE_SECRET_KEY || '',
            publicKey: process.env.STRIPE_PUBLIC_KEY || '',
        },
        robokassa: {
            merchantLogin: process.env.ROBOKASSA_MERCHANT_LOGIN || '',
            password1: process.env.ROBOKASSA_PASSWORD_1 || '',
            password2: process.env.ROBOKASSA_PASSWORD_2 || '',
        },
    },
    
    // ... остальные настройки ...
};
