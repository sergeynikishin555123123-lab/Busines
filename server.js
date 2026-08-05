// server.js - ПОЛНАЯ ВЕРСИЯ С АДМИН-ПАНЕЛЬЮ В БОТЕ MAX
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
console.log('[STARTUP] UID:', process.getuid?.() || 'unknown');

const DATA_DIR = process.env.DATA_DIR || '/tmp/data';
const LOG_DIR = process.env.LOG_DIR || '/tmp/logs';
const UPLOADS_DIR = process.env.UPLOADS_DIR || '/tmp/uploads';

console.log('[STARTUP] DATA_DIR:', DATA_DIR);
console.log('[STARTUP] LOG_DIR:', LOG_DIR);
console.log('[STARTUP] UPLOADS_DIR:', UPLOADS_DIR);

const dirs = [DATA_DIR, LOG_DIR, UPLOADS_DIR];
for (const dir of dirs) {
    try {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
            console.log(`[STARTUP] Created: ${dir}`);
        }
    } catch (error) {
        console.error(`[STARTUP] Cannot create ${dir}:`, error.message);
    }
}

const subDirs = ['videos', 'files', 'images', 'admin', 'temp'];
for (const sub of subDirs) {
    const fullPath = path.join(UPLOADS_DIR, sub);
    if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
    }
}

let config;
try {
    config = require('./config');
    console.log('[STARTUP] Config loaded');
} catch (error) {
    console.error('[STARTUP] Config error:', error.message);
    process.exit(1);
}

config.storage.localPath = UPLOADS_DIR;

let logger;
try {
    process.env.LOG_DIR = LOG_DIR;
    logger = require('./logger');
    console.log('[STARTUP] Logger loaded');
} catch (error) {
    console.error('[STARTUP] Logger error:', error.message);
    logger = { info: console.log, error: console.error, warn: console.warn, debug: console.log };
}

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

// ============================================================
// АВТОМАТИЧЕСКОЕ СОЗДАНИЕ АДМИНА
// ============================================================
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

(async function initAdmin() {
    await ensureAdmin();
})();

// ============================================================
// НАСТРОЙКА MULTER
// ============================================================
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        let subDir = 'files';
        if (file.mimetype && file.mimetype.startsWith('video/')) {
            subDir = 'videos';
        } else if (file.mimetype && file.mimetype.startsWith('image/')) {
            subDir = 'images';
        }
        const dir = path.join(UPLOADS_DIR, subDir);
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const timestamp = Date.now();
        const random = Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        const name = path.basename(file.originalname, ext);
        const cleanName = name.replace(/[^a-zA-Zа-яА-Я0-9]/g, '_');
        cb(null, `${cleanName}-${timestamp}-${random}${ext}`);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 250 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo',
            'application/pdf', 'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/zip', 'application/x-zip-compressed',
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'text/plain', 'text/markdown',
        ];
        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`Неподдерживаемый тип файла: ${file.mimetype}`));
        }
    }
});

// ============================================================
// СОЗДАНИЕ EXPRESS APP
// ============================================================
const app = express();

try {
    app.set('view engine', 'ejs');
    const viewsPath = path.join(__dirname, 'admin', 'views');
    if (fs.existsSync(viewsPath)) {
        app.set('views', viewsPath);
        console.log('[STARTUP] Views configured');
    } else {
        console.warn('[STARTUP] Views directory not found, using default');
        app.set('views', path.join(__dirname, 'views'));
    }
} catch (error) {
    console.error('[STARTUP] Views error:', error.message);
}

try {
    app.use(helmet({
        contentSecurityPolicy: false,
        crossOriginEmbedderPolicy: false
    }));
    app.use(cors());
    app.use(express.json({ limit: '50mb' }));
    app.use(express.urlencoded({ extended: true, limit: '50mb' }));
    console.log('[STARTUP] Middleware configured');
} catch (error) {
    console.error('[STARTUP] Middleware error:', error.message);
    process.exit(1);
}

