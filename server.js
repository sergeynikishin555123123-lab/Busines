// server.js - ПОЛНАЯ ВЕРСИЯ С ИСПРАВЛЕННЫМ ФУНКЦИОНАЛОМ

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

// Подключаем WEB админ-панель
const adminRoutes = require('./admin/admin');
app.use('/admin', adminRoutes);
console.log('[STARTUP] Web Admin panel mounted at /admin');

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

// Хранилище сессий админ-панели
const adminSessions = new Map();

// ============================================================
// ФУНКЦИЯ ПРОВЕРКИ ДОСТУПА ПОЛЬЗОВАТЕЛЯ
// ============================================================

async function checkUserHasPaidAccess(userId) {
    try {
        if (!userId) return false;
        
        const userIdStr = String(userId);
        const access = database.readTable('user_course_access');
        const paidCourses = await courseService.getPaidCourses();
        
        for (const course of paidCourses) {
            const hasAccess = access.find(a => 
                String(a.user_id) === userIdStr && 
                a.course_id === course.id
            );
            if (hasAccess) return true;
        }
        
        const payments = database.readTable('payments');
        const hasPayment = payments.find(p => 
            String(p.user_id) === userIdStr && 
            p.status === 'success'
        );
        
        return !!hasPayment;
    } catch (error) {
        console.error('[ACCESS] Error checking access:', error);
        return false;
    }
}

// ============================================================
// ОБРАБОТЧИКИ СОБЫТИЙ MAX
// ============================================================

async function handleBotStarted(update) {
    console.log('[HANDLER] handleBotStarted called');
    try {
        const chatId = update.chat_id || update.message?.recipient?.chat_id;
        if (!chatId) return;

        const maxApi = new MaxAPI();
        
        const userId = update.user?.user_id || update.message?.sender?.user_id;
        const hasAccess = userId ? await checkUserHasPaidAccess(userId) : false;
        
        let text = `👋 **Привет! Я обучающий бот!**\n\n`;
        text += `Здесь вы найдете уроки по программированию.\n\n`;
        
        const buttons = [
            [{ type: 'callback', text: '📚 Уроки', payload: 'show_courses' }]
        ];
        
        if (!hasAccess) {
            buttons.push([{ type: 'callback', text: '💳 Купить доступ', payload: 'buy_access' }]);
        }
        
        buttons.push([{ type: 'callback', text: '❓ Помощь', payload: 'show_help' }]);

        await maxApi.sendKeyboard({
            chatId: chatId,
            text: text,
            buttons: buttons,
            parseMode: 'markdown',
        });
    } catch (error) {
        console.error('[HANDLER] Error in handleBotStarted:', error);
    }
}

// ============================================================
// ОБРАБОТКА СООБЩЕНИЙ С ВЛОЖЕНИЯМИ
// ============================================================

async function handleMessageCreated(update) {
    console.log('[HANDLER] handleMessageCreated called');
    
    try {
        const chatId = update.chat_id || update.message?.recipient?.chat_id;
        const message = update.message;
        const text = message?.body?.text || message?.text || '';
        const userId = message?.sender?.user_id || update.user?.user_id;
        const attachments = message?.body?.attachments || message?.attachments || [];

        console.log(`[HANDLER] chatId: ${chatId}, userId: ${userId}, text: "${text}", attachments: ${attachments.length}`);

        if (!chatId) return;

        const maxApi = new MaxAPI();

        // Обработка вложений от администратора
        if (attachments.length > 0) {
            const session = adminSessions.get(chatId);
            if (session && session.mode === 'admin') {
                await handleAdminAttachment(chatId, attachments, maxApi);
                return;
            }
        }

        // Админ-режим: ожидание пароля
        const adminSession = adminSessions.get(chatId);
        if (adminSession && adminSession.mode === 'awaiting_password') {
            await handleAdminPassword(chatId, text, maxApi);
            return;
        }

        if (adminSession && adminSession.mode === 'admin') {
            await handleAdminCommand(chatId, text, maxApi);
            return;
        }

        // Обычные команды
        if (text.startsWith('/start')) {
            await handleStartCommand(chatId, userId, text, maxApi);
        } else if (text.startsWith('/help')) {
            await handleHelpCommand(chatId, maxApi);
        } else if (text.startsWith('/courses')) {
            await handleCoursesCommand(chatId, maxApi);
        } else if (text.startsWith('/admin')) {
            await showAdminLogin(chatId, maxApi);
        } else {
            await handleTextMessage(chatId, userId, text, maxApi);
        }
    } catch (error) {
        console.error('[HANDLER] Error in handleMessageCreated:', error);
        logger.error({ err: error, update }, 'Error handling message_created');
    }
     const userId = message?.sender?.user_id || update.user?.user_id;
    const chatId = update.chat_id || message?.recipient?.chat_id;
    
    // Регистрируем пользователя
    if (userId) {
        await userService.registerUser({
            platform_user_id: String(userId),
            platform: 'max',
            first_name: message?.sender?.first_name || 'Пользователь',
            last_name: message?.sender?.last_name || '',
            username: message?.sender?.username || '',
            chat_id: String(chatId),
        });
    }
}

// server.js - ИСПРАВЛЕННЫЙ ФРАГМЕНТ
// Найдите функцию handleMessageCallback и замените блок обработки callback'ов

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

        // АДМИН-ПАНЕЛЬ CALLBACK
        if (payload === 'admin_panel') {
            await showAdminLogin(chatId, maxApi);
            return;
        }

        if (payload === 'admin_login') {
            adminSessions.set(chatId, { mode: 'awaiting_password' });
            await maxApi.sendMessage({
                chatId: chatId,
                text: `🔐 **Введите пароль администратора**\n\nОтправьте пароль сообщением.`,
                parseMode: 'markdown',
            });
            return;
        }

        const adminSession = adminSessions.get(chatId);
        if (adminSession && adminSession.mode === 'admin') {
            await handleAdminCallback(chatId, payload, maxApi);
            return;
        }

        // ============================================================
        // ПОЛЬЗОВАТЕЛЬСКИЕ КОМАНДЫ
        // ============================================================
        
        if (payload === 'show_courses') {
            await showCourses(chatId, maxApi);
        } else if (payload === 'show_help') {
            await showHelp(chatId, maxApi);
        } else if (payload === 'buy_access') {
            await handleBuyAccess(chatId, maxApi);
        } else if (payload === 'payment_confirmed') {
            await handlePaymentConfirmed(chatId, maxApi);
        } else if (payload.startsWith('course_')) {
            const courseId = payload.replace('course_', '');
            await showCourseDetails(chatId, courseId, maxApi);
        } else if (payload.startsWith('lesson_')) {
            const lessonId = payload.replace('lesson_', '');
            await sendLessonToUser(chatId, lessonId, maxApi);
            else if (payload.startsWith('payment_check_')) {
    const paymentId = payload.replace('payment_check_', '');
    await handlePaymentCheck(chatId, paymentId, maxApi);
        } else if (payload.startsWith('test_') && !payload.startsWith('test_answer_')) {
            // Показ теста
            const testId = payload.replace('test_', '');
            console.log(`[TEST] Showing test with ID: ${testId}`);
            await showTest(chatId, testId, maxApi);
        } else if (payload.startsWith('test_answer_')) {
            // ИСПРАВЛЕННЫЙ ПАРСИНГ ДЛЯ ОТВЕТОВ НА ТЕСТ
            // payload: test_answer_b720c6b3-53db-4679-8f63-e40964189f57_322a8bd8-c78a-4540-acf5-046636129851
            const withoutPrefix = payload.replace('test_answer_', '');
            const underscoreIndex = withoutPrefix.lastIndexOf('_');
            const testId = withoutPrefix.substring(0, underscoreIndex);
            const answerId = withoutPrefix.substring(underscoreIndex + 1);
            
            console.log(`[TEST] testId: ${testId}, answerId: ${answerId}`);
            await handleTestAnswer(chatId, testId, answerId, maxApi);
        } else {
            await maxApi.sendMessage({
                chatId: chatId,
                text: `✅ Вы выбрали: ${payload}`,
                parseMode: 'markdown',
            });
        }
    } catch (error) {
        console.error('[HANDLER] Error in handleMessageCallback:', error);
        logger.error({ err: error, update }, 'Error handling message_callback');
    }
}

