// server.js - НОВАЯ ВЕРСИЯ (ТОЛЬКО ВЕБХУК + БОТ)
require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const crypto = require('crypto');
const axios = require('axios');

console.log('[STARTUP] Starting application...');
console.log('[STARTUP] NODE_ENV:', process.env.NODE_ENV);
console.log('[STARTUP] PORT:', process.env.PORT);
console.log('[STARTUP] PWD:', process.cwd());

// Директории
const DATA_DIR = process.env.DATA_DIR || '/tmp/data';
const LOG_DIR = process.env.LOG_DIR || '/tmp/logs';
const UPLOADS_DIR = process.env.UPLOADS_DIR || '/tmp/uploads';

console.log('[STARTUP] DATA_DIR:', DATA_DIR);
console.log('[STARTUP] LOG_DIR:', LOG_DIR);
console.log('[STARTUP] UPLOADS_DIR:', UPLOADS_DIR);

// Создаем директории
const dirs = [DATA_DIR, LOG_DIR, UPLOADS_DIR];
for (const dir of dirs) {
    try {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        console.log(`[STARTUP] Created: ${dir}`);
    } catch (error) {
        console.error(`[STARTUP] Cannot create ${dir}:`, error.message);
    }
}

// Загрузка конфига
let config;
try {
    config = require('./config');
    console.log('[STARTUP] Config loaded');
} catch (error) {
    console.error('[STARTUP] Config error:', error.message);
    process.exit(1);
}
config.storage.localPath = UPLOADS_DIR;

// Загрузка логгера
let logger;
try {
    process.env.LOG_DIR = LOG_DIR;
    logger = require('./logger');
    console.log('[STARTUP] Logger loaded');
} catch (error) {
    console.error('[STARTUP] Logger error:', error.message);
    logger = { info: console.log, error: console.error, warn: console.warn, debug: console.log };
}

// Загрузка базы данных
let database;
try {
    process.env.DATA_DIR = DATA_DIR;
    database = require('./database');
    console.log('[STARTUP] Database loaded');
} catch (error) {
    console.error('[STARTUP] Database error:', error.message);
    process.exit(1);
}

try {
    database.initDatabase();
    console.log('[STARTUP] Database initialized');
} catch (error) {
    console.error('[STARTUP] DB init error:', error.message);
    process.exit(1);
}

// Создание админа
async function ensureAdmin() {
    try {
        const admins = database.readTable('admins');
        if (admins.length === 0) {
            console.log('[STARTUP] No admin found, creating default admin...');
            const login = config.admin.defaultLogin || 'admin';
            const password = config.admin.defaultPassword || 'admin123';
            const passwordHash = await bcrypt.hash(password, 12);
            const newAdmin = {
                id: database.generateId(),
                login: login,
                password_hash: passwordHash,
                role: 'superadmin',
                platform_user_id: null,
                created_at: database.now(),
            };
            admins.push(newAdmin);
            database.writeTable('admins', admins);
            console.log(`[STARTUP] ✅ Admin created: ${login} / ${password}`);
            logger.info({ login }, 'Default admin created');
        } else {
            console.log(`[STARTUP] Admin(s) already exist: ${admins.map(a => a.login).join(', ')}`);
        }
    } catch (error) {
        console.error('[STARTUP] Error creating admin:', error.message);
    }
}
(async function initAdmin() { await ensureAdmin(); })();

// ============================================================
// СОЗДАНИЕ EXPRESS APP
// ============================================================
const app = express();

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Сессии (нужны для админ-панели в боте)
app.use(session({
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: config.session.maxAge, secure: false, httpOnly: true, sameSite: 'lax' }
}));

// Статические файлы
const publicPath = path.join(__dirname, 'public');
if (!fs.existsSync(publicPath)) fs.mkdirSync(publicPath, { recursive: true });
app.use('/static', express.static(publicPath));
app.use('/uploads', express.static(UPLOADS_DIR));

// ============================================================
// ЗАГРУЗКА СЕРВИСОВ
// ============================================================
const MaxAPI = require('./platforms/max');
const dispatcher = require('./core/dispatcher');
const courseService = require('./core/course');
const lessonService = require('./core/lesson');
const userService = require('./core/user');
const progressService = require('./core/progress');
const paymentService = require('./core/payment');