try {
    const sessionConfig = {
        secret: config.session.secret,
        resave: false,
        saveUninitialized: false,
        cookie: {
            maxAge: config.session.maxAge,
            secure: false,
            httpOnly: true,
            sameSite: 'lax',
        },
    };
    app.use(session(sessionConfig));
    console.log('[STARTUP] Sessions configured');
} catch (error) {
    console.error('[STARTUP] Sessions error:', error.message);
    process.exit(1);
}

try {
    const publicPath = path.join(__dirname, 'public');
    if (!fs.existsSync(publicPath)) {
        fs.mkdirSync(publicPath, { recursive: true });
    }
    app.use('/static', express.static(publicPath));
    app.use('/uploads', express.static(UPLOADS_DIR));
    console.log(`[STARTUP] Static: /uploads -> ${UPLOADS_DIR}`);
} catch (error) {
    console.warn('[STARTUP] Static files warning:', error.message);
}

// ============================================================
// ПОДКЛЮЧАЕМ WEB АДМИН-ПАНЕЛЬ (ОСТАВЛЯЕМ КАК БЫЛО)
// ============================================================
try {
    const adminRoutes = require('./admin/admin');
    app.use('/admin', adminRoutes);
    console.log('[STARTUP] Web Admin panel mounted at /admin');
} catch (error) {
    console.warn('[STARTUP] Web Admin panel not loaded:', error.message);
}