// ============================================================
// АДМИН-ПАНЕЛЬ
// ============================================================

async function showAdminLogin(chatId, maxApi) {
    try {
        const session = adminSessions.get(chatId);
        if (session && session.mode === 'admin') {
            await showAdminDashboard(chatId, maxApi);
            return;
        }

        await maxApi.sendKeyboard({
            chatId: chatId,
            text: `🔐 **Админ-панель**\n\nВойдите для управления контентом.`,
            buttons: [
                [{ type: 'callback', text: '🔐 Войти', payload: 'admin_login' }],
                [{ type: 'callback', text: '❓ Помощь', payload: 'show_help' }]
            ],
            parseMode: 'markdown',
        });
    } catch (error) {
        console.error('[ADMIN] Error showing login:', error);
    }
}

async function handleAdminPassword(chatId, password, maxApi) {
    try {
        const admins = database.readTable('admins');
        let admin = null;

        for (const a of admins) {
            if (await bcrypt.compare(password, a.password_hash)) {
                admin = a;
                break;
            }
        }

        if (!admin) {
            adminSessions.delete(chatId);
            await maxApi.sendMessage({
                chatId: chatId,
                text: `❌ **Неверный пароль!** Попробуйте снова через /admin`,
                parseMode: 'markdown',
            });
            return;
        }

        adminSessions.set(chatId, {
            mode: 'admin',
            adminId: admin.id,
            login: admin.login,
            role: admin.role,
            context: 'dashboard'
        });

        await maxApi.sendMessage({
            chatId: chatId,
            text: `✅ **Добро пожаловать в админ-панель, ${admin.login}!**`,
            parseMode: 'markdown',
        });

        await showAdminDashboard(chatId, maxApi);

    } catch (error) {
        console.error('[ADMIN] Error handling password:', error);
        adminSessions.delete(chatId);
    }
}

// ============================================================
// ГЛАВНОЕ МЕНЮ ПОЛЬЗОВАТЕЛЯ
// ============================================================

async function handleStartCommand(chatId, userId, text, maxApi) {
    const hasAccess = userId ? await checkUserHasPaidAccess(userId) : false;
    
    let messageText = `👋 **Добро пожаловать в обучающий бот!**\n\n`;
    messageText += `Здесь вы найдете уроки по программированию.\n\n`;
    
    const buttons = [
        [{ type: 'callback', text: '📚 Уроки', payload: 'show_courses' }]
    ];
    
    if (!hasAccess) {
        buttons.push([{ type: 'callback', text: '💳 Купить доступ', payload: 'buy_access' }]);
    }
    
    buttons.push([{ type: 'callback', text: '❓ Помощь', payload: 'show_help' }]);

    await maxApi.sendKeyboard({
        chatId: chatId,
        text: messageText,
        buttons: buttons,
        parseMode: 'markdown',
    });
}

async function handleHelpCommand(chatId, maxApi) {
    await maxApi.sendMessage({
        chatId: chatId,
        text: `📚 **Помощь**\n\n/start - Главное меню\n/help - Помощь\n/courses - Уроки\n/admin - Админ-панель\n\nПросто напиши сообщение, и я помогу!`,
        parseMode: 'markdown',
    });
}

async function handleCoursesCommand(chatId, maxApi) {
    await showCourses(chatId, maxApi);
}

async function handleTextMessage(chatId, userId, text, maxApi) {
    const hasAccess = userId ? await checkUserHasPaidAccess(userId) : false;
    
    const buttons = [
        [{ type: 'callback', text: '📚 Уроки', payload: 'show_courses' }]
    ];
    
    if (!hasAccess) {
        buttons.push([{ type: 'callback', text: '💳 Купить доступ', payload: 'buy_access' }]);
    }
    
    buttons.push([{ type: 'callback', text: '❓ Помощь', payload: 'show_help' }]);

    await maxApi.sendKeyboard({
        chatId: chatId,
        text: `📝 Я получил ваше сообщение.\n\nЧто хотите сделать дальше?`,
        buttons: buttons,
        parseMode: 'markdown',
    });
}

// ============================================================
// ПОКАЗ УРОКОВ
// ============================================================

async function showCourses(chatId, maxApi) {
    try {
        const hasAccess = await checkUserHasPaidAccess(chatId);
        
        let allLessons;
        if (hasAccess) {
            allLessons = await lessonService.getAllLessons();
        } else {
            allLessons = await lessonService.getFreeLessons();
        }

        if (!allLessons || allLessons.length === 0) {
            const text = hasAccess 
                ? '📚 **Уроки**\n\nПока нет уроков. Загляните позже!'
                : '📚 **Бесплатные уроки**\n\nПока нет бесплатных уроков.\n\n💳 Купите доступ к полному курсу!';
            
            const buttons = hasAccess 
                ? [[{ type: 'callback', text: '❓ Помощь', payload: 'show_help' }]]
                : [
                    [{ type: 'callback', text: '💳 Купить доступ', payload: 'buy_access' }],
                    [{ type: 'callback', text: '❓ Помощь', payload: 'show_help' }]
                  ];
            
            await maxApi.sendKeyboard({
                chatId: chatId,
                text: text,
                buttons: buttons,
                parseMode: 'markdown',
            });
            return;
        }

        let text = hasAccess 
            ? '📚 **Все уроки**\n\n' 
            : '📚 **Бесплатные уроки**\n\n';
        
        const buttons = [];

        for (const lesson of allLessons) {
            const hasContent = lesson.files && lesson.files.length > 0;
            const icon = hasContent ? '📖' : '📝';
            const isFree = lesson.is_free ? '🆓' : '🔒';
            
            text += `${icon} **${lesson.title}** ${isFree}\n`;
            if (lesson.description) {
                text += `   ${lesson.description.substring(0, 50)}${lesson.description.length > 50 ? '...' : ''}\n`;
            }
            text += '\n';
            
            buttons.push([
                { 
                    type: 'callback', 
                    text: `${icon} ${lesson.title.substring(0, 25)}`, 
                    payload: `lesson_${lesson.id}` 
                }
            ]);
        }

        if (!hasAccess) {
            buttons.push([{ type: 'callback', text: '💳 Купить доступ', payload: 'buy_access' }]);
        }
        
        buttons.push([{ type: 'callback', text: '❓ Помощь', payload: 'show_help' }]);

        await maxApi.sendKeyboard({
            chatId: chatId,
            text: text + 'Выберите урок:',
            buttons: buttons,
            parseMode: 'markdown',
        });

    } catch (error) {
        console.error('[COMMAND] Error in showCourses:', error);
        await maxApi.sendMessage({
            chatId: chatId,
            text: '❌ Ошибка при загрузке уроков',
            parseMode: 'markdown',
        });
    }
}

async function showCourseDetails(chatId, courseId, maxApi) {
    try {
        const course = await courseService.getCourseById(courseId);
        if (!course) {
            await maxApi.sendMessage({ chatId: chatId, text: '❌ Курс не найден', parseMode: 'markdown' });
            return;
        }

        const lessons = await courseService.getCourseLessons(courseId);

        let text = `📚 **${course.title}**\n\n`;
        text += `${course.description || 'Без описания'}\n\n`;
        text += `📖 **Уроков:** ${lessons.length}\n`;
        text += `${course.price > 0 ? `💰 ${course.price} руб.` : '🆓 Бесплатно'}\n\n`;

        const buttons = [];

        if (lessons.length > 0) {
            text += '**Уроки:**\n';
            for (const lesson of lessons) {
                const hasContent = lesson.video_url || lesson.video_token;
                const icon = hasContent ? '📖' : '📝';
                text += `  ${icon} ${lesson.title} ${lesson.is_free ? '🆓' : '🔒'}\n`;
            }
            text += '\n';
            
            for (const lesson of lessons) {
                buttons.push([
                    { type: 'callback', text: `📖 ${lesson.title.substring(0, 25)}`, payload: `lesson_${lesson.id}` }
                ]);
            }
        }

        buttons.push([
            { type: 'callback', text: '📚 Все курсы', payload: 'show_courses' },
            { type: 'callback', text: '❓ Помощь', payload: 'show_help' }
        ]);

        await maxApi.sendKeyboard({
            chatId: chatId,
            text: text + 'Выберите урок:',
            buttons: buttons,
            parseMode: 'markdown',
        });

    } catch (error) {
        console.error('[COMMAND] Error in showCourseDetails:', error);
    }
}

