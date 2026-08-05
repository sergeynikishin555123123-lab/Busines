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
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));
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
            secure: config.server.nodeEnv === 'production',
            httpOnly: true,
            sameSite: 'lax',
        },
    };

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

try {
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

const MaxAPI = require('./platforms/max');

// ============ РОУТЫ ============

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

app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        pid: process.pid,
        memory: process.memoryUsage(),
    });
});

// Dashboard
app.get('/dashboard', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ============ MAX WEBHOOK ============
app.post('/webhook/max', async (req, res) => {
    console.log('[WEBHOOK] ========== WEBHOOK RECEIVED ==========');
    console.log('[WEBHOOK] Body:', JSON.stringify(req.body, null, 2));
    
    try {
        const webhookSecret = config.max.webhookSecret;
        if (webhookSecret) {
            const received = req.headers['x-max-bot-api-secret'];
            if (!received || received !== webhookSecret) {
                console.warn('[WEBHOOK] Invalid secret!');
                return res.status(401).send('Unauthorized');
            }
        }

        // Отправляем 200 OK сразу
        res.status(200).send('ok');
        console.log('[WEBHOOK] Sent 200 OK');

        // Обрабатываем событие асинхронно
        setImmediate(async () => {
            try {
                const update = req.body;
                console.log('[WEBHOOK] Processing update type:', update.update_type);
                
                switch (update.update_type) {
                    case 'bot_started':
                        console.log('[WEBHOOK] Handling bot_started');
                        await handleBotStarted(update);
                        break;
                    case 'message_created':
                        console.log('[WEBHOOK] Handling message_created');
                        await handleMessageCreated(update);
                        break;
                    case 'message_callback':
                        console.log('[WEBHOOK] Handling message_callback');
                        await handleMessageCallback(update);
                        break;
                    case 'bot_added':
                        console.log(`[WEBHOOK] Bot added to chat: ${update.chat_id}`);
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

// Admin endpoints
app.post('/admin/register-webhook', async (req, res) => {
    try {
        const maxApi = new MaxAPI();
        const webhookUrl = `${config.server.publicUrl}/webhook/max`;
        const result = await maxApi.registerWebhook(webhookUrl);
        res.json({ success: true, result, webhookUrl });
    } catch (error) {
        logger.error({ err: error }, 'Failed to register webhook');
        res.status(500).json({ error: error.message });
    }
});

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

app.delete('/admin/webhook', async (req, res) => {
    try {
        const maxApi = new MaxAPI();
        const url = req.query.url;
        if (url) {
            await maxApi.deleteWebhook(url);
        } else {
            // Если URL не указан, удаляем все подписки
            const info = await maxApi.getWebhookInfo();
            if (info && info.subscriptions) {
                for (const sub of info.subscriptions) {
                    await maxApi.deleteWebhook(sub.url);
                }
            }
        }
        res.json({ success: true });
    } catch (error) {
        logger.error({ err: error }, 'Failed to delete webhook');
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

app.get('/admin', (req, res) => {
    res.json({ message: 'Admin API' });
});

// ============ ОБРАБОТЧИКИ СОБЫТИЙ ============

async function handleBotStarted(update) {
    console.log('[HANDLER] handleBotStarted called');
    
    try {
        const chatId = update.chat_id;
        const payload = update.payload || '';
        const userId = update.user?.user_id || update.user?.id;

        console.log(`[HANDLER] Bot started: chatId=${chatId}, userId=${userId}, payload=${payload}`);
        logger.info({ chatId, userId, payload }, 'Bot started');

        if (!chatId) {
            console.log('[HANDLER] No chatId, ignoring');
            return;
        }

        const maxApi = new MaxAPI();
        
        try {
            console.log('[HANDLER] Sending welcome keyboard...');
            await maxApi.sendKeyboard({
                chatId: chatId,
                text: `👋 **Привет! Добро пожаловать в обучающий бот!**\n\nЯ помогу тебе учиться. Выбери действие:`,
                buttons: [
                    [
                        { type: 'callback', text: '📚 Курсы', payload: 'show_courses' },
                        { type: 'callback', text: '❓ Помощь', payload: 'show_help' }
                    ]
                ],
                parseMode: 'markdown',
            });
            console.log('[HANDLER] Welcome message sent');
            logger.info(`Welcome message sent to ${chatId}`);
        } catch (error) {
            console.error('[HANDLER] Error sending welcome:', error.message);
            if (error.response?.data?.code === 'dialog.not.found') {
                console.log(`[HANDLER] Dialog not found for ${chatId}, waiting for user`);
            } else {
                throw error;
            }
        }

    } catch (error) {
        console.error('[HANDLER] Error in handleBotStarted:', error);
        logger.error({ err: error, update }, 'Error handling bot_started');
    }
}

async function handleMessageCreated(update) {
    console.log('[HANDLER] handleMessageCreated called');
    
    try {
        // ПРАВИЛЬНОЕ извлечение данных из update
        const chatId = update.chat_id;
        const message = update.message;
        const text = message?.body?.text || message?.text || '';
        const userId = message?.sender?.user_id || update.user?.user_id;

        console.log(`[HANDLER] chatId: ${chatId}, userId: ${userId}, text: "${text}"`);

        if (!chatId) {
            console.log('[HANDLER] No chatId, ignoring');
            return;
        }

        if (!text) {
            console.log('[HANDLER] Empty message, ignoring');
            return;
        }

        logger.info({ chatId, userId, text: text.substring(0, 50) }, 'Message received');

        const maxApi = new MaxAPI();

        if (text.startsWith('/start')) {
            console.log('[HANDLER] Handling /start command');
            await handleStartCommand(chatId, userId, text, maxApi);
        } else if (text.startsWith('/help')) {
            console.log('[HANDLER] Handling /help command');
            await handleHelpCommand(chatId, maxApi);
        } else if (text.startsWith('/courses')) {
            console.log('[HANDLER] Handling /courses command');
            await handleCoursesCommand(chatId, maxApi);
        } else {
            console.log('[HANDLER] Handling text message');
            await handleTextMessage(chatId, userId, text, maxApi);
        }
        console.log('[HANDLER] Message handling complete');

    } catch (error) {
        console.error('[HANDLER] Error in handleMessageCreated:', error);
        logger.error({ err: error, update }, 'Error handling message_created');
    }
}

async function handleMessageCallback(update) {
    console.log('[HANDLER] handleMessageCallback called');
    
    try {
        const chatId = update.chat_id;
        const callback = update.callback;
        const payload = callback?.payload || '';
        const userId = update.user?.user_id || update.user?.id;

        console.log(`[HANDLER] Callback: chatId=${chatId}, payload=${payload}`);
        logger.info({ chatId, userId, payload }, 'Callback received');

        if (!chatId) {
            console.log('[HANDLER] No chatId, ignoring');
            return;
        }

        const maxApi = new MaxAPI();

        if (payload === 'show_courses') {
            console.log('[HANDLER] Showing courses');
            await showCourses(chatId, maxApi);
        } else if (payload === 'show_help') {
            console.log('[HANDLER] Showing help');
            await maxApi.sendMessage({
                chatId: chatId,
                text: `📚 **Помощь по боту**\n\n` +
                      `/start - Начать обучение\n` +
                      `/help - Показать это сообщение\n` +
                      `/courses - Показать список курсов\n\n` +
                      `Просто напиши мне сообщение, и я помогу!`,
                parseMode: 'markdown',
            });
        } else if (payload.startsWith('course_')) {
            const courseId = payload.replace('course_', '');
            console.log(`[HANDLER] Showing course: ${courseId}`);
            await showCourseDetails(chatId, courseId, maxApi);
        } else {
            console.log(`[HANDLER] Unknown payload: ${payload}`);
            await maxApi.sendMessage({
                chatId: chatId,
                text: `✅ Вы выбрали: ${payload}`,
                parseMode: 'markdown',
            });
        }
        console.log('[HANDLER] Callback handling complete');

    } catch (error) {
        console.error('[HANDLER] Error in handleMessageCallback:', error);
        logger.error({ err: error, update }, 'Error handling message_callback');
    }
}

// ============ КОМАНДЫ ============

async function handleStartCommand(chatId, userId, text, maxApi) {
    console.log('[COMMAND] handleStartCommand called');
    
    const payload = text.split(' ')[1] || '';
    if (payload) {
        console.log(`[COMMAND] Deep link: ${payload}`);
    }

    try {
        console.log('[COMMAND] Sending start keyboard...');
        await maxApi.sendKeyboard({
            chatId: chatId,
            text: `👋 **Добро пожаловать в обучающий бот!**\n\nЯ помогу тебе освоить новые знания. Выбери действие:`,
            buttons: [
                [
                    { type: 'callback', text: '📚 Смотреть курсы', payload: 'show_courses' },
                    { type: 'callback', text: '❓ Помощь', payload: 'show_help' },
                ]
            ],
            parseMode: 'markdown',
        });
        console.log('[COMMAND] Start keyboard sent');
    } catch (error) {
        console.error('[COMMAND] Error:', error.message);
        throw error;
    }
}

async function handleHelpCommand(chatId, maxApi) {
    console.log('[COMMAND] handleHelpCommand called');
    
    try {
        await maxApi.sendMessage({
            chatId: chatId,
            text: `📚 **Помощь по боту**\n\n` +
                  `/start - Начать обучение\n` +
                  `/help - Показать это сообщение\n` +
                  `/courses - Показать список курсов\n\n` +
                  `Просто напиши мне сообщение, и я помогу!`,
            parseMode: 'markdown',
        });
        console.log('[COMMAND] Help sent');
    } catch (error) {
        console.error('[COMMAND] Error:', error.message);
        throw error;
    }
}

async function handleCoursesCommand(chatId, maxApi) {
    console.log('[COMMAND] handleCoursesCommand called');
    await showCourses(chatId, maxApi);
}

async function showCourses(chatId, maxApi) {
    console.log('[COMMAND] showCourses called');
    
    try {
        const courseService = require('./core/course');
        const courses = await courseService.getAllCourses(true);
        console.log(`[COMMAND] Found ${courses.length} courses`);

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
        console.log('[COMMAND] Courses sent');

    } catch (error) {
        console.error('[COMMAND] Error in showCourses:', error);
        throw error;
    }
}

async function showCourseDetails(chatId, courseId, maxApi) {
    console.log(`[COMMAND] showCourseDetails: ${courseId}`);
    
    try {
        const courseService = require('./core/course');
        const course = await courseService.getCourseById(courseId);
        
        if (!course) {
            await maxApi.sendMessage({
                chatId: chatId,
                text: '❌ Курс не найден',
                parseMode: 'markdown',
            });
            return;
        }

        const lessons = await courseService.getCourseLessons(courseId);
        
        let text = `📚 **${course.title}**\n\n`;
        text += `${course.description || 'Без описания'}\n\n`;
        text += `📖 **Уроки:** ${lessons.length}\n`;
        text += `${course.price > 0 ? `💰 ${course.price} руб.` : '🆓 Бесплатно'}\n\n`;
        
        if (lessons.length > 0) {
            text += '**Уроки:**\n';
            lessons.forEach((lesson, index) => {
                text += `${index + 1}. ${lesson.title} ${lesson.is_free ? '🆓' : '🔒'}\n`;
            });
        }

        const buttons = [
            [
                { type: 'callback', text: '📚 Все курсы', payload: 'show_courses' },
                { type: 'callback', text: '❓ Помощь', payload: 'show_help' }
            ]
        ];

        await maxApi.sendKeyboard({
            chatId: chatId,
            text: text,
            buttons: buttons,
            parseMode: 'markdown',
        });
        console.log('[COMMAND] Course details sent');

    } catch (error) {
        console.error('[COMMAND] Error:', error);
        await maxApi.sendMessage({
            chatId: chatId,
            text: '❌ Ошибка при загрузке курса',
            parseMode: 'markdown',
        });
    }
}

async function handleTextMessage(chatId, userId, text, maxApi) {
    console.log('[COMMAND] handleTextMessage called');
    
    const buttons = [
        [
            { type: 'callback', text: '📚 Курсы', payload: 'show_courses' },
            { type: 'callback', text: '❓ Помощь', payload: 'show_help' },
        ]
    ];

    try {
        await maxApi.sendKeyboard({
            chatId: chatId,
            text: `📝 Я получил твое сообщение:\n\n"${text}"\n\nЧто хочешь сделать дальше?`,
            buttons: buttons,
            parseMode: 'markdown',
        });
        console.log('[COMMAND] Text response sent');
    } catch (error) {
        console.error('[COMMAND] Error:', error.message);
        throw error;
    }
}

// ============ ТЕСТОВЫЙ КУРС ============

app.post('/admin/test-course', async (req, res) => {
    console.log('[ADMIN] Creating test course...');
    try {
        const courseService = require('./core/course');
        const { title, description, price } = req.body;
        
        const course = await courseService.createCourse({
            title: title || 'Тестовый курс',
            description: description || 'Описание тестового курса',
            price: price || 0
        });
        
        const lessonService = require('./core/lesson');
        await lessonService.createLesson({
            courseId: course.id,
            title: 'Введение',
            description: 'Первый урок',
            orderNumber: 1,
            isFree: true
        });
        
        console.log(`[ADMIN] Test course created: ${course.id}`);
        res.json({ success: true, course });
    } catch (error) {
        console.error('[ADMIN] Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ============ 404 ============

app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
});

// ============ ERROR HANDLER ============

app.use((err, req, res, next) => {
    console.error('[ERROR]', err.message);
    console.error('[ERROR] Stack:', err.stack);
    res.status(500).json({ error: 'Internal server error' });
});

// ============ ЗАПУСК ============

const PORT = parseInt(process.env.PORT) || 8080;
const HOST = '0.0.0.0';

console.log(`[STARTUP] Starting on ${HOST}:${PORT}...`);

const server = app.listen(PORT, HOST, () => {
    console.log(`[STARTUP] ✅ Server running on port ${PORT}`);
    console.log(`[STARTUP] Health: http://${HOST}:${PORT}/health`);
    console.log(`[STARTUP] Root: http://${HOST}:${PORT}/`);
    console.log(`[STARTUP] Webhook URL: ${config.server.publicUrl}/webhook/max`);
    console.log(`[STARTUP] Dashboard: ${config.server.publicUrl}/dashboard`);
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