app.post('/admin/upload', upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        const fileData = {
            filename: req.file.filename,
            originalname: req.file.originalname,
            size: req.file.size,
            mimetype: req.file.mimetype,
            path: req.file.path,
            url: `/uploads/${path.basename(path.dirname(req.file.path))}/${req.file.filename}`,
        };
        res.json({ success: true, file: fileData });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// СЕРВИСЫ
// ============================================================
const MaxAPI = require('./platforms/max');
const courseService = require('./core/course');
const lessonService = require('./core/lesson');
const userService = require('./core/user');
const progressService = require('./core/progress');
const dispatcher = require('./core/dispatcher');

// ============================================================
// ОБРАБОТЧИКИ СОБЫТИЙ MAX (СОХРАНЯЕМ КАК БЫЛО)
// ============================================================
async function handleBotStarted(update) {
    console.log('[HANDLER] handleBotStarted called');
    try {
        const chatId = update.chat_id || update.message?.recipient?.chat_id;
        if (!chatId) return;
        const maxApi = new MaxAPI();
        await maxApi.sendKeyboard({
            chatId: chatId,
            text: `👋 **Привет! Я обучающий бот!**\n\nВыбери действие:`,
            buttons: [
                [{ type: 'callback', text: '📚 Уроки', payload: 'show_lessons' }],
                [{ type: 'callback', text: '💰 Купить доступ', payload: 'buy_access' }],
                [{ type: 'callback', text: '❓ Помощь', payload: 'show_help' }]
            ],
            parseMode: 'markdown',
        });
    } catch (error) {
        console.error('[HANDLER] Error in handleBotStarted:', error);
    }
}

// ============================================================
// ОБРАБОТКА СООБЩЕНИЙ С ВЛОЖЕНИЯМИ (ДОБАВЛЯЕМ НОВУЮ ЛОГИКУ)
// ============================================================
async function handleMessageCreated(update) {
    console.log('[HANDLER] handleMessageCreated called');
    try {
        const chatId = update.chat_id || update.message?.recipient?.chat_id;
        const message = update.message;
        const text = message?.body?.text || message?.text || '';
        const userId = message?.sender?.user_id || update.user?.user_id;
        const attachments = message?.attachments || [];

        console.log(`[HANDLER] chatId: ${chatId}, userId: ${userId}, text: "${text}", attachments: ${attachments.length}`);

        if (!chatId) return;

        const maxApi = new MaxAPI();
        const adminSession = dispatcher.adminSessions.get(chatId);

        // ============================================================
        // НОВОЕ: ОБРАБОТКА ВЛОЖЕНИЙ ОТ АДМИНИСТРАТОРА
        // ============================================================
        if (attachments.length > 0 && adminSession && adminSession.mode === 'admin') {
            await dispatcher.handleAdminAttachment(chatId, attachments);
            return;
        }

        // Админ-режим: ожидание пароля
        if (adminSession && adminSession.mode === 'awaiting_password') {
            await dispatcher.handleAdminPassword('max', { platform_user_id: chatId, id: userId }, text);
            return;
        }

        // Админ-режим: обработка текстовых команд
        if (adminSession && adminSession.mode === 'admin') {
            const context = adminSession.context || '';
            // Проверяем, не ждем ли мы данные для создания/редактирования
            if (context === 'creating_lesson' || context === 'creating_lesson_desc' ||
                context === 'editing_title' || context === 'editing_desc' ||
                context === 'editing_test') {
                await dispatcher.handleText('max', { platform_user_id: chatId, id: userId }, text);
                return;
            }
            if (context === 'uploading_video' || context === 'uploading_file') {
                // Если это текстовое сообщение, а не файл
                await dispatcher.handleText('max', { platform_user_id: chatId, id: userId }, text);
                return;
            }
            // Остальные админ-команды через dispatcher
            await dispatcher.handleMessage('max', userId, text, null);
            return;
        }

        // Обычные команды
        if (text.startsWith('/start')) {
            await handleStartCommand(chatId, userId, text, maxApi);
        } else if (text.startsWith('/help')) {
            await handleHelpCommand(chatId, maxApi);
        } else if (text.startsWith('/admin')) {
            await dispatcher.handleAdminLogin('max', { platform_user_id: chatId, id: userId }, text);
        } else {
            await dispatcher.handleMessage('max', userId, text, null);
        }
    } catch (error) {
        console.error('[HANDLER] Error in handleMessageCreated:', error);
        logger.error({ err: error, update }, 'Error handling message_created');
    }
}

// ============================================================
// ОБРАБОТКА CALLBACK (СОХРАНЯЕМ КАК БЫЛО, НО ДОБАВЛЯЕМ НОВЫЕ PAYLOAD)
// ============================================================
async function handleMessageCallback(update) {
    console.log('[HANDLER] handleMessageCallback called');
    try {
        const chatId = update.chat_id || update.message?.recipient?.chat_id;
        const callback = update.callback;
        const payload = callback?.payload || '';
        const userId = update.user?.user_id || update.user?.id || update.message?.sender?.user_id;

        console.log(`[HANDLER] Callback: chatId=${chatId}, payload=${payload}`);

        if (!chatId) return;

        const maxApi = new MaxAPI();
        const adminSession = dispatcher.adminSessions.get(chatId);

        // ============================================================
        // АДМИН-ПАНЕЛЬ CALLBACK (НОВАЯ ЛОГИКА)
        // ============================================================
        if (payload === 'admin_panel' || payload === 'admin_login') {
            await dispatcher.handleAdminLogin('max', { platform_user_id: chatId, id: userId }, '');
            return;
        }

        // Все админ-команды через dispatcher
        if (payload === 'admin_back' || payload.startsWith('admin_')) {
            await dispatcher.handleMessage('max', userId, '', payload);
            return;
        }

        // Новые payload для уроков и покупки
        if (payload === 'show_lessons' || payload === 'buy_access' || payload === 'show_help' || payload === 'main_menu') {
            await dispatcher.handleMessage('max', userId, '', payload);
            return;
        }

        // Остальные callback через dispatcher
        await dispatcher.handleMessage('max', userId, '', payload);
    } catch (error) {
        console.error('[HANDLER] Error in handleMessageCallback:', error);
        logger.error({ err: error, update }, 'Error handling message_callback');
    }
}

// ============================================================
// ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (КОМАНДЫ)
// ============================================================
async function handleStartCommand(chatId, userId, text, maxApi) {
    await maxApi.sendKeyboard({
        chatId: chatId,
        text: `👋 **Добро пожаловать!**\n\nВыберите действие:`,
        buttons: [
            [{ type: 'callback', text: '📚 Уроки', payload: 'show_lessons' }],
            [{ type: 'callback', text: '💰 Купить доступ', payload: 'buy_access' }],
            [{ type: 'callback', text: '❓ Помощь', payload: 'show_help' }]
        ],
        parseMode: 'markdown',
    });
}

async function handleHelpCommand(chatId, maxApi) {
    await maxApi.sendMessage({
        chatId: chatId,
        text: `📚 **Помощь**\n\n/start - Главное меню\n/help - Помощь\n/admin - Админ-панель`,
        parseMode: 'markdown',
    });
}

// ============================================================
// РОУТЫ (СОХРАНЯЕМ КАК БЫЛО)
// ============================================================
app.get('/', (req, res) => {
    res.json({
        name: 'Learning Bot Platform',
        version: '1.0.0',
        status: 'running',
        pid: process.pid,
        directories: { data: DATA_DIR, logs: LOG_DIR, uploads: UPLOADS_DIR },
    });
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString(), uptime: process.uptime() });
});

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
        const url = req.query.url;
        if (url) {
            await maxApi.deleteWebhook(url);
        } else {
            const info = await maxApi.getWebhookInfo();
            if (info && info.subscriptions) {
                for (const sub of info.subscriptions) {
                    await maxApi.deleteWebhook(sub.url);
                }
            }
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/admin/logs', (req, res) => {
    try {
        const logDir = '/tmp/logs';
        if (fs.existsSync(logDir)) {
            const files = fs.readdirSync(logDir);
            let logs = {};
            for (const file of files) {
                if (file.endsWith('.log')) {
                    const content = fs.readFileSync(path.join(logDir, file), 'utf-8');
                    logs[file] = content.split('\n').slice(-50).join('\n');
                }
            }
            res.json(logs);
        } else {
            res.json({ error: 'Log directory not found' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ============================================================
// WEBHOOK MAX (СОХРАНЯЕМ КАК БЫЛО, ДОБАВЛЯЕМ ОБРАБОТКУ ВЛОЖЕНИЙ)
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
                        await handleBotStarted(update);
                        break;
                    case 'message_created':
                        await handleMessageCreated(update);
                        break;
                    case 'message_callback':
                        await handleMessageCallback(update);
                        break;
                    case 'bot_added':
                        console.log(`[WEBHOOK] Bot added to chat: ${update.chat_id}`);
                        await handleBotStarted(update);
                        break;
                    case 'bot_removed':
                        console.log(`[WEBHOOK] Bot removed from chat: ${update.chat_id}`);
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

// VK Webhook (СОХРАНЯЕМ)
app.post('/webhook/vk', (req, res) => {
    try {
        const { type } = req.body;
        if (type === 'confirmation') {
            return res.send(config.vk.confirmationToken || 'test');
        }
        res.send('ok');
    } catch (error) {
        logger.error('VK webhook error:', error.message);
        res.send('ok');
    }
});

// ============================================================
// 404 и ERROR HANDLER (СОХРАНЯЕМ)
// ============================================================
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
    console.error('[ERROR]', err.message);
    console.error('[ERROR] Stack:', err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

// ============================================================
// ЗАПУСК (СОХРАНЯЕМ)
// ============================================================
const PORT = parseInt(process.env.PORT) || 8080;
const HOST = '0.0.0.0';

console.log(`[STARTUP] Starting on ${HOST}:${PORT}...`);
const server = app.listen(PORT, HOST, () => {
    console.log(`[STARTUP] ✅ Server running on port ${PORT}`);
    console.log(`[STARTUP] Health: http://${HOST}:${PORT}/health`);
    console.log(`[STARTUP] Webhook URL: ${config.server.publicUrl}/webhook/max`);
    console.log(`[STARTUP] Admin panel: ${config.server.publicUrl}/admin`);
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