// ============================================================
// ПОКУПКА ДОСТУПА
// ============================================================

// server.js - ДОБАВЛЕНИЕ ОБРАБОТЧИКОВ ОПЛАТЫ

// В функцию handleBuyAccess добавьте:
async function handleBuyAccess(chatId, maxApi) {
    try {
        const user = await userService.getUserByPlatformId(chatId);
        
        // Создаем платеж
        const payment = await paymentService.createPayment(
            user?.id || chatId, 
            999, 
            'RUB',
            config.payment?.defaultGateway || 'manual'
        );
        
        let text = `💳 **Купить доступ к полному курсу**\n\n` +
                   `💰 Стоимость: 999 руб.\n` +
                   `🆔 Платеж: ${payment.id}\n\n`;
        
        if (payment.payment_url) {
            text += `🔗 **Перейдите по ссылке для оплаты:**\n` +
                   `${payment.payment_url}\n\n` +
                   `После оплаты нажмите кнопку "Я оплатил(а)"`;
        } else {
            text += `Для оплаты переведите 999 руб на карту:\n` +
                   `**XXXX XXXX XXXX XXXX**\n\n` +
                   `После оплаты нажмите кнопку "Я оплатил(а)"\n` +
                   `Укажите номер платежа: ${payment.id}`;
        }
        
        await maxApi.sendKeyboard({
            chatId: chatId,
            text: text,
            buttons: [
                [{ type: 'callback', text: '✅ Я оплатил(а)', payload: `payment_check_${payment.id}` }],
                [{ type: 'callback', text: '📚 Назад к урокам', payload: 'show_courses' }]
            ],
            parseMode: 'markdown',
        });
    } catch (error) {
        console.error('[PAYMENT] Error:', error);
        await maxApi.sendMessage({
            chatId: chatId,
            text: '❌ Ошибка при оформлении покупки',
            parseMode: 'markdown',
        });
    }
}

// Обработчик проверки оплаты
async function handlePaymentCheck(chatId, paymentId, maxApi) {
    try {
        const result = await paymentService.checkPaymentStatus(paymentId);
        
        if (result.status === 'success') {
            await maxApi.sendMessage({
                chatId: chatId,
                text: `✅ **Оплата подтверждена!**\n\n` +
                      `Доступ к курсам открыт. Начинайте обучение! 📚`,
                parseMode: 'markdown',
            });
            await showCourses(chatId, maxApi);
        } else if (result.status === 'pending') {
            await maxApi.sendMessage({
                chatId: chatId,
                text: `⏳ **Платеж в обработке...**\n\n` +
                      `Пожалуйста, подождите или проверьте позже.`,
                parseMode: 'markdown',
            });
        } else if (result.status === 'failed') {
            await maxApi.sendMessage({
                chatId: chatId,
                text: `❌ **Платеж не прошел**\n\n` +
                      `Попробуйте еще раз или свяжитесь с поддержкой.`,
                parseMode: 'markdown',
            });
        } else {
            await maxApi.sendMessage({
                chatId: chatId,
                text: `❌ Платеж не найден. Попробуйте еще раз.`,
                parseMode: 'markdown',
            });
        }
    } catch (error) {
        console.error('[PAYMENT] Check error:', error);
        await maxApi.sendMessage({
            chatId: chatId,
            text: '❌ Ошибка при проверке оплаты',
            parseMode: 'markdown',
        });
    }
}


async function handlePaymentConfirmed(chatId, maxApi) {
    try {
        const payments = database.readTable('payments');
        const payment = {
            id: database.generateId(),
            user_id: String(chatId),
            amount: 999,
            currency: 'RUB',
            status: 'success',
            payment_gateway: 'manual',
            gateway_payment_id: null,
            meta_data: JSON.stringify({ confirmed_at: database.now() }),
            created_at: database.now(),
            updated_at: database.now(),
        };
        payments.push(payment);
        database.writeTable('payments', payments);
        
        const paidCourses = await courseService.getPaidCourses();
        const access = database.readTable('user_course_access');
        
        for (const course of paidCourses) {
            const exists = access.find(a => 
                String(a.user_id) === String(chatId) && 
                a.course_id === course.id
            );
            if (!exists) {
                access.push({
                    id: database.generateId(),
                    user_id: String(chatId),
                    course_id: course.id,
                    granted_at: database.now(),
                });
            }
        }
        database.writeTable('user_course_access', access);
        
        await maxApi.sendMessage({
            chatId: chatId,
            text: `✅ **Доступ открыт!**\n\nТеперь вам доступны все уроки.\n\n📚 Используйте кнопку "Уроки" чтобы начать обучение.`,
            parseMode: 'markdown',
        });
        
        await showCourses(chatId, maxApi);
        
    } catch (error) {
        console.error('[PAYMENT] Confirmation error:', error);
        await maxApi.sendMessage({
            chatId: chatId,
            text: '❌ Ошибка при подтверждении оплаты',
            parseMode: 'markdown',
        });
    }
}

// ============================================================
// ОТПРАВКА УРОКА ПОЛЬЗОВАТЕЛЮ
// ============================================================

