require('dotenv').config();

const express = require('express');
const session = require('express-session');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const fs = require('fs');

console.log('[STARTUP] Starting application...');
console.log('[STARTUP] NODE_ENV:', process.env.NODE_ENV);
console.log('[STARTUP] PORT:', process.env.PORT);
console.log('[STARTUP] PWD:', process.cwd());
console.log('[STARTUP] UID:', process.getuid?.() || 'unknown');

// Определяем директории
const DATA_DIR = process.env.DATA_DIR || '/tmp/data';
const LOG_DIR = process.env.LOG_DIR || '/tmp/logs';
const UPLOADS_DIR = process.env.UPLOADS_DIR || '/tmp/uploads';

console.log('[STARTUP] DATA_DIR:', DATA_DIR);
console.log('[STARTUP] LOG_DIR:', LOG_DIR);
console.log('[STARTUP] UPLOADS_DIR:', UPLOADS_DIR);

// Создаём все директории
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

// Загружаем конфиг
let config;
try {
    config = require('./config');
    console.log('[STARTUP] Config loaded');
} catch (error) {
    console.error('[STARTUP] Config error:', error.message);
    process.exit(1);
}

config.storage.localPath = UPLOADS_DIR;

// Загружаем логгер
let logger;
try {
    process.env.LOG_DIR = LOG_DIR;
    logger = require('./logger');
    console.log('[STARTUP] Logger loaded');
} catch (error) {
    console.error('[STARTUP] Logger error:', error.message);
    logger = { info: console.log, error: console.error, warn: console.warn, debug: console.log };
}

// Загружаем database
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

const app = express();

// Настройка шаблонов
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

// Middleware
try {
    app.use(helmet({ 
        contentSecurityPolicy: false, 
        crossOriginEmbedderPolicy: false 
    }));
    app.use(cors());
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    console.log('[STARTUP] Middleware configured');
} catch (error) {
    console.error('[STARTUP] Middleware error:', error.message);
    process.exit(1);
}

// Сессии - ИСПОЛЬЗУЕМ БОЛЕЕ НАДЕЖНОЕ ХРАНИЛИЩЕ
try {
    // В production используем внешнее хранилище (Redis, PostgreSQL и т.д.)
    // Для разработки используем MemoryStore с предупреждением
    const sessionConfig = {
        secret: config.session.secret,
        resave: false,
        saveUninitialized: false,
        cookie: {
            maxAge: config.session.maxAge,
            secure: config.server.nodeEnv === 'production',
            httpOnly: true,
            sameSite: 'lax',
        },
    };
    
    // Добавляем предупреждение о MemoryStore
    if (config.server.nodeEnv === 'production') {
        console.warn('[STARTUP] ⚠️ Using MemoryStore for sessions is not recommended for production');
        console.warn('[STARTUP] ⚠️ Consider using Redis or PostgreSQL for session storage');
    }
    
    app.use(session(sessionConfig));
    console.log('[STARTUP] Sessions configured');
} catch (error) {
    console.error('[STARTUP] Sessions error:', error.message);
    process.exit(1);
}

// Статические файлы
try {
    // Создаем public директорию если её нет
    const publicPath = path.join(__dirname, 'public');
    if (!fs.existsSync(publicPath)) {
        fs.mkdirSync(publicPath, { recursive: true });
        console.log('[STARTUP] Created public directory');
    }
    
    app.use('/static', express.static(publicPath));
    console.log('[STARTUP] Static: /public');

    if (!fs.existsSync(UPLOADS_DIR)) {
        fs.mkdirSync(UPLOADS_DIR, { recursive: true });
    }
    app.use('/uploads', express.static(UPLOADS_DIR));
    console.log(`[STARTUP] Static: /uploads -> ${UPLOADS_DIR}`);
} catch (error) {
    console.warn('[STARTUP] Static files warning:', error.message);
}

// ============ ИМПОРТ РОУТОВ ============
const MaxAPI = require('./platforms/max');

// ============ РОУТЫ ============

// Root
app.get('/', (req, res) => {
    res.json({
        name: 'Learning Bot Platform',
        version: '1.0.0',
        status: 'running',
        pid: process.pid,
        uid: process.getuid?.() || 'unknown',
        directories: { data: DATA_DIR, logs: LOG_DIR, uploads: UPLOADS_DIR },
    });
});

// Health
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        pid: process.pid,
        memory: process.memoryUsage(),
    });
});