// ============================================================
// ВЕБХУК MAX
// ============================================================
app.post('/webhook/max', async (req, res) => {
    console.log('[WEBHOOK] ========== WEBHOOK RECEIVED ==========');
    try {
        const webhookSecret = config.max.webhookSecret;
        if (webhookSecret) {
            const received = req.headers['x-max-bot-api-secret'];
            if (!received || received !== webhookSecret) {
                console.warn('[WEBHOOK] Invalid secret!');
                return res.status(401).send('Unauthorized');
            }
        }
        res.status(200).send('ok');
        console.log('[WEBHOOK] Sent 200 OK');

        setImmediate(async () => {
            try {
                const update = req.body;
                console.log('[WEBHOOK] Processing update type:', update.update_type);

                switch (update.update_type) {
                    case 'bot_started':
                    case 'bot_added':
                        // Отправляем приветственное сообщение
                        const chatId = update.chat_id || update.message?.recipient?.chat_id;
                        if (chatId) {
                            const maxApi = new MaxAPI();
                            const buttons = [
                                [{ type: 'callback', text: '📚 Уроки', payload: 'show_lessons' }],
                                [{ type: 'callback', text: '💰 Купить доступ', payload: 'buy_access' }],
                                [{ type: 'callback', text: '❓ Помощь', payload: 'show_help' }]
                            ];
                            await maxApi.sendKeyboard({
                                chatId,
                                text: '👋 **Привет! Я обучающий бот!**\n\nВыбери действие:',
                                buttons,
                                parseMode: 'markdown'
                            });
                        }
                        break;

                    case 'message_created':
                        const message = update.message;
                        const userId = message?.sender?.user_id || update.user?.user_id;
                        const text = message?.body?.text || message?.text || '';
                        const payload = message?.body?.payload || message?.payload || null;

                        // Проверяем, не является ли сообщение паролем для админки
                        const adminSession = dispatcher.adminSessions.get(chatId);
                        if (adminSession && adminSession.mode === 'awaiting_password') {
                            await dispatcher.handleAdminPassword('max', { platform_user_id: chatId, id: userId }, text);
                            break;
                        }

                        // Проверяем, не ждем ли мы данные для создания/редактирования урока
                        if (adminSession && adminSession.mode === 'admin') {
                            const context = adminSession.context || '';
                            if (context === 'creating_lesson' || context === 'creating_lesson_desc') {
                                await dispatcher.handleText('max', { platform_user_id: chatId, id: userId }, text);
                                break;
                            }
                            if (context === 'editing_title' || context === 'editing_desc') {
                                await dispatcher.handleText('max', { platform_user_id: chatId, id: userId }, text);
                                break;
                            }
                        }

                        // Обычное сообщение
                        await dispatcher.handleMessage('max', userId, text, payload);
                        break;

                    case 'message_callback':
                        const callback = update.callback;
                        const callbackPayload = callback?.payload || '';
                        const callbackUserId = update.user?.user_id || update.message?.sender?.user_id;
                        await dispatcher.handleMessage('max', callbackUserId, '', callbackPayload);
                        break;

                    default:
                        console.log(`[WEBHOOK] Unhandled update type: ${update.update_type}`);
                }
                console.log('[WEBHOOK] Processing complete');
            } catch (error) {
                console.error('[WEBHOOK] Error processing:', error);
                logger.error({ err: error, update: req.body }, 'Error processing webhook');
            }
        });
    } catch (error) {
        console.error('[WEBHOOK] Fatal error:', error);
        res.status(500).send('Internal server error');
    }
});

// ============================================================
// РОУТЫ ДЛЯ УПРАВЛЕНИЯ
// ============================================================
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

app.get('/', (req, res) => {
    res.json({ name: 'Learning Bot Platform', version: '1.0.0', status: 'running' });
});

// Регистрация вебхука (из register-webhook.js)
app.post('/admin/register-webhook', async (req, res) => {
    try {
        const maxApi = new MaxAPI();
        const webhookUrl = `${config.server.publicUrl}/webhook/max`;
        const result = await maxApi.registerWebhook(webhookUrl);
        res.json({ success: true, result, webhookUrl });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/admin/webhook-info', async (req, res) => {
    try {
        const maxApi = new MaxAPI();
        const info = await maxApi.getWebhookInfo();
        res.json(info);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/admin/webhook', async (req, res) => {
    try {
        const maxApi = new MaxAPI();
        await maxApi.deleteWebhook();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// ЗАПУСК
// ============================================================
const PORT = parseInt(process.env.PORT) || 8080;
const HOST = '0.0.0.0';

console.log(`[STARTUP] Starting on ${HOST}:${PORT}...`);
const server = app.listen(PORT, HOST, () => {
    console.log(`[STARTUP] ✅ Server running on port ${PORT}`);
    console.log(`[STARTUP] Health: http://${HOST}:${PORT}/health`);
    console.log(`[STARTUP] Webhook URL: ${config.server.publicUrl}/webhook/max`);
    console.log(`[STARTUP] ✅ Ready`);
});

server.on('error', (error) => {
    console.error('[STARTUP] Server error:', error.message);
    process.exit(1);
});

const shutdown = (signal) => {
    console.log(`[SHUTDOWN] Received ${signal}`);
    server.close(() => {
        console.log('[SHUTDOWN] Server closed');
        process.exit(0);
    });
    setTimeout(() => {
        console.error('[SHUTDOWN] Forced shutdown');
        process.exit(1);
    }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

console.log('[STARTUP] ✅ Ready');