async function sendLessonToUser(chatId, lessonId, maxApi) {
    try {
        console.log(`[LESSON] Sending lesson ${lessonId} to ${chatId}`);
        
        const lesson = await lessonService.getLessonWithFiles(lessonId);
        if (!lesson) {
            await maxApi.sendMessage({ 
                chatId: chatId, 
                text: '❌ Урок не найден', 
                parseMode: 'markdown' 
            });
            return;
        }

        // Проверяем доступ к уроку
        if (!lesson.is_free) {
            const hasAccess = await checkUserHasPaidAccess(chatId);
            if (!hasAccess) {
                await maxApi.sendKeyboard({
                    chatId: chatId,
                    text: `🔒 **Этот урок платный**\n\n"${lesson.title}" доступен только после покупки полного курса.\n\n💳 Купите доступ чтобы открыть все уроки!`,
                    buttons: [
                        [{ type: 'callback', text: '💳 Купить доступ', payload: 'buy_access' }],
                        [{ type: 'callback', text: '📚 Назад к урокам', payload: 'show_courses' }]
                    ],
                    parseMode: 'markdown',
                });
                return;
            }
        }

        console.log(`[LESSON] Lesson: ${lesson.title}, Files: ${lesson.files ? lesson.files.length : 0}`);

        const videoFile = lesson.files?.find(f => f.type === 'video');
        const otherFiles = lesson.files?.filter(f => f.type !== 'video') || [];

        // Отправляем видео
        if (videoFile) {
            try {
                if (videoFile.token) {
                    await maxApi.sendVideoByToken({
                        chatId: chatId,
                        token: videoFile.token,
                        caption: `🎬 **${lesson.title}**\n\n${lesson.description || ''}`,
                        parseMode: 'markdown',
                    });
                    console.log(`[LESSON] ✅ Video sent by token`);
                } else if (videoFile.path && fs.existsSync(videoFile.path)) {
                    console.log(`[LESSON] Uploading local video to MAX...`);
                    try {
                        const token = await maxApi.uploadFile(videoFile.path, 'video');
                        
                        await lessonService.addLessonFile(lessonId, {
                            filename: videoFile.filename,
                            originalname: videoFile.original_name || videoFile.filename,
                            size: videoFile.size || 0,
                            mimetype: videoFile.mime_type || 'video/mp4',
                            path: token,
                            url: null,
                            token: token,
                            is_max_uploaded: true,
                            type: 'video',
                        });

                        await maxApi.sendVideoByToken({
                            chatId: chatId,
                            token: token,
                            caption: `🎬 **${lesson.title}**\n\n${lesson.description || ''}`,
                            parseMode: 'markdown',
                        });
                        console.log(`[LESSON] ✅ Video uploaded and sent`);
                    } catch (uploadError) {
                        console.error('[LESSON] Failed to upload video:', uploadError.message);
                        await maxApi.sendMessage({
                            chatId: chatId,
                            text: `🎬 **${lesson.title}**\n\n${lesson.description || ''}\n\n📎 Видео: ${videoFile.url || videoFile.path}`,
                            parseMode: 'markdown',
                        });
                    }
                } else {
                    throw new Error('Video not available');
                }
            } catch (error) {
                console.error('[LESSON] Failed to send video:', error.message);
                await maxApi.sendMessage({
                    chatId: chatId,
                    text: `📖 **${lesson.title}**\n\n${lesson.description || ''}\n\n⚠️ Видео недоступно.`,
                    parseMode: 'markdown',
                });
            }
        } else {
            await maxApi.sendMessage({
                chatId: chatId,
                text: `📖 **${lesson.title}**\n\n${lesson.description || 'Нет описания'}`,
                parseMode: 'markdown',
            });
        }

        // Отправляем остальные файлы
        for (const file of otherFiles) {
            try {
                if (file.token) {
                    await maxApi.sendFileByToken({
                        chatId: chatId,
                        token: file.token,
                        caption: `📎 **${file.original_name || file.filename}**`,
                        parseMode: 'markdown',
                    });
                    console.log(`[LESSON] ✅ File sent by token: ${file.original_name || file.filename}`);
                } else if (file.path && fs.existsSync(file.path)) {
                    console.log(`[LESSON] Uploading local file to MAX: ${file.filename}`);
                    try {
                        const token = await maxApi.uploadFile(file.path, 'file');
                        
                        await lessonService.addLessonFile(lessonId, {
                            filename: file.filename,
                            originalname: file.original_name || file.filename,
                            size: file.size || 0,
                            mimetype: file.mime_type || 'application/octet-stream',
                            path: token,
                            url: null,
                            token: token,
                            is_max_uploaded: true,
                            type: 'file',
                        });

                        await maxApi.sendFileByToken({
                            chatId: chatId,
                            token: token,
                            caption: `📎 **${file.original_name || file.filename}**`,
                            parseMode: 'markdown',
                        });
                        console.log(`[LESSON] ✅ File uploaded and sent: ${file.filename}`);
                    } catch (uploadError) {
                        console.error('[LESSON] Failed to upload file:', uploadError.message);
                        await maxApi.sendMessage({
                            chatId: chatId,
                            text: `📎 **${file.original_name || file.filename}**\n${file.url || file.path}`,
                            parseMode: 'markdown',
                        });
                    }
                }
            } catch (error) {
                console.error('[LESSON] Failed to send file:', error.message);
            }
        }

        // Проверяем наличие контента
        const hasContent = videoFile || otherFiles.length > 0;

        // Тест
        const test = await lessonService.getLessonTest(lessonId);
        if (test && test.answers && test.answers.length > 0) {
            await maxApi.sendKeyboard({
                chatId: chatId,
                text: `📝 **Проверь себя!**\n\nПройти тест по уроку "${lesson.title}"`,
                buttons: [
                    [{ type: 'callback', text: '✅ Проверить себя', payload: `test_${test.id}` }],
                    [{ type: 'callback', text: '📚 Назад к урокам', payload: 'show_courses' }]
                ],
                parseMode: 'markdown',
            });
        } else if (hasContent) {
            await maxApi.sendKeyboard({
                chatId: chatId,
                text: `✅ Урок завершён!\n\nВы изучили "${lesson.title}"`,
                buttons: [
                    [{ type: 'callback', text: '📚 Назад к урокам', payload: 'show_courses' }]
                ],
                parseMode: 'markdown',
            });
        } else {
            await maxApi.sendKeyboard({
                chatId: chatId,
                text: `⚠️ **Урок "${lesson.title}" пока не содержит контента.**\n\nДобавьте видео или файлы через админ-панель.`,
                buttons: [
                    [{ type: 'callback', text: '📚 Назад к урокам', payload: 'show_courses' }]
                ],
                parseMode: 'markdown',
            });
        }

        console.log(`[LESSON] ✅ Lesson ${lessonId} sent to ${chatId}`);

    } catch (error) {
        console.error('[LESSON] Error sending lesson:', error);
        logger.error({ err: error, chatId, lessonId }, 'Failed to send lesson');
        await maxApi.sendMessage({
            chatId: chatId,
            text: '❌ Ошибка при загрузке урока.',
            parseMode: 'markdown',
        });
    }
}

// server.js - ИСПРАВЛЕННЫЕ ФУНКЦИИ showTest и handleTestAnswer

async function showTest(chatId, testId, maxApi) {
    try {
        console.log(`[TEST] showTest called with testId: ${testId}`);
        
        const test = await lessonService.getTestById(testId);
        
        if (!test) {
            console.log(`[TEST] Test not found with ID: ${testId}`);
            await maxApi.sendMessage({ 
                chatId: chatId, 
                text: '❌ Тест не найден', 
                parseMode: 'markdown' 
            });
            return;
        }

        console.log(`[TEST] Test found:`, test);

        if (!test.answers || test.answers.length === 0) {
            await maxApi.sendMessage({ 
                chatId: chatId, 
                text: '❌ У теста нет вариантов ответов', 
                parseMode: 'markdown' 
            });
            return;
        }

        const text = `📝 **${test.question || 'Проверьте знания'}**\n\nВыберите правильный ответ:`;
        const buttons = [];

        const shuffledAnswers = [...test.answers].sort(() => Math.random() - 0.5);
        
        for (const answer of shuffledAnswers) {
            buttons.push([
                { 
                    type: 'callback', 
                    text: answer.answer || 'Вариант', 
                    payload: `test_answer_${testId}_${answer.id}` 
                }
            ]);
        }
        
        buttons.push([{ 
            type: 'callback', 
            text: '⬅️ Назад к уроку', 
            payload: `lesson_${test.lesson_id}` 
        }]);

        await maxApi.sendKeyboard({
            chatId: chatId,
            text: text,
            buttons: buttons,
            parseMode: 'markdown',
        });

    } catch (error) {
        console.error('[TEST] Error showing test:', error);
        await maxApi.sendMessage({
            chatId: chatId,
            text: '❌ Ошибка при загрузке теста',
            parseMode: 'markdown',
        });
    }
}

async function handleTestAnswer(chatId, testId, answerId, maxApi) {
    try {
        console.log(`[TEST] handleTestAnswer: testId=${testId}, answerId=${answerId}`);
        
        const result = await lessonService.checkTestAnswer(testId, answerId, chatId);
        const test = await lessonService.getTestById(testId);
        const selectedAnswer = test?.answers?.find(a => a.id === answerId);

        if (result.correct) {
            await maxApi.sendMessage({
                chatId: chatId,
                text: `✅ **Правильно!** 🎉\n\nОтличная работа! Вы успешно прошли тест.`,
                parseMode: 'markdown',
            });
            await showCourses(chatId, maxApi);
        } else {
            await maxApi.sendMessage({
                chatId: chatId,
                text: `❌ **Неправильно.**\n\nВаш ответ: ${selectedAnswer?.answer || 'Неизвестно'}\nПопробуйте еще раз!`,
                parseMode: 'markdown',
            });
            await showTest(chatId, testId, maxApi);
        }

    } catch (error) {
        console.error('[TEST] Error handling answer:', error);
        await maxApi.sendMessage({
            chatId: chatId,
            text: '❌ Ошибка при проверке ответа.',
            parseMode: 'markdown',
        });
    }
}
// ============================================================
// ПОМОЩЬ
// ============================================================

