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
// ОБРАБОТЧИКИ СОБЫТИЙ MAX
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
                [{ type: 'callback', text: '📚 Все курсы', payload: 'show_courses' }],
                [{ type: 'callback', text: '🔐 Админ-панель', payload: 'admin_panel' }],
                [{ type: 'callback', text: '❓ Помощь', payload: 'show_help' }]
            ],
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
        const attachments = message?.attachments || [];

        console.log(`[HANDLER] chatId: ${chatId}, userId: ${userId}, text: "${text}", attachments: ${attachments.length}`);

        if (!chatId) return;

        const maxApi = new MaxAPI();

        // ============================================================
        // ОБРАБОТКА ВЛОЖЕНИЙ ОТ АДМИНИСТРАТОРА
        // ============================================================
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
}

// ============================================================
// ОБРАБОТКА CALLBACK
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

        // ============================================================
        // АДМИН-ПАНЕЛЬ CALLBACK
        // ============================================================
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

        // Обычные команды
        if (payload === 'show_courses') {
            await showCourses(chatId, maxApi);
        } else if (payload === 'show_help') {
            await showHelp(chatId, maxApi);
        } else if (payload.startsWith('course_')) {
            const courseId = payload.replace('course_', '');
            await showCourseDetails(chatId, courseId, maxApi);
        } else if (payload.startsWith('lesson_')) {
            const lessonId = payload.replace('lesson_', '');
            await sendLessonToUser(chatId, lessonId, maxApi);
        } else if (payload.startsWith('test_')) {
            const testId = payload.replace('test_', '');
            await showTest(chatId, testId, maxApi);
        } else if (payload.startsWith('test_answer_')) {
            const parts = payload.split('_');
            const testId = parts[2];
            const answerId = parts[3];
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

async function showAdminDashboard(chatId, maxApi) {
    try {
        const session = adminSessions.get(chatId);
        if (!session || session.mode !== 'admin') {
            await showAdminLogin(chatId, maxApi);
            return;
        }

        const courses = await courseService.getAllCourses(false);
        const lessons = database.readTable('lessons');

        const text = `🔐 **Админ-панель**\n\n` +
                    `👤 ${session.login} (${session.role})\n` +
                    `📚 Всего курсов: ${courses.length}\n` +
                    `📖 Всего уроков: ${lessons.length}\n\n` +
                    `Выберите действие:`;

        const buttons = [
            [{ type: 'callback', text: '📚 Управление курсами', payload: 'admin_courses' }],
            [{ type: 'callback', text: '📖 Управление уроками', payload: 'admin_lessons' }],
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
// УПРАВЛЕНИЕ КУРСАМИ
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
            price: 0,
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
// УПРАВЛЕНИЕ УРОКАМИ
// ============================================================

async function handleAdminLessonCreate(chatId, courseId, maxApi) {
    try {
        const session = adminSessions.get(chatId);
        if (session) {
            session.context = 'creating_lesson';
            session.courseId = courseId;
        }
        await maxApi.sendMessage({
            chatId: chatId,
            text: `📝 **Создание урока**\n\nВведите название урока:`,
            parseMode: 'markdown',
        });
    } catch (error) {
        console.error('[ADMIN] Error creating lesson:', error);
    }
}

async function handleAdminLessonCreateStep2(chatId, title, maxApi) {
    try {
        const session = adminSessions.get(chatId);
        if (!session || !session.courseId) {
            await maxApi.sendMessage({ chatId: chatId, text: '❌ Сессия потеряна', parseMode: 'markdown' });
            return;
        }
        session.context = 'creating_lesson_description';
        session.lessonTitle = title;
        await maxApi.sendMessage({
            chatId: chatId,
            text: `📝 **Создание урока: "${title}"**\n\nВведите описание:`,
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
            await maxApi.sendMessage({ chatId: chatId, text: '❌ Сессия потеряна', parseMode: 'markdown' });
            return;
        }

        const lesson = await lessonService.createLesson({
            courseId: session.courseId,
            title: session.lessonTitle,
            description: description || '',
            orderNumber: 0,
            isFree: true,
        });

        session.context = 'editing_lesson';
        session.lessonId = lesson.id;

        await maxApi.sendMessage({
            chatId: chatId,
            text: `✅ **Урок создан!**\n\n📖 ${lesson.title}\n\nТеперь загрузите видео или файл.`,
            parseMode: 'markdown',
        });

        await showAdminLessonDetail(chatId, lesson.id, maxApi);

    } catch (error) {
        console.error('[ADMIN] Error in lesson create step 3:', error);
    }
}

// ============================================================
// ОТОБРАЖЕНИЕ УРОКА В АДМИНКЕ
// ============================================================

async function showAdminLessonDetail(chatId, lessonId, maxApi) {
    try {
        const lesson = await lessonService.getLessonWithFiles(lessonId);
        if (!lesson) {
            await maxApi.sendMessage({ chatId: chatId, text: '❌ Урок не найден', parseMode: 'markdown' });
            return;
        }

        const hasVideo = lesson.files?.find(f => f.type === 'video');
        const hasFile = lesson.files?.find(f => f.type === 'file');

        let text = `📖 **${lesson.title}**\n\n`;
        text += `${lesson.description || 'Нет описания'}\n\n`;
        text += `🎬 Видео: ${hasVideo ? '✅ Загружено' : '❌ Нет'}\n`;
        text += `📎 Файл: ${hasFile ? '✅ Загружен' : '❌ Нет'}\n`;
        text += `🆓 ${lesson.is_free ? 'Бесплатный' : 'Платный'}\n\n`;

        if (hasVideo) {
            text += `🔑 Токен: ${hasVideo.token ? hasVideo.token.substring(0, 20) + '...' : 'Нет'}\n`;
        }

        const buttons = [
            [{ type: 'callback', text: '🎬 Загрузить видео', payload: `admin_lesson_video_${lessonId}` }],
            [{ type: 'callback', text: '📎 Загрузить файл', payload: `admin_lesson_file_${lessonId}` }],
            [
                { type: 'callback', text: '🗑️ Удалить урок', payload: `admin_lesson_delete_${lessonId}` }
            ],
            [{ type: 'callback', text: '⬅️ Назад к курсу', payload: `admin_course_${lesson.course_id}` }]
        ];

        await maxApi.sendKeyboard({
            chatId: chatId,
            text: text,
            buttons: buttons,
            parseMode: 'markdown',
        });

    } catch (error) {
        console.error('[ADMIN] Error showing lesson detail:', error);
    }
}

// ============================================================
// ОБРАБОТКА ВЛОЖЕНИЙ ОТ АДМИНА
// ============================================================

async function handleAdminAttachment(chatId, attachments, maxApi) {
    try {
        const session = adminSessions.get(chatId);
        if (!session || session.mode !== 'admin') {
            console.log('[ADMIN] Not admin session');
            return;
        }

        const context = session.context || '';
        const lessonId = session.lessonId;

        if (!lessonId) {
            await maxApi.sendMessage({
                chatId: chatId,
                text: '❌ Не найден урок. Откройте урок заново.',
                parseMode: 'markdown',
            });
            return;
        }

        for (const attachment of attachments) {
            console.log(`[ADMIN] Attachment type: ${attachment.type}`);

            // Если файл уже в MAX - сохраняем токен
            if (attachment.payload && attachment.payload.token) {
                const token = attachment.payload.token;
                const fileType = attachment.type || 'file';
                const fileName = attachment.payload.filename || 'file';

                console.log(`[ADMIN] File already in MAX: ${fileName}, token: ${token.substring(0, 20)}...`);

                const fileData = {
                    filename: `${token}-${Date.now()}`,
                    originalname: fileName,
                    size: attachment.payload.size || 0,
                    mimetype: fileType,
                    path: token,
                    url: token,
                    token: token,
                    is_max_uploaded: true,
                };

                await lessonService.addLessonFile(lessonId, fileData);

                await maxApi.sendMessage({
                    chatId: chatId,
                    text: `✅ **Файл загружен!**\n\n📎 ${fileName}\n🔑 Токен: ${token.substring(0, 20)}...`,
                    parseMode: 'markdown',
                });

                await showAdminLessonDetail(chatId, lessonId, maxApi);
                return;
            }

            // Если файл пришел как ссылка
            if (attachment.payload && attachment.payload.url) {
                const fileUrl = attachment.payload.url;
                const fileName = attachment.payload.filename || 'file';

                try {
                    const response = await axios.get(fileUrl, {
                        responseType: 'arraybuffer',
                        timeout: 300000,
                    });

                    const tempPath = path.join(UPLOADS_DIR, 'temp', `${Date.now()}-${fileName}`);
                    fs.writeFileSync(tempPath, Buffer.from(response.data));

                    const token = await maxApi.uploadFile(tempPath, 'file');
                    fs.unlinkSync(tempPath);

                    const fileData = {
                        filename: `${token}-${Date.now()}`,
                        originalname: fileName,
                        size: response.data.length,
                        mimetype: 'file',
                        path: token,
                        url: token,
                        token: token,
                        is_max_uploaded: true,
                    };

                    await lessonService.addLessonFile(lessonId, fileData);

                    await maxApi.sendMessage({
                        chatId: chatId,
                        text: `✅ **Файл загружен!**\n\n📎 ${fileName}\n🔑 Токен: ${token.substring(0, 20)}...`,
                        parseMode: 'markdown',
                    });

                    await showAdminLessonDetail(chatId, lessonId, maxApi);
                    return;

                } catch (error) {
                    console.error('[ADMIN] Error downloading file:', error.message);
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
// ЗАГРУЗКА ВИДЕО И ФАЙЛОВ (запрос от админа)
// ============================================================

async function handleAdminUploadVideo(chatId, lessonId, maxApi) {
    try {
        const session = adminSessions.get(chatId);
        if (session) {
            session.context = 'uploading_video';
            session.lessonId = lessonId;
        }

        await maxApi.sendMessage({
            chatId: chatId,
            text: `🎬 **Загрузка видео**\n\nОтправьте видео файлом в этот чат.\n\n` +
                  `Поддерживаются: MP4, WebM, MOV\n` +
                  `Максимальный размер: 250MB\n` +
                  `Максимальная длительность: 30 минут\n\n` +
                  `❗ Видео будет автоматически загружено в MAX.`,
            parseMode: 'markdown',
        });

    } catch (error) {
        console.error('[ADMIN] Error uploading video:', error);
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
            text: `📎 **Загрузка файла**\n\nОтправьте файл в этот чат.\n\n` +
                  `Поддерживаются: PDF, DOCX, ZIP, изображения\n` +
                  `Максимальный размер: 250MB`,
            parseMode: 'markdown',
        });

    } catch (error) {
        console.error('[ADMIN] Error uploading file:', error);
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

        // Выход
        if (payload === 'admin_logout') {
            adminSessions.delete(chatId);
            await maxApi.sendMessage({ chatId: chatId, text: `🚪 Вы вышли из админ-панели.`, parseMode: 'markdown' });
            return;
        }

        if (payload === 'admin_back') {
            await showAdminDashboard(chatId, maxApi);
            return;
        }

        // Курсы
        if (payload === 'admin_courses') {
            await handleAdminCourses(chatId, maxApi);
            return;
        }

        if (payload === 'admin_course_create') {
            await handleAdminCourseCreate(chatId, maxApi);
            return;
        }

        if (payload.startsWith('admin_course_')) {
            const courseId = payload.replace('admin_course_', '');
            if (courseId !== 'create' && courseId !== 'back') {
                await showAdminCourseDetail(chatId, courseId, maxApi);
            }
            return;
        }

        if (payload.startsWith('admin_course_toggle_')) {
            const courseId = payload.replace('admin_course_toggle_', '');
            const course = await courseService.getCourseById(courseId);
            if (course) {
                await courseService.updateCourse(courseId, { isActive: course.is_active === false });
                await showAdminCourseDetail(chatId, courseId, maxApi);
            }
            return;
        }

        if (payload.startsWith('admin_course_delete_')) {
            const courseId = payload.replace('admin_course_delete_', '');
            const confirmPayload = `admin_course_delete_confirm_${courseId}`;
            await maxApi.sendKeyboard({
                chatId: chatId,
                text: `⚠️ **Удалить курс?**`,
                buttons: [
                    [{ type: 'callback', text: '✅ Да', payload: confirmPayload }],
                    [{ type: 'callback', text: '❌ Нет', payload: `admin_course_${courseId}` }]
                ],
                parseMode: 'markdown',
            });
            return;
        }

        if (payload.startsWith('admin_course_delete_confirm_')) {
            const courseId = payload.replace('admin_course_delete_confirm_', '');
            await courseService.deleteCourse(courseId);
            await maxApi.sendMessage({ chatId: chatId, text: `🗑️ Курс удалён.`, parseMode: 'markdown' });
            await handleAdminCourses(chatId, maxApi);
            return;
        }

        // Уроки
        if (payload.startsWith('admin_lesson_create_')) {
            const courseId = payload.replace('admin_lesson_create_', '');
            await handleAdminLessonCreate(chatId, courseId, maxApi);
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
                const confirmPayload = `admin_lesson_delete_confirm_${lessonId}`;
                await maxApi.sendKeyboard({
                    chatId: chatId,
                    text: `⚠️ **Удалить урок "${lesson.title}"?**`,
                    buttons: [
                        [{ type: 'callback', text: '✅ Да', payload: confirmPayload }],
                        [{ type: 'callback', text: '❌ Нет', payload: `admin_lesson_edit_${lessonId}` }]
                    ],
                    parseMode: 'markdown',
                });
            }
            return;
        }

        if (payload.startsWith('admin_lesson_delete_confirm_')) {
            const lessonId = payload.replace('admin_lesson_delete_confirm_', '');
            const lesson = await lessonService.getLessonById(lessonId);
            const courseId = lesson ? lesson.course_id : null;
            await lessonService.deleteLesson(lessonId);
            await maxApi.sendMessage({ chatId: chatId, text: `🗑️ Урок удалён.`, parseMode: 'markdown' });
            if (courseId) {
                await showAdminCourseDetail(chatId, courseId, maxApi);
            } else {
                await handleAdminCourses(chatId, maxApi);
            }
            return;
        }

        if (payload.startsWith('admin_lesson_edit_')) {
            const lessonId = payload.replace('admin_lesson_edit_', '');
            await showAdminLessonDetail(chatId, lessonId, maxApi);
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
                        `✅ Пройдено: ${progress.filter(p => p.status === 'completed').length}\n` +
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
// ОТПРАВКА УРОКА ПОЛЬЗОВАТЕЛЮ
// ============================================================

async function sendLessonToUser(chatId, lessonId, maxApi) {
    try {
        console.log(`[LESSON] Sending lesson ${lessonId} to ${chatId}`);
        
        const lesson = await lessonService.getLessonWithFiles(lessonId);
        if (!lesson) {
            await maxApi.sendMessage({ chatId: chatId, text: '❌ Урок не найден', parseMode: 'markdown' });
            return;
        }

        console.log(`[LESSON] Lesson: ${lesson.title}, Files: ${lesson.files ? lesson.files.length : 0}`);

        // 1. Отправляем видео
        const videoFile = lesson.files?.find(f => f.type === 'video');
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
                    await maxApi.sendVideo({
                        chatId: chatId,
                        videoPath: videoFile.path,
                        caption: `🎬 **${lesson.title}**\n\n${lesson.description || ''}`,
                        parseMode: 'markdown',
                    });
                    console.log(`[LESSON] ✅ Video sent by path`);
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

        // 2. Отправляем файлы
        const otherFiles = lesson.files?.filter(f => f.type !== 'video') || [];
        for (const file of otherFiles) {
            try {
                if (file.token) {
                    await maxApi.sendFileByToken({
                        chatId: chatId,
                        token: file.token,
                        caption: `📎 **${file.original_name}**`,
                        parseMode: 'markdown',
                    });
                    console.log(`[LESSON] ✅ File sent by token: ${file.original_name}`);
                } else if (file.path && fs.existsSync(file.path)) {
                    await maxApi.sendFile({
                        chatId: chatId,
                        filePath: file.path,
                        caption: `📎 **${file.original_name}**`,
                        parseMode: 'markdown',
                    });
                    console.log(`[LESSON] ✅ File sent by path: ${file.original_name}`);
                }
            } catch (error) {
                console.error('[LESSON] Failed to send file:', error.message);
            }
        }

        // 3. Тест
        const test = await lessonService.getLessonTest(lessonId);
        if (test && test.answers && test.answers.length > 0) {
            await maxApi.sendKeyboard({
                chatId: chatId,
                text: `📝 **Готов проверить знания?**\n\nПройти тест по уроку "${lesson.title}"`,
                buttons: [
                    [{ type: 'callback', text: '✅ Проверить себя', payload: `test_${test.id}` }],
                    [{ type: 'callback', text: '📚 Назад к курсу', payload: `course_${lesson.course_id}` }]
                ],
                parseMode: 'markdown',
            });
        } else {
            await maxApi.sendKeyboard({
                chatId: chatId,
                text: `✅ Урок завершён!\n\nВы изучили "${lesson.title}"`,
                buttons: [
                    [{ type: 'callback', text: '📚 Назад к курсу', payload: `course_${lesson.course_id}` }]
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

// ============================================================
// ОСТАЛЬНЫЕ ФУНКЦИИ (КОМАНДЫ, ТЕСТЫ)
// ============================================================

async function handleStartCommand(chatId, userId, text, maxApi) {
    await maxApi.sendKeyboard({
        chatId: chatId,
        text: `👋 **Добро пожаловать!**\n\nВыберите действие:`,
        buttons: [
            [{ type: 'callback', text: '📚 Курсы', payload: 'show_courses' }],
            [{ type: 'callback', text: '❓ Помощь', payload: 'show_help' }]
        ],
        parseMode: 'markdown',
    });
}

async function handleHelpCommand(chatId, maxApi) {
    await maxApi.sendMessage({
        chatId: chatId,
        text: `📚 **Помощь**\n\n/start - Главное меню\n/help - Помощь\n/courses - Курсы\n/admin - Админ-панель`,
        parseMode: 'markdown',
    });
}

async function handleCoursesCommand(chatId, maxApi) {
    await showCourses(chatId, maxApi);
}

async function handleTextMessage(chatId, userId, text, maxApi) {
    await maxApi.sendKeyboard({
        chatId: chatId,
        text: `📝 Я получил сообщение.\n\nЧто хочешь сделать?`,
        buttons: [
            [{ type: 'callback', text: '📚 Курсы', payload: 'show_courses' }],
            [{ type: 'callback', text: '❓ Помощь', payload: 'show_help' }]
        ],
        parseMode: 'markdown',
    });
}

async function showCourses(chatId, maxApi) {
    try {
        const courses = await courseService.getAllCourses(true);
        if (courses.length === 0) {
            await maxApi.sendMessage({
                chatId: chatId,
                text: '📚 **Курсы**\n\nПока нет доступных курсов.',
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
                { type: 'callback', text: `📖 ${course.title.substring(0, 20)}`, payload: `course_${course.id}` }
            ]);
        });

        buttons.push([{ type: 'callback', text: '❓ Помощь', payload: 'show_help' }]);

        await maxApi.sendKeyboard({
            chatId: chatId,
            text: text + 'Выберите курс:',
            buttons: buttons,
            parseMode: 'markdown',
        });

    } catch (error) {
        console.error('[COMMAND] Error in showCourses:', error);
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
            lessons.forEach((lesson, index) => {
                const hasContent = lesson.video_url || lesson.video_token;
                const icon = hasContent ? '📖' : '📝';
                text += `${index + 1}. ${icon} ${lesson.title} ${lesson.is_free ? '🆓' : '🔒'}\n`;
                buttons.push([
                    { type: 'callback', text: `${icon} ${lesson.title.substring(0, 25)}`, payload: `lesson_${lesson.id}` }
                ]);
            });
            text += '\n';
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

async function showHelp(chatId, maxApi) {
    await maxApi.sendMessage({
        chatId: chatId,
        text: `📚 **Помощь**\n\n` +
              `/start - Главное меню\n` +
              `/help - Помощь\n` +
              `/courses - Курсы\n` +
              `/admin - Админ-панель\n\n` +
              `Просто напиши сообщение, и я помогу!`,
        parseMode: 'markdown',
    });
}

async function showTest(chatId, testId, maxApi) {
    try {
        const test = await lessonService.getLessonTest(testId);
        if (!test || !test.answers || test.answers.length === 0) {
            await maxApi.sendMessage({ chatId: chatId, text: '❌ Тест не найден', parseMode: 'markdown' });
            return;
        }

        const buttons = [];
        for (const answer of test.answers) {
            buttons.push([
                { type: 'callback', text: answer.answer || 'Вариант', payload: `test_answer_${testId}_${answer.id}` }
            ]);
        }
        buttons.push([{ type: 'callback', text: '📚 Назад к уроку', payload: `lesson_${test.lesson_id}` }]);

        await maxApi.sendKeyboard({
            chatId: chatId,
            text: `📝 **${test.question || 'Проверьте знания'}**\n\nВыберите ответ:`,
            buttons: buttons,
            parseMode: 'markdown',
        });

    } catch (error) {
        console.error('[TEST] Error showing test:', error);
    }
}

async function handleTestAnswer(chatId, testId, answerId, maxApi) {
    try {
        const result = await lessonService.checkTestAnswer(testId, answerId, chatId);
        const test = await lessonService.getLessonTest(testId);
        const selectedAnswer = test?.answers?.find(a => a.id === answerId);

        let text = result.correct
            ? `✅ **Правильно!** 🎉\n\nОтличная работа!`
            : `❌ **Неправильно.**\n\nВаш ответ: ${selectedAnswer?.answer || 'Неизвестно'}\nПопробуйте еще раз.`;

        await maxApi.sendKeyboard({
            chatId: chatId,
            text: text,
            buttons: [[{ type: 'callback', text: '📚 Назад к курсу', payload: `course_${test?.lesson_id || ''}` }]],
            parseMode: 'markdown',
        });

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

console.log('[STARTUP] ✅ Ready');,