// MAX Webhook
app.post('/webhook/max', async (req, res) => {
    try {
        const webhookSecret = config.max.webhookSecret;
        if (webhookSecret) {
            const received = req.headers['x-max-bot-api-secret'];
            if (!received || received !== webhookSecret) {
                logger.warn('MAX webhook: Invalid secret');
                return res.status(401).send('Unauthorized');
            }
        }

        // Отправляем 200 OK сразу
        res.status(200).send('ok');

        // Обрабатываем событие асинхронно
        setImmediate(async () => {
            try {
                const update = req.body;
                logger.info({ update_type: update.update_type, chat_id: update.chat_id }, 'MAX webhook received');

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
                        logger.info(`Bot added to chat: ${update.chat_id}`);
                        break;
                    case 'bot_removed':
                        logger.info(`Bot removed from chat: ${update.chat_id}`);
                        break;
                    default:
                        logger.info(`Unhandled update type: ${update.update_type}`);
                }
            } catch (error) {
                logger.error({ err: error, update: req.body }, 'Error processing webhook');
            }
        });

    } catch (error) {
        logger.error('MAX webhook error:', error.message);
        res.status(500).send('Internal server error');
    }
});

// VK Webhook
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

// Регистрация вебхука
app.post('/admin/register-webhook', async (req, res) => {
    try {
        const maxApi = new MaxAPI();
        const webhookUrl = `${config.server.publicUrl}/webhook/max`;
        const result = await maxApi.registerWebhook(webhookUrl);
        res.json({ success: true, result });
    } catch (error) {
        logger.error({ err: error }, 'Failed to register webhook');
        res.status(500).json({ error: error.message });
    }
});

// Получение информации о вебхуке
app.get('/admin/webhook-info', async (req, res) => {
    try {
        const maxApi = new MaxAPI();
        const info = await maxApi.getWebhookInfo();
        res.json(info);
    } catch (error) {
        logger.error({ err: error }, 'Failed to get webhook info');
        res.status(500).json({ error: error.message });
    }
});

// Удаление вебхука
app.delete('/admin/webhook', async (req, res) => {
    try {
        const maxApi = new MaxAPI();
        await maxApi.deleteWebhook();
        res.json({ success: true });
    } catch (error) {
        logger.error({ err: error }, 'Failed to delete webhook');
        res.status(500).json({ error: error.message });
    }
});

// Admin
app.get('/admin', (req, res) => {
    res.json({ message: 'Admin API' });
});

// 404
app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
    console.error('[ERROR]', err.message);
    res.status(500).json({ error: 'Internal server error' });
});

// ============ ОБРАБОТЧИКИ СОБЫТИЙ ============

async function handleBotStarted(update) {
    try {
        const chatId = update.chat_id;
        const userId = update.user?.user_id;
        const payload = update.payload || '';

        logger.info({ chatId, userId, payload }, 'Bot started');

        const maxApi = new MaxAPI();
        await maxApi.sendMessage({
            chatId: chatId,
            text: `👋 Привет! Добро пожаловать в обучающий бот!\n\nЯ помогу тебе учиться. Используй /start чтобы начать или /help для помощи.`,
            parseMode: 'markdown',
        });

    } catch (error) {
        logger.error({ err: error, update }, 'Error handling bot_started');
    }
}

async function handleMessageCreated(update) {
    try {
        const chatId = update.chat_id;
        const message = update.message;
        const text = message?.text || '';
        const userId = update.user?.user_id;

        if (!text) return;

        logger.info({ chatId, userId, text: text.substring(0, 50) }, 'Message received');

        if (text.startsWith('/start')) {
            await handleStartCommand(chatId, userId, text);
        } else if (text.startsWith('/help')) {
            await handleHelpCommand(chatId);
        } else if (text.startsWith('/courses')) {
            await handleCoursesCommand(chatId);
        } else {
            await handleTextMessage(chatId, userId, text);
        }

    } catch (error) {
        logger.error({ err: error, update }, 'Error handling message_created');
    }
}

async function handleMessageCallback(update) {
    try {
        const chatId = update.chat_id;
        const callback = update.callback;
        const payload = callback?.payload || '';
        const userId = update.user?.user_id;

        logger.info({ chatId, userId, payload }, 'Callback received');

        const maxApi = new MaxAPI();
        
        if (payload === 'show_courses') {
            await showCourses(chatId, maxApi);
        } else if (payload === 'show_help') {
            await maxApi.sendMessage({
                chatId: chatId,
                text: `📚 **Помощь по боту**\n\n` +
                      `/start - Начать обучение\n` +
                      `/help - Показать это сообщение\n` +
                      `/courses - Показать список курсов\n\n` +
                      `Просто напиши мне сообщение, и я помогу!`,
                parseMode: 'markdown',
            });
        } else {
            await maxApi.sendMessage({
                chatId: chatId,
                text: `✅ Вы выбрали: ${payload}`,
                parseMode: 'markdown',
            });
        }

    } catch (error) {
        logger.error({ err: error, update }, 'Error handling message_callback');
    }
}

// ============ КОМАНДЫ ============

async function handleStartCommand(chatId, userId, text) {
    const maxApi = new MaxAPI();
    
    const payload = text.split(' ')[1] || '';
    if (payload) {
        logger.info({ chatId, payload }, 'Deep link payload received');
    }

    const buttons = [
        [
            { type: 'callback', text: '📚 Смотреть курсы', payload: 'show_courses' },
            { type: 'callback', text: '❓ Помощь', payload: 'show_help' },
        ]
    ];

    await maxApi.sendKeyboard({
        chatId: chatId,
        text: `👋 **Добро пожаловать в обучающий бот!**\n\n` +
              `Я помогу тебе освоить новые знания. Выбери действие:`,
        buttons: buttons,
        parseMode: 'markdown',
    });
}