async function showHelp(chatId, maxApi) {
    await maxApi.sendMessage({
        chatId: chatId,
        text: `📚 **Помощь**\n\n` +
              `/start - Главное меню\n` +
              `/help - Помощь\n` +
              `/courses - Уроки\n` +
              `/admin - Админ-панель\n\n` +
              `Просто напиши сообщение, и я помогу!`,
        parseMode: 'markdown',
    });
}

// ============================================================
// АДМИН-ПАНЕЛЬ (ДАШБОРД)
// ============================================================

async function showAdminDashboard(chatId, maxApi) {
    try {
        const session = adminSessions.get(chatId);
        if (!session || session.mode !== 'admin') {
            await showAdminLogin(chatId, maxApi);
            return;
        }

        const courses = await courseService.getAllCourses(false);
        const lessons = database.readTable('lessons');
        const users = database.readTable('users');
        const payments = database.readTable('payments');
        const paidUsers = payments.filter(p => p.status === 'success').length;

        const text = `🔐 **Админ-панель**\n\n` +
                    `👤 ${session.login}\n` +
                    `📚 Курсов: ${courses.length}\n` +
                    `📖 Уроков: ${lessons.length}\n` +
                    `👥 Пользователей: ${users.length}\n` +
                    `💳 Купили доступ: ${paidUsers}\n\n` +
                    `Выберите действие:`;

        const buttons = [
            [{ type: 'callback', text: '➕ Создать урок', payload: 'admin_create_lesson' }],
            [{ type: 'callback', text: '📝 Редактировать уроки', payload: 'admin_edit_lessons' }],
            [{ type: 'callback', text: '📊 Статистика', payload: 'admin_stats' }],
            [{ type: 'callback', text: '🚪 Выйти', payload: 'admin_logout' }]
        ];

        await maxApi.sendKeyboard({
            chatId: chatId,
            text: text,
            buttons: buttons,
            parseMode: 'markdown',
        });

    } catch (error) {
        console.error('[ADMIN] Error showing dashboard:', error);
    }
}

// ============================================================
// АДМИН-КОМАНДЫ
// ============================================================

async function handleAdminCommand(chatId, text, maxApi) {
    try {
        const session = adminSessions.get(chatId);
        if (!session) return;

        console.log(`[ADMIN] Command in admin mode: ${text}`);

        if (session.context === 'creating_course') {
            await handleAdminCourseCreate(chatId, maxApi, text);
            return;
        }

        if (session.context === 'creating_lesson') {
            await handleAdminLessonCreateStep2(chatId, text, maxApi);
            return;
        }

        if (session.context === 'creating_lesson_description') {
            await handleAdminLessonCreateStep3(chatId, text, maxApi);
            return;
        }

        if (session.context === 'editing_lesson_title') {
            await handleAdminLessonEditTitle(chatId, text, maxApi);
            return;
        }

        if (session.context === 'editing_lesson_desc') {
            await handleAdminLessonEditDesc(chatId, text, maxApi);
            return;
        }

        if (session.context === 'creating_test_question') {
            await handleAdminTestQuestion(chatId, text, maxApi);
            return;
        }

        if (session.context === 'creating_test_answers') {
            await handleAdminTestAnswers(chatId, text, maxApi);
            return;
        }

        await showAdminDashboard(chatId, maxApi);

    } catch (error) {
        console.error('[ADMIN] Error in admin command:', error);
    }
}

// ============================================================
// АДМИН-CALLBACK
// ============================================================

async function handleAdminCallback(chatId, payload, maxApi) {
    try {
        const session = adminSessions.get(chatId);
        if (!session) {
            await showAdminLogin(chatId, maxApi);
            return;
        }

        if (payload === 'admin_logout') {
            adminSessions.delete(chatId);
            await maxApi.sendMessage({ chatId: chatId, text: `🚪 Вы вышли из админ-панели.`, parseMode: 'markdown' });
            return;
        }

        if (payload === 'admin_back') {
            await showAdminDashboard(chatId, maxApi);
            return;
        }

        // Управление уроками
        if (payload === 'admin_create_lesson') {
            session.context = 'creating_lesson';
            session.courseId = null;
            await maxApi.sendMessage({
                chatId: chatId,
                text: `📝 **Создание урока**\n\nВведите название урока:`,
                parseMode: 'markdown',
            });
            return;
        }

        if (payload === 'admin_edit_lessons') {
            await handleAdminEditLessons(chatId, maxApi);
            return;
        }

        if (payload.startsWith('admin_edit_lesson_')) {
            const lessonId = payload.replace('admin_edit_lesson_', '');
            await showAdminLessonDetail(chatId, lessonId, maxApi);
            return;
        }

        if (payload.startsWith('admin_lesson_edit_title_')) {
            const lessonId = payload.replace('admin_lesson_edit_title_', '');
            session.context = 'editing_lesson_title';
            session.lessonId = lessonId;
            await maxApi.sendMessage({
                chatId: chatId,
                text: `✏️ **Изменить название урока**\n\nВведите новое название:`,
                parseMode: 'markdown',
            });
            return;
        }

        if (payload.startsWith('admin_lesson_edit_desc_')) {
            const lessonId = payload.replace('admin_lesson_edit_desc_', '');
            session.context = 'editing_lesson_desc';
            session.lessonId = lessonId;
            await maxApi.sendMessage({
                chatId: chatId,
                text: `✏️ **Изменить описание урока**\n\nВведите новое описание:`,
                parseMode: 'markdown',
            });
            return;
        }

        if (payload.startsWith('admin_lesson_toggle_free_')) {
            const lessonId = payload.replace('admin_lesson_toggle_free_', '');
            const lesson = await lessonService.getLessonById(lessonId);
            if (lesson) {
                await lessonService.updateLesson(lessonId, { isFree: !lesson.is_free });
                await showAdminLessonDetail(chatId, lessonId, maxApi);
            }
            return;
        }

        if (payload.startsWith('admin_lesson_edit_test_')) {
            const lessonId = payload.replace('admin_lesson_edit_test_', '');
            await handleAdminEditTest(chatId, lessonId, maxApi);
            return;
        }

        if (payload.startsWith('admin_lesson_video_')) {
            const lessonId = payload.replace('admin_lesson_video_', '');
            await handleAdminUploadVideo(chatId, lessonId, maxApi);
            return;
        }

        if (payload.startsWith('admin_lesson_file_')) {
            const lessonId = payload.replace('admin_lesson_file_', '');
            await handleAdminUploadFile(chatId, lessonId, maxApi);
            return;
        }

        if (payload.startsWith('admin_lesson_delete_')) {
            const lessonId = payload.replace('admin_lesson_delete_', '');
            const lesson = await lessonService.getLessonById(lessonId);
            if (lesson) {
                await maxApi.sendKeyboard({
                    chatId: chatId,
                    text: `⚠️ **Удалить урок "${lesson.title}"?**`,
                    buttons: [
                        [{ type: 'callback', text: '✅ Да', payload: `admin_lesson_delete_confirm_${lessonId}` }],
                        [{ type: 'callback', text: '❌ Нет', payload: `admin_edit_lesson_${lessonId}` }]
                    ],
                    parseMode: 'markdown',
                });
            }
            return;
        }

        if (payload.startsWith('admin_lesson_delete_confirm_')) {
            const lessonId = payload.replace('admin_lesson_delete_confirm_', '');
            await lessonService.deleteLesson(lessonId);
            await maxApi.sendMessage({ chatId: chatId, text: `🗑️ Урок удалён.`, parseMode: 'markdown' });
            await handleAdminEditLessons(chatId, maxApi);
            return;
        }

        // Статистика
        if (payload === 'admin_stats') {
            const users = database.readTable('users');
            const lessons = database.readTable('lessons');
            const courses = await courseService.getAllCourses(false);
            const payments = database.readTable('payments');
            const progress = database.readTable('progress');

            const text = `📊 **Статистика**\n\n` +
                        `👤 Пользователей: ${users.length}\n` +
                        `📚 Курсов: ${courses.length}\n` +
                        `📖 Уроков: ${lessons.length}\n` +
                        `✅ Пройдено уроков: ${progress.filter(p => p.status === 'completed').length}\n` +
                        `💳 Платежей: ${payments.filter(p => p.status === 'success').length}\n` +
                        `💰 Выручка: ${payments.filter(p => p.status === 'success').reduce((s, p) => s + (p.amount || 0), 0)} ₽`;

            await maxApi.sendKeyboard({
                chatId: chatId,
                text: text,
                buttons: [[{ type: 'callback', text: '⬅️ Назад', payload: 'admin_back' }]],
                parseMode: 'markdown',
            });
            return;
        }

        await showAdminDashboard(chatId, maxApi);

    } catch (error) {
        console.error('[ADMIN] Error in admin callback:', error);
        await maxApi.sendMessage({
            chatId: chatId,
            text: '❌ Ошибка в админ-панели',
            parseMode: 'markdown',
        });
    }
}

// ============================================================
// АДМИН: РЕДАКТИРОВАНИЕ УРОКОВ (СПИСОК)
// ============================================================

async function handleAdminEditLessons(chatId, maxApi) {
    try {
        const lessons = database.readTable('lessons');
        
        if (lessons.length === 0) {
            await maxApi.sendMessage({
                chatId: chatId,
                text: '📝 Нет уроков для редактирования',
                parseMode: 'markdown',
            });
            return;
        }
        
        let text = '📝 **Редактирование уроков**\n\nВыберите урок для редактирования:\n\n';
        const buttons = [];
        
        for (const lesson of lessons) {
            const course = await courseService.getCourseById(lesson.course_id);
            const courseTitle = course ? course.title : 'Без курса';
            const isFree = lesson.is_free ? '🆓' : '🔒';
            text += `📖 ${lesson.title} ${isFree} (${courseTitle})\n`;
            buttons.push([
                { type: 'callback', text: `✏️ ${lesson.title.substring(0, 25)}`, payload: `admin_edit_lesson_${lesson.id}` }
            ]);
        }
        
        buttons.push([{ type: 'callback', text: '⬅️ Назад', payload: 'admin_back' }]);
        
        await maxApi.sendKeyboard({
            chatId: chatId,
            text: text,
            buttons: buttons,
            parseMode: 'markdown',
        });
        
    } catch (error) {
        console.error('[ADMIN] Error showing edit lessons:', error);
    }
}

// ============================================================
// АДМИН: ДЕТАЛИ УРОКА ДЛЯ РЕДАКТИРОВАНИЯ
// ============================================================

async function showAdminLessonDetail(chatId, lessonId, maxApi) {
    try {
        const lesson = await lessonService.getLessonWithFiles(lessonId);
        if (!lesson) {
            await maxApi.sendMessage({ 
                chatId: chatId, 
                text: '❌ Урок не найден', 
                parseMode: 'markdown' 
            });
            return;
        }

        const hasVideo = lesson.files?.find(f => f.type === 'video');
        const hasFile = lesson.files?.find(f => f.type === 'file');

        let text = `📝 **Редактирование урока**\n\n`;
        text += `📖 **${lesson.title}**\n\n`;
        text += `📝 Описание: ${lesson.description || 'Нет'}\n`;
        text += `🆓 ${lesson.is_free ? 'Бесплатный' : 'Платный'}\n`;
        text += `🎬 Видео: ${hasVideo ? '✅ Есть' : '❌ Нет'}\n`;
        text += `📎 Файл: ${hasFile ? '✅ Есть' : '❌ Нет'}\n\n`;

        const buttons = [
            [{ type: 'callback', text: '✏️ Изменить название', payload: `admin_lesson_edit_title_${lessonId}` }],
            [{ type: 'callback', text: '✏️ Изменить описание', payload: `admin_lesson_edit_desc_${lessonId}` }],
            [{ type: 'callback', text: hasVideo ? '🎬 Заменить видео' : '🎬 Добавить видео', payload: `admin_lesson_video_${lessonId}` }],
            [{ type: 'callback', text: hasFile ? '📎 Заменить файл' : '📎 Добавить файл', payload: `admin_lesson_file_${lessonId}` }],
            [{ type: 'callback', text: lesson.is_free ? '🔒 Сделать платным' : '🆓 Сделать бесплатным', payload: `admin_lesson_toggle_free_${lessonId}` }],
            [{ type: 'callback', text: '📝 Редактировать тест', payload: `admin_lesson_edit_test_${lessonId}` }],
            [{ type: 'callback', text: '🗑️ Удалить урок', payload: `admin_lesson_delete_${lessonId}` }],
            [{ type: 'callback', text: '⬅️ Назад', payload: 'admin_edit_lessons' }]
        ];

        await maxApi.sendKeyboard({
            chatId: chatId,
            text: text,
            buttons: buttons,
            parseMode: 'markdown',
        });

    } catch (error) {
        console.error('[ADMIN] Error showing lesson detail:', error);
        await maxApi.sendMessage({
            chatId: chatId,
            text: `❌ Ошибка: ${error.message}`,
            parseMode: 'markdown',
        });
    }
}

// ============================================================
// АДМИН: РЕДАКТИРОВАНИЕ НАЗВАНИЯ УРОКА
// ============================================================

async function handleAdminLessonEditTitle(chatId, text, maxApi) {
    try {
        const session = adminSessions.get(chatId);
        const lessonId = session.lessonId;
        
        if (!lessonId) {
            await maxApi.sendMessage({ chatId: chatId, text: '❌ Ошибка: урок не найден', parseMode: 'markdown' });
            return;
        }
        
        await lessonService.updateLesson(lessonId, { title: text });
        session.context = 'dashboard';
        
        await maxApi.sendMessage({
            chatId: chatId,
            text: `✅ Название урока обновлено на: "${text}"`,
            parseMode: 'markdown',
        });
        
        await showAdminLessonDetail(chatId, lessonId, maxApi);
        
    } catch (error) {
        console.error('[ADMIN] Error updating lesson title:', error);
        await maxApi.sendMessage({
            chatId: chatId,
            text: `❌ Ошибка: ${error.message}`,
            parseMode: 'markdown',
        });
    }
}

// ============================================================
// АДМИН: РЕДАКТИРОВАНИЕ ОПИСАНИЯ УРОКА
// ============================================================

async function handleAdminLessonEditDesc(chatId, text, maxApi) {
    try {
        const session = adminSessions.get(chatId);
        const lessonId = session.lessonId;
        
        if (!lessonId) {
            await maxApi.sendMessage({ chatId: chatId, text: '❌ Ошибка: урок не найден', parseMode: 'markdown' });
            return;
        }
        
        await lessonService.updateLesson(lessonId, { description: text });
        session.context = 'dashboard';
        
        await maxApi.sendMessage({
            chatId: chatId,
            text: `✅ Описание урока обновлено.`,
            parseMode: 'markdown',
        });
        
        await showAdminLessonDetail(chatId, lessonId, maxApi);
        
    } catch (error) {
        console.error('[ADMIN] Error updating lesson description:', error);
        await maxApi.sendMessage({
            chatId: chatId,
            text: `❌ Ошибка: ${error.message}`,
            parseMode: 'markdown',
        });
    }
}

// ============================================================
// АДМИН: РЕДАКТИРОВАНИЕ ТЕСТА
// ============================================================

async function handleAdminEditTest(chatId, lessonId, maxApi) {
    try {
        const session = adminSessions.get(chatId);
        session.context = 'creating_test_question';
        session.lessonId = lessonId;
        session.testAnswers = [];
        
        await maxApi.sendMessage({
            chatId: chatId,
            text: `📝 **Создание теста**\n\nВведите вопрос для теста:`,
            parseMode: 'markdown',
        });
    } catch (error) {
        console.error('[ADMIN] Error editing test:', error);
        await maxApi.sendMessage({
            chatId: chatId,
            text: `❌ Ошибка: ${error.message}`,
            parseMode: 'markdown',
        });
    }
}