async function handleHelpCommand(chatId) {
    const maxApi = new MaxAPI();
    await maxApi.sendMessage({
        chatId: chatId,
        text: `📚 **Помощь по боту**\n\n` +
              `/start - Начать обучение\n` +
              `/help - Показать это сообщение\n` +
              `/courses - Показать список курсов\n\n` +
              `Просто напиши мне сообщение, и я помогу!`,
        parseMode: 'markdown',
    });
}

async function handleCoursesCommand(chatId) {
    await showCourses(chatId);
}

async function showCourses(chatId, maxApi = null) {
    if (!maxApi) {
        maxApi = new MaxAPI();
    }
    
    const courseService = require('./core/course');
    const courses = await courseService.getAllCourses(true);

    if (courses.length === 0) {
        await maxApi.sendMessage({
            chatId: chatId,
            text: '📚 **Курсы**\n\nПока нет доступных курсов. Загляните позже!',
            parseMode: 'markdown',
        });
        return;
    }

    let text = '📚 **Доступные курсы**\n\n';
    const buttons = [];

    courses.forEach((course, index) => {
        text += `${index + 1}. **${course.title}**\n`;
        text += `   ${course.description || 'Без описания'}\n`;
        text += `   ${course.price > 0 ? `💰 ${course.price} руб.` : '🆓 Бесплатно'}\n\n`;
        
        buttons.push([
            { 
                type: 'callback', 
                text: `📖 ${course.title.substring(0, 20)}`, 
                payload: `course_${course.id}` 
            }
        ]);
    });

    buttons.push([
        { type: 'callback', text: '❓ Помощь', payload: 'show_help' }
    ]);

    await maxApi.sendKeyboard({
        chatId: chatId,
        text: text + 'Выберите курс:',
        buttons: buttons,
        parseMode: 'markdown',
    });
}

async function handleTextMessage(chatId, userId, text) {
    const maxApi = new MaxAPI();
    
    const buttons = [
        [
            { type: 'callback', text: '📚 Курсы', payload: 'show_courses' },
            { type: 'callback', text: '❓ Помощь', payload: 'show_help' },
        ]
    ];

    await maxApi.sendKeyboard({
        chatId: chatId,
        text: `📝 Я получил твое сообщение:\n\n"${text}"\n\nЧто хочешь сделать дальше?`,
        buttons: buttons,
        parseMode: 'markdown',
    });
}

// ============ ЗАПУСК ============

const PORT = parseInt(process.env.PORT) || 8080;
const HOST = '0.0.0.0';

console.log(`[STARTUP] Starting on ${HOST}:${PORT}...`);

const server = app.listen(PORT, HOST, () => {
    console.log(`[STARTUP] ✅ Server running on port ${PORT}`);
    console.log(`[STARTUP] Health: http://${HOST}:${PORT}/health`);
    console.log(`[STARTUP] Root: http://${HOST}:${PORT}/`);
    console.log(`[STARTUP] Webhook URL: ${config.server.publicUrl}/webhook/max`);
    console.log(`[STARTUP] ✅ Ready`);
});

// Обработка ошибок сервера
server.on('error', (error) => {
    console.error('[STARTUP] Server error:', error.message);
    if (error.code === 'EADDRINUSE') {
        console.error(`[STARTUP] Port ${PORT} is already in use`);
    }
    process.exit(1);
});

// Graceful shutdown - УЛУЧШЕННАЯ ВЕРСИЯ
const shutdown = (signal) => {
    console.log(`[SHUTDOWN] Received ${signal}`);
    console.log('[SHUTDOWN] Closing server...');
    
    server.close(() => {
        console.log('[SHUTDOWN] Server closed');
        
        // Закрываем соединения с БД если есть
        if (database && database.closePool) {
            database.closePool().then(() => {
                console.log('[SHUTDOWN] Database connections closed');
                process.exit(0);
            }).catch((err) => {
                console.error('[SHUTDOWN] Error closing database:', err);
                process.exit(1);
            });
        } else {
            process.exit(0);
        }
    });

    // Если не закрылось за 10 секунд - принудительно
    setTimeout(() => {
        console.error('[SHUTDOWN] Forced shutdown after timeout');
        process.exit(1);
    }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Обработка необработанных исключений
process.on('uncaughtException', (error) => {
    console.error('[FATAL] Uncaught Exception:', error);
    console.error('[FATAL] Stack:', error.stack);
    shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[FATAL] Unhandled Rejection at:', promise);
    console.error('[FATAL] Reason:', reason);
    shutdown('unhandledRejection');
});

console.log('[STARTUP] ✅ Ready');