async function handleAdminTestQuestion(chatId, text, maxApi) {
    try {
        const session = adminSessions.get(chatId);
        session.testQuestion = text;
        session.context = 'creating_test_answers';
        session.testAnswers = [];
        session.answerIndex = 0;
        
        await maxApi.sendMessage({
            chatId: chatId,
            text: `📝 **Вопрос:** ${text}\n\nВведите вариант ответа #1 (или "готово" чтобы завершить):\n\n*Чтобы отметить правильный ответ, добавьте в конце "*"*\nНапример: "Правильный ответ*"`,
            parseMode: 'markdown',
        });
    } catch (error) {
        console.error('[ADMIN] Error in test question:', error);
        await maxApi.sendMessage({
            chatId: chatId,
            text: `❌ Ошибка: ${error.message}`,
            parseMode: 'markdown',
        });
    }
}

async function handleAdminTestAnswers(chatId, text, maxApi) {
    try {
        const session = adminSessions.get(chatId);
        
        if (text.toLowerCase() === 'готово' || text.toLowerCase() === 'done') {
            if (session.testAnswers.length < 2) {
                await maxApi.sendMessage({
                    chatId: chatId,
                    text: `⚠️ Нужно минимум 2 варианта ответа. Добавьте еще варианты.`,
                    parseMode: 'markdown',
                });
                return;
            }
            
            await lessonService.createTest(session.lessonId, {
                question: session.testQuestion,
                answers: session.testAnswers,
            });
            
            session.context = 'dashboard';
            
            await maxApi.sendMessage({
                chatId: chatId,
                text: `✅ **Тест создан!**\n\nВопрос: ${session.testQuestion}\nВариантов: ${session.testAnswers.length}`,
                parseMode: 'markdown',
            });
            
            await showAdminLessonDetail(chatId, session.lessonId, maxApi);
            return;
        }
        
        const isCorrect = text.endsWith('*');
        const answerText = isCorrect ? text.slice(0, -1).trim() : text.trim();
        
        if (!answerText) {
            await maxApi.sendMessage({
                chatId: chatId,
                text: `⚠️ Введите текст ответа.`,
                parseMode: 'markdown',
            });
            return;
        }
        
        session.testAnswers.push({
            text: answerText,
            isCorrect: isCorrect,
        });
        
        const index = session.testAnswers.length;
        const correctMark = isCorrect ? ' ✅ (правильный)' : '';
        
        await maxApi.sendMessage({
            chatId: chatId,
            text: `✅ Ответ #${index} добавлен: "${answerText}"${correctMark}\n\nВведите вариант ответа #${index + 1} (или "готово" чтобы завершить):`,
            parseMode: 'markdown',
        });
        
    } catch (error) {
        console.error('[ADMIN] Error in test answers:', error);
        await maxApi.sendMessage({
            chatId: chatId,
            text: `❌ Ошибка: ${error.message}`,
            parseMode: 'markdown',
        });
    }
}

// ============================================================
// АДМИН: СОЗДАНИЕ УРОКА (ШАГИ)
// ============================================================

async function handleAdminLessonCreateStep2(chatId, title, maxApi) {
    try {
        const session = adminSessions.get(chatId);
        if (!session) {
            await maxApi.sendMessage({ chatId: chatId, text: '❌ Сессия потеряна', parseMode: 'markdown' });
            return;
        }
        
        if (!session.courseId) {
            const courses = await courseService.getAllCourses(false);
            if (courses.length === 0) {
                const course = await courseService.createCourse({
                    title: 'Основной курс',
                    description: 'Все уроки',
                    price: 999,
                    isActive: true,
                });
                session.courseId = course.id;
            } else {
                session.courseId = courses[0].id;
            }
        }
        
        session.context = 'creating_lesson_description';
        session.lessonTitle = title;
        await maxApi.sendMessage({
            chatId: chatId,
            text: `📝 **Создание урока: "${title}"**\n\nВведите описание урока:`,
            parseMode: 'markdown',
        });
    } catch (error) {
        console.error('[ADMIN] Error in lesson create step 2:', error);
    }
}

async function handleAdminLessonCreateStep3(chatId, description, maxApi) {
    try {
        const session = adminSessions.get(chatId);
        if (!session || !session.courseId || !session.lessonTitle) {
            await maxApi.sendMessage({ 
                chatId: chatId, 
                text: '❌ Сессия потеряна', 
                parseMode: 'markdown' 
            });
            return;
        }

        const lesson = await lessonService.createLesson({
            courseId: session.courseId,
            title: session.lessonTitle,
            description: description || '',
            orderNumber: 0,
            isFree: true,
        });

        session.context = 'dashboard';
        session.lessonId = lesson.id;

        await maxApi.sendMessage({
            chatId: chatId,
            text: `✅ **Урок создан!**\n\n📖 ${lesson.title}\n\nТеперь вы можете:\n• Загрузить видео\n• Добавить файл\n• Создать тест\n• Настроить доступ (бесплатный/платный)`,
            parseMode: 'markdown',
        });

        await showAdminLessonDetail(chatId, lesson.id, maxApi);

    } catch (error) {
        console.error('[ADMIN] Error in lesson create step 3:', error);
        await maxApi.sendMessage({
            chatId: chatId,
            text: `❌ Ошибка: ${error.message}`,
            parseMode: 'markdown',
        });
    }
}

// ============================================================
// АДМИН: ЗАГРУЗКА ВИДЕО И ФАЙЛОВ
// ============================================================

async function handleAdminUploadVideo(chatId, lessonId, maxApi) {
    try {
        const session = adminSessions.get(chatId);
        if (session) {
            session.context = 'uploading_video';
            session.lessonId = lessonId;
        }

        const files = await lessonService.getLessonFiles(lessonId);
        const existingVideo = files.find(f => f.type === 'video');

        await maxApi.sendMessage({
            chatId: chatId,
            text: `🎬 **${existingVideo ? 'Заменить' : 'Загрузить'} видео**\n\n` +
                  `Отправьте видео файлом в этот чат.\n\n` +
                  `Поддерживаются: MP4, MOV, WEBM\n` +
                  `Максимальный размер: 250MB\n\n` +
                  `❗ Видео будет автоматически загружено в MAX.`,
            parseMode: 'markdown',
        });

    } catch (error) {
        console.error('[ADMIN] Error uploading video:', error);
        await maxApi.sendMessage({
            chatId: chatId,
            text: `❌ Ошибка: ${error.message}`,
            parseMode: 'markdown',
        });
    }
}

async function handleAdminUploadFile(chatId, lessonId, maxApi) {
    try {
        const session = adminSessions.get(chatId);
        if (session) {
            session.context = 'uploading_file';
            session.lessonId = lessonId;
        }

        await maxApi.sendMessage({
            chatId: chatId,
            text: `📎 **Загрузить файл**\n\n` +
                  `Отправьте файл в этот чат.\n\n` +
                  `Поддерживаются: PDF, DOCX, ZIP, изображения\n` +
                  `Максимальный размер: 250MB\n\n` +
                  `❗ Файл будет автоматически загружен в MAX.`,
            parseMode: 'markdown',
        });

    } catch (error) {
        console.error('[ADMIN] Error uploading file:', error);
        await maxApi.sendMessage({
            chatId: chatId,
            text: `❌ Ошибка: ${error.message}`,
            parseMode: 'markdown',
        });
    }
}

// ============================================================
// АДМИН: ОБРАБОТКА ВЛОЖЕНИЙ
// ============================================================

async function handleAdminAttachment(chatId, attachments, maxApi) {
    try {
        const session = adminSessions.get(chatId);
        if (!session || session.mode !== 'admin') {
            console.log('[ADMIN] Not admin session');
            return;
        }

        const lessonId = session.lessonId;
        if (!lessonId) {
            await maxApi.sendMessage({
                chatId: chatId,
                text: '❌ Не найден урок. Создайте урок заново.',
                parseMode: 'markdown',
            });
            return;
        }

        console.log(`[ADMIN] Processing ${attachments.length} attachment(s) for lesson ${lessonId}`);

        for (const attachment of attachments) {
            console.log(`[ADMIN] Attachment:`, JSON.stringify(attachment, null, 2));

            let fileType = attachment.type || 'file';
            let fileData = attachment.payload || {};
            
            let maxType = 'file';
            if (fileType === 'video' || fileType.startsWith('video/')) {
                maxType = 'video';
            } else if (fileType === 'image' || fileType.startsWith('image/')) {
                maxType = 'image';
            }

            if (fileData.token) {
                const token = fileData.token;
                const fileName = fileData.filename || 'file';
                
                console.log(`[ADMIN] File already in MAX: ${fileName}, token: ${token.substring(0, 20)}...`);

                if (maxType === 'video') {
                    const existingFiles = await lessonService.getLessonFiles(lessonId);
                    const oldVideo = existingFiles.find(f => f.type === 'video');
                    if (oldVideo) {
                        await lessonService.deleteLessonFile(oldVideo.id);
                    }
                }

                await lessonService.addLessonFile(lessonId, {
                    filename: fileName,
                    originalname: fileName,
                    size: fileData.size || 0,
                    mimetype: fileType,
                    path: token,
                    url: null,
                    token: token,
                    is_max_uploaded: true,
                    type: maxType,
                });

                await maxApi.sendMessage({
                    chatId: chatId,
                    text: `✅ **${maxType === 'video' ? 'Видео' : 'Файл'} загружен!**\n\n📎 ${fileName}`,
                    parseMode: 'markdown',
                });

                await showAdminLessonDetail(chatId, lessonId, maxApi);
                return;
            }

            if (fileData.url) {
                const fileUrl = fileData.url;
                const fileName = fileData.filename || 'file';
                
                console.log(`[ADMIN] Downloading file from URL: ${fileUrl}`);
                
                try {
                    const response = await axios.get(fileUrl, {
                        responseType: 'arraybuffer',
                        timeout: 300000,
                    });

                    const tempDir = path.join(UPLOADS_DIR, 'temp');
                    if (!fs.existsSync(tempDir)) {
                        fs.mkdirSync(tempDir, { recursive: true });
                    }
                    
                    const tempPath = path.join(tempDir, `${Date.now()}-${fileName}`);
                    fs.writeFileSync(tempPath, Buffer.from(response.data));

                    console.log(`[ADMIN] Uploading to MAX as type: ${maxType}`);
                    const token = await maxApi.uploadFile(tempPath, maxType);
                    
                    fs.unlinkSync(tempPath);

                    if (maxType === 'video') {
                        const existingFiles = await lessonService.getLessonFiles(lessonId);
                        const oldVideo = existingFiles.find(f => f.type === 'video');
                        if (oldVideo) {
                            await lessonService.deleteLessonFile(oldVideo.id);
                        }
                    }

                    await lessonService.addLessonFile(lessonId, {
                        filename: fileName,
                        originalname: fileName,
                        size: response.data.length,
                        mimetype: fileType,
                        path: token,
                        url: null,
                        token: token,
                        is_max_uploaded: true,
                        type: maxType,
                    });

                    await maxApi.sendMessage({
                        chatId: chatId,
                        text: `✅ **${maxType === 'video' ? 'Видео' : 'Файл'} загружен!**\n\n📎 ${fileName}`,
                        parseMode: 'markdown',
                    });

                    await showAdminLessonDetail(chatId, lessonId, maxApi);
                    return;

                } catch (error) {
                    console.error('[ADMIN] Error downloading/uploading file:', error.message);
                    await maxApi.sendMessage({
                        chatId: chatId,
                        text: `❌ Ошибка загрузки файла: ${error.message}`,
                        parseMode: 'markdown',
                    });
                    return;
                }
            }
        }

        await maxApi.sendMessage({
            chatId: chatId,
            text: `❌ Не удалось обработать вложение. Отправьте файл как вложение.`,
            parseMode: 'markdown',
        });

    } catch (error) {
        console.error('[ADMIN] Error handling attachment:', error);
        await maxApi.sendMessage({
            chatId: chatId,
            text: `❌ Ошибка: ${error.message}`,
            parseMode: 'markdown',
        });
    }
}

// ============================================================
// АДМИН: УПРАВЛЕНИЕ КУРСАМИ (ОСТАВЛЯЕМ ДЛЯ СОВМЕСТИМОСТИ)
// ============================================================

async function handleAdminCourses(chatId, maxApi) {
    try {
        const courses = await courseService.getAllCourses(false);
        const buttons = [];

        if (courses.length === 0) {
            buttons.push([{ type: 'callback', text: '➕ Создать курс', payload: 'admin_course_create' }]);
        } else {
            for (const course of courses) {
                const status = course.is_active !== false ? '✅' : '⛔';
                buttons.push([
                    { type: 'callback', text: `${status} ${course.title.substring(0, 25)}`, payload: `admin_course_${course.id}` }
                ]);
            }
            buttons.push([{ type: 'callback', text: '➕ Создать курс', payload: 'admin_course_create' }]);
        }

        buttons.push([{ type: 'callback', text: '⬅️ Назад', payload: 'admin_back' }]);

        await maxApi.sendKeyboard({
            chatId: chatId,
            text: `📚 **Управление курсами**\n\nВсего: ${courses.length}\n\nВыберите курс:`,
            buttons: buttons,
            parseMode: 'markdown',
        });

    } catch (error) {
        console.error('[ADMIN] Error showing courses:', error);
    }
}

async function handleAdminCourseCreate(chatId, maxApi, title = null) {
    try {
        if (!title) {
            const session = adminSessions.get(chatId);
            if (session) session.context = 'creating_course';
            await maxApi.sendMessage({
                chatId: chatId,
                text: `📝 **Создание курса**\n\nВведите название курса:`,
                parseMode: 'markdown',
            });
            return;
        }

        const course = await courseService.createCourse({
            title: title,
            description: '',
            price: 999,
            isActive: true,
        });

        await maxApi.sendMessage({
            chatId: chatId,
            text: `✅ **Курс создан!**\n\n📚 ${course.title}`,
            parseMode: 'markdown',
        });

        await showAdminCourseDetail(chatId, course.id, maxApi);

    } catch (error) {
        console.error('[ADMIN] Error creating course:', error);
        await maxApi.sendMessage({
            chatId: chatId,
            text: '❌ Ошибка создания курса',
            parseMode: 'markdown',
        });
    }
}

async function showAdminCourseDetail(chatId, courseId, maxApi) {
    try {
        const course = await courseService.getCourseById(courseId);
        if (!course) {
            await maxApi.sendMessage({ chatId: chatId, text: '❌ Курс не найден', parseMode: 'markdown' });
            return;
        }

        const lessons = await courseService.getCourseLessons(courseId);
        const status = course.is_active !== false ? '✅ Активен' : '⛔ Неактивен';

        let text = `📚 **${course.title}**\n\n`;
        text += `📖 Уроков: ${lessons.length}\n`;
        text += `💰 Цена: ${course.price > 0 ? course.price + ' ₽' : '🆓 Бесплатно'}\n`;
        text += `📊 Статус: ${status}\n\n`;

        if (lessons.length > 0) {
            text += '**Уроки:**\n';
            for (const lesson of lessons) {
                const hasVideo = lesson.video_url || lesson.video_token;
                const icon = hasVideo ? '🎬' : '📝';
                text += `${icon} ${lesson.title}\n`;
            }
            text += '\n';
        }

        const buttons = [
            [{ type: 'callback', text: '📖 Добавить урок', payload: `admin_lesson_create_${courseId}` }],
            [
                { type: 'callback', text: course.is_active !== false ? '⛔ Деактивировать' : '✅ Активировать',
                    payload: `admin_course_toggle_${courseId}` },
                { type: 'callback', text: '🗑️ Удалить курс', payload: `admin_course_delete_${courseId}` }
            ],
            [{ type: 'callback', text: '⬅️ Назад', payload: 'admin_courses' }]
        ];

        await maxApi.sendKeyboard({
            chatId: chatId,
            text: text,
            buttons: buttons,
            parseMode: 'markdown',
        });

    } catch (error) {
        console.error('[ADMIN] Error showing course detail:', error);
    }
}

// ============================================================
// РОУТЫ
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
// WEBHOOK MAX
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

// ============================================================
// 404 и ERROR HANDLER
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
// ЗАПУСК
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
