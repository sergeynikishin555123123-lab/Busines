require('dotenv').config();

const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const multer = require('multer');
const crypto = require('crypto');
const axios = require('axios');
const { Client } = require('pg');

console.log('[STARTUP] ========================================');
console.log('[STARTUP] Starting application...');
console.log('[STARTUP] NODE_ENV:', process.env.NODE_ENV);
console.log('[STARTUP] PORT:', process.env.PORT);
console.log('[STARTUP] ========================================');

// ============================================================
// ДИРЕКТОРИИ
// ============================================================

const DATA_DIR = process.env.DATA_DIR || '/app/data';
const LOG_DIR = process.env.LOG_DIR || '/app/logs';
const UPLOADS_DIR = process.env.UPLOADS_DIR || '/app/uploads';

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

// ============================================================
// КОНФИГУРАЦИЯ
// ============================================================

let config;
try {
    config = require('./config');
    console.log('[STARTUP] Config loaded');
} catch (error) {
    console.error('[STARTUP] Config error:', error.message);
    process.exit(1);
}

// ============================================================
// ЛОГГЕР
// ============================================================

let logger;
try {
    process.env.LOG_DIR = LOG_DIR;
    logger = require('./logger');
    console.log('[STARTUP] Logger loaded');
} catch (error) {
    console.error('[STARTUP] Logger error:', error.message);
    logger = { info: console.log, error: console.error, warn: console.warn, debug: console.log };
}

// ============================================================
// POSTGRESQL ПОДКЛЮЧЕНИЕ
// ============================================================

let pgClient = null;
let pgConnected = false;

async function downloadCertificate() {
    try {
        const homeDir = process.env.HOME || process.env.USERPROFILE || '';
        const certDir = path.join(homeDir, '.cloud-certs');
        const certPath = path.join(certDir, 'root.crt');
        
        if (!fs.existsSync(certDir)) {
            fs.mkdirSync(certDir, { recursive: true });
            console.log('[POSTGRES] Created certificate directory');
        }
        
        if (fs.existsSync(certPath)) {
            const stats = fs.statSync(certPath);
            if (stats.size > 0) {
                console.log('[POSTGRES] Certificate already exists');
                return certPath;
            }
        }
        
        console.log('[POSTGRES] Downloading certificate...');
        const response = await axios.get('https://st.timeweb.com/cloud-static/ca.crt', {
            responseType: 'text',
            timeout: 10000
        });
        
        fs.writeFileSync(certPath, response.data);
        console.log('[POSTGRES] ✅ Certificate downloaded');
        return certPath;
    } catch (error) {
        console.warn('[POSTGRES] ⚠️ Could not download certificate:', error.message);
        return null;
    }
}

async function connectPostgreSQL() {
    try {
        console.log('[POSTGRES] Connecting to PostgreSQL...');
        
        if (!process.env.PG_PASSWORD) {
            console.warn('[POSTGRES] ⚠️ PG_PASSWORD not set in .env');
            console.warn('[POSTGRES] ⚠️ Using JSON storage fallback');
            return null;
        }
        
        const certPath = await downloadCertificate();
        
        let sslConfig = { rejectUnauthorized: false };
        
        if (certPath && fs.existsSync(certPath)) {
            try {
                const certContent = fs.readFileSync(certPath, 'utf-8');
                if (certContent && certContent.length > 100) {
                    sslConfig = {
                        rejectUnauthorized: true,
                        ca: certContent
                    };
                    console.log('[POSTGRES] SSL configured');
                }
            } catch (e) {
                console.warn('[POSTGRES] SSL certificate read error');
            }
        }
        
        pgClient = new Client({
            user: process.env.PG_USER || 'gen_user',
            host: process.env.PG_HOST || 'f588fb3b4ee16a08f7a0a9b2.twc1.net',
            database: process.env.PG_DATABASE || 'default_db',
            password: process.env.PG_PASSWORD,
            port: parseInt(process.env.PG_PORT) || 5432,
            ssl: sslConfig,
            connectionTimeoutMillis: 10000,
        });
        
        await pgClient.connect();
        pgConnected = true;
        console.log('[POSTGRES] ✅ Connected successfully');
        
        await initPostgreSQLTables();
        return pgClient;
    } catch (error) {
        console.error('[POSTGRES] ❌ Connection error:', error.message);
        pgConnected = false;
        pgClient = null;
        console.warn('[POSTGRES] ⚠️ Falling back to JSON storage');
        return null;
    }
}

async function initPostgreSQLTables() {
    if (!pgConnected || !pgClient) return;

    try {
        console.log('[POSTGRES] Creating tables...');

        // Таблица пользователей
        await pgClient.query(`
            CREATE TABLE IF NOT EXISTS users (
                id VARCHAR(36) PRIMARY KEY,
                platform_user_id VARCHAR(255) UNIQUE NOT NULL,
                platform VARCHAR(50) NOT NULL,
                first_name VARCHAR(255),
                last_name VARCHAR(255),
                username VARCHAR(255),
                chat_id VARCHAR(255),
                email VARCHAR(255),
                phone VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Таблица администраторов
        await pgClient.query(`
            CREATE TABLE IF NOT EXISTS admins (
                id VARCHAR(36) PRIMARY KEY,
                login VARCHAR(255) UNIQUE NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                role VARCHAR(50) DEFAULT 'admin',
                platform_user_id VARCHAR(255),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Таблица курсов
        await pgClient.query(`
            CREATE TABLE IF NOT EXISTS courses (
                id VARCHAR(36) PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                price DECIMAL(10,2) DEFAULT 0,
                image_url TEXT,
                is_active BOOLEAN DEFAULT TRUE,
                order_number INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Таблица уроков
        await pgClient.query(`
            CREATE TABLE IF NOT EXISTS lessons (
                id VARCHAR(36) PRIMARY KEY,
                course_id VARCHAR(36) REFERENCES courses(id) ON DELETE CASCADE,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                video_url TEXT,
                video_token TEXT,
                order_number INTEGER DEFAULT 0,
                is_free BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 👇 ТАБЛИЦА lesson_files — С ДОБАВЛЕННЫМИ ПОЛЯМИ ДЛЯ VK
        await pgClient.query(`
            CREATE TABLE IF NOT EXISTS lesson_files (
                id VARCHAR(36) PRIMARY KEY,
                lesson_id VARCHAR(36) REFERENCES lessons(id) ON DELETE CASCADE,
                type VARCHAR(50) NOT NULL,
                filename VARCHAR(255) NOT NULL,
                original_name VARCHAR(255),
                size BIGINT DEFAULT 0,
                mime_type VARCHAR(255),
                path TEXT,
                url TEXT,
                token TEXT,
                vk_owner_id VARCHAR(50),
                vk_video_id VARCHAR(50),
                vk_access_key VARCHAR(50),
                is_max_uploaded BOOLEAN DEFAULT FALSE,
                hash TEXT,
                duration INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Таблица тестов
        await pgClient.query(`
            CREATE TABLE IF NOT EXISTS tests (
                id VARCHAR(36) PRIMARY KEY,
                lesson_id VARCHAR(36) REFERENCES lessons(id) ON DELETE CASCADE,
                question TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Таблица ответов на тесты
        await pgClient.query(`
            CREATE TABLE IF NOT EXISTS test_answers (
                id VARCHAR(36) PRIMARY KEY,
                test_id VARCHAR(36) REFERENCES tests(id) ON DELETE CASCADE,
                answer TEXT NOT NULL,
                is_correct BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Таблица прогресса
        await pgClient.query(`
            CREATE TABLE IF NOT EXISTS progress (
                id VARCHAR(36) PRIMARY KEY,
                user_id VARCHAR(36) NOT NULL,
                lesson_id VARCHAR(36) REFERENCES lessons(id) ON DELETE CASCADE,
                status VARCHAR(50) DEFAULT 'started',
                test_passed BOOLEAN DEFAULT FALSE,
                last_position INTEGER DEFAULT 0,
                completed_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, lesson_id)
            )
        `);

        // Таблица платежей
        await pgClient.query(`
            CREATE TABLE IF NOT EXISTS payments (
                id VARCHAR(36) PRIMARY KEY,
                user_id VARCHAR(36) NOT NULL,
                amount DECIMAL(10,2) NOT NULL,
                currency VARCHAR(10) DEFAULT 'RUB',
                status VARCHAR(50) DEFAULT 'pending',
                payment_gateway VARCHAR(50),
                gateway_payment_id VARCHAR(255),
                gateway_payment_url TEXT,
                meta_data JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Таблица доступа к курсам
        await pgClient.query(`
            CREATE TABLE IF NOT EXISTS user_course_access (
                id VARCHAR(36) PRIMARY KEY,
                user_id VARCHAR(36) NOT NULL,
                course_id VARCHAR(36) REFERENCES courses(id) ON DELETE CASCADE,
                granted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at TIMESTAMP,
                UNIQUE(user_id, course_id)
            )
        `);

        // Таблица просмотров уроков
        await pgClient.query(`
            CREATE TABLE IF NOT EXISTS lesson_views (
                id VARCHAR(36) PRIMARY KEY,
                user_id VARCHAR(36) NOT NULL,
                lesson_id VARCHAR(36) REFERENCES lessons(id) ON DELETE CASCADE,
                view_count INTEGER DEFAULT 1,
                first_viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                last_viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, lesson_id)
            )
        `);

        // Таблица уведомлений
        await pgClient.query(`
            CREATE TABLE IF NOT EXISTS notifications (
                id VARCHAR(36) PRIMARY KEY,
                user_id VARCHAR(36) NOT NULL,
                type VARCHAR(50) NOT NULL,
                title VARCHAR(255),
                message TEXT,
                is_read BOOLEAN DEFAULT FALSE,
                data JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Таблица сессий
        await pgClient.query(`
            CREATE TABLE IF NOT EXISTS "session" (
                sid VARCHAR(255) NOT NULL COLLATE "default",
                sess JSON NOT NULL,
                expire TIMESTAMP(6) NOT NULL,
                CONSTRAINT session_pkey PRIMARY KEY (sid)
            )
        `);
        
        await pgClient.query(`
            CREATE INDEX IF NOT EXISTS IDX_session_expire ON "session" (expire)
        `);

        // 👇 МИГРАЦИЯ: ДОБАВЛЯЕМ КОЛОНКИ, ЕСЛИ ИХ НЕТ
        console.log('[POSTGRES] Running migrations...');
        try {
            await pgClient.query(`ALTER TABLE lesson_files ADD COLUMN IF NOT EXISTS vk_owner_id VARCHAR(50)`);
            await pgClient.query(`ALTER TABLE lesson_files ADD COLUMN IF NOT EXISTS vk_video_id VARCHAR(50)`);
            await pgClient.query(`ALTER TABLE lesson_files ADD COLUMN IF NOT EXISTS vk_access_key VARCHAR(50)`);
            console.log('[POSTGRES] ✅ Migrations applied: vk_* columns added to lesson_files');
        } catch (migrationError) {
            console.warn('[POSTGRES] Migration warning:', migrationError.message);
        }

        console.log('[POSTGRES] ✅ All tables created');
    } catch (error) {
        console.error('[POSTGRES] Error creating tables:', error.message);
        throw error;
    }
}

// ============================================================
// ДАТАБАЗА (с PostgreSQL)
// ============================================================

let database;
try {
    process.env.DATA_DIR = DATA_DIR;
    database = require('./database');
    console.log('[STARTUP] Database module loaded');
} catch (error) {
    console.error('[STARTUP] Database error:', error.message);
    process.exit(1);
}

try {
    database.initDatabase();
    console.log('[STARTUP] JSON database initialized');
} catch (error) {
    console.error('[STARTUP] DB init error:', error.message);
    process.exit(1);
}

// ============================================================
// АВТОМАТИЧЕСКОЕ СОЗДАНИЕ АДМИНА
// ============================================================

async function ensureAdmin() {
    try {
        if (pgConnected && pgClient) {
            const result = await pgClient.query('SELECT * FROM admins LIMIT 1');
            if (result.rows.length === 0) {
                console.log('[STARTUP] No admin found, creating default admin...');
                const login = config.admin.defaultLogin || 'admin';
                const password = config.admin.defaultPassword || 'admin123';
                const passwordHash = await bcrypt.hash(password, 12);
                
                await pgClient.query(
                    'INSERT INTO admins (id, login, password_hash, role) VALUES ($1, $2, $3, $4)',
                    [database.generateId(), login, passwordHash, 'superadmin']
                );
                
                console.log(`[STARTUP] ✅ Admin created: ${login} / ${password}`);
            } else {
                console.log(`[STARTUP] Admin(s) already exist`);
            }
        } else {
            const admins = database.readTable('admins');
            if (admins.length === 0) {
                console.log('[STARTUP] No admin found, creating default admin...');
                const login = config.admin.defaultLogin || 'admin';
                const password = config.admin.defaultPassword || 'admin123';
                const passwordHash = await bcrypt.hash(password, 12);
                
                admins.push({
                    id: database.generateId(),
                    login: login,
                    password_hash: passwordHash,
                    role: 'superadmin',
                    platform_user_id: null,
                    created_at: database.now(),
                });
                database.writeTable('admins', admins);
                
                console.log(`[STARTUP] ✅ Admin created: ${login} / ${password}`);
            } else {
                console.log(`[STARTUP] Admin(s) already exist`);
            }
        }
    } catch (error) {
        console.error('[STARTUP] Error creating admin:', error.message);
    }
}

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

// ============================================================
// ⭐ НОВОЕ: НАСТРОЙКА СЕССИЙ ЧЕРЕЗ POSTGRESQL
// ============================================================

try {
    let sessionStore;
    
    // Если PostgreSQL подключен - используем его для сессий
    if (pgConnected && pgClient) {
        console.log('[STARTUP] Setting up PostgreSQL session store...');
        const PgSession = require('connect-pg-simple')(session);
        sessionStore = new PgSession({
            pool: pgClient,
            tableName: 'session',
            createTableIfMissing: false, // таблица уже создана
        });
        console.log('[STARTUP] PostgreSQL session store configured');
    } else {
        console.warn('[STARTUP] ⚠️ Using MemoryStore for sessions (not for production)');
        sessionStore = new session.MemoryStore();
    }

    const sessionConfig = {
        secret: config.session.secret || 'default-secret-change-me',
        resave: false,
        saveUninitialized: false,
        store: sessionStore,
        cookie: {
            maxAge: config.session.maxAge || 86400000,
            secure: process.env.NODE_ENV === 'production',
            httpOnly: true,
            sameSite: 'lax',
        },
    };
    
    app.use(session(sessionConfig));
    console.log('[STARTUP] Sessions configured successfully');
} catch (error) {
    console.error('[STARTUP] Sessions error:', error.message);
    // Продолжаем с MemoryStore как fallback
    try {
        const sessionConfig = {
            secret: config.session.secret || 'default-secret-change-me',
            resave: false,
            saveUninitialized: false,
            cookie: {
                maxAge: config.session.maxAge || 86400000,
                secure: process.env.NODE_ENV === 'production',
                httpOnly: true,
                sameSite: 'lax',
            },
        };
        app.use(session(sessionConfig));
        console.warn('[STARTUP] Using MemoryStore for sessions (fallback)');
    } catch (fallbackError) {
        console.error('[STARTUP] Sessions fallback error:', fallbackError.message);
        process.exit(1);
    }
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
// ПОДКЛЮЧЕНИЕ СЕРВИСОВ
// ============================================================

const MaxAPI = require('./platforms/max');
const courseService = require('./core/course');
const lessonService = require('./core/lesson');
const userService = require('./core/user');
const progressService = require('./core/progress');
const paymentService = require('./core/payment');

// Хранилище сессий админ-панели
const adminSessions = new Map();

// ============================================================
// ФУНКЦИЯ ПРОВЕРКИ ДОСТУПА ПОЛЬЗОВАТЕЛЯ
// ============================================================

async function checkUserHasPaidAccess(userId) {
    try {
        if (!userId) return false;
        const userIdStr = String(userId);
        
        if (pgConnected && pgClient) {
            const result = await pgClient.query(`
                SELECT EXISTS (
                    SELECT 1 FROM user_course_access uca
                    JOIN courses c ON c.id = uca.course_id
                    WHERE uca.user_id = $1 AND c.price > 0
                ) as has_access
            `, [userIdStr]);
            return result.rows[0]?.has_access || false;
        }
        
        const access = await database.readTable('user_course_access');
        const paidCourses = await courseService.getPaidCourses();
        
        for (const course of paidCourses) {
            const hasAccess = access.find(a =>
                String(a.user_id) === userIdStr &&
                a.course_id === course.id
            );
            if (hasAccess) return true;
        }
        
        const payments = await database.readTable('payments');
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
        
        if (userId) {
            try {
                await userService.registerUser({
                    platform_user_id: String(userId),
                    platform: 'max',
                    first_name: message?.sender?.first_name || 'Пользователь',
                    last_name: message?.sender?.last_name || '',
                    username: message?.sender?.username || '',
                    chat_id: String(chatId),
                });
            } catch (regError) {
                console.warn('[USER] Registration error:', regError.message);
            }
        }
        
        const maxApi = new MaxAPI();
        
        if (attachments.length > 0) {
            const session = adminSessions.get(chatId);
            if (session && session.mode === 'admin') {
                await handleAdminAttachment(chatId, attachments, maxApi);
                return;
            }
        }
        
        const adminSession = adminSessions.get(chatId);
        if (adminSession && adminSession.mode === 'awaiting_password') {
            await handleAdminPassword(chatId, text, maxApi);
            return;
        }
        
        if (adminSession && adminSession.mode === 'admin') {
            await handleAdminCommand(chatId, text, maxApi);
            return;
        }
        
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
        
        if (payload === 'show_courses') {
            await showCourses(chatId, maxApi);
        } else if (payload === 'show_help') {
            await showHelp(chatId, maxApi);
        } else if (payload === 'buy_access') {
            await handleBuyAccess(chatId, maxApi);
        } else if (payload.startsWith('payment_check_')) {
            const paymentId = payload.replace('payment_check_', '');
            await handlePaymentCheck(chatId, paymentId, maxApi);
        } else if (payload.startsWith('lesson_')) {
            const lessonId = payload.replace('lesson_', '');
            await sendLessonToUser(chatId, lessonId, maxApi);
        } else if (payload.startsWith('test_') && !payload.startsWith('test_answer_')) {
            const testId = payload.replace('test_', '');
            await showTest(chatId, testId, maxApi);
        } else if (payload.startsWith('test_answer_')) {
            const withoutPrefix = payload.replace('test_answer_', '');
            const underscoreIndex = withoutPrefix.lastIndexOf('_');
            const testId = withoutPrefix.substring(0, underscoreIndex);
            const answerId = withoutPrefix.substring(underscoreIndex + 1);
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
// VK МОДУЛЬ
// ============================================================

// server.js - Убедитесь, что этот блок существует и корректен

const vkModule = require('./platforms/vk');

// Передаем общие функции в VK модуль
vkModule.setSharedFunctions({
    checkUserHasPaidAccess,
    showAdminLogin,
    showCourses,
    sendLessonToUser,
    showTest,
    handleTestAnswer,
    handleBuyAccess,
    handlePaymentCheck,
    handleAdminCommand,
    handleAdminCallback,
    handleAdminAttachment,
    // 👇 ОБЯЗАТЕЛЬНО ДОБАВЬТЕ ЭТИ ФУНКЦИИ
    showAdminDashboard,
    showAdminLessonDetail,
    handleAdminEditLessons,
    handleAdminLessonCreateStep2,
    handleAdminLessonCreateStep3,
    handleAdminLessonEditTitle,
    handleAdminLessonEditDesc,
    handleAdminEditTest,
    handleAdminTestQuestion,
    handleAdminTestAnswers,
    handleAdminUploadVideo,
    handleAdminUploadFile,
    adminSessions,
});

// ============================================================
// ОБЩИЕ КОМАНДЫ
// ============================================================

async function showAdminLogin(chatId, api) {
    try {
        const session = adminSessions.get(chatId);
        if (session && session.mode === 'admin') {
            await showAdminDashboard(chatId, api);
            return;
        }
        
        await api.sendKeyboard({
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

async function handleAdminPassword(chatId, password, api) {
    try {
        let admin = null;
        
        if (pgConnected && pgClient) {
            const result = await pgClient.query('SELECT * FROM admins');
            for (const a of result.rows) {
                if (await bcrypt.compare(password, a.password_hash)) {
                    admin = a;
                    break;
                }
            }
        } else {
            const admins = database.readTable('admins');
            for (const a of admins) {
                if (await bcrypt.compare(password, a.password_hash)) {
                    admin = a;
                    break;
                }
            }
        }
        
        if (!admin) {
            adminSessions.delete(chatId);
            await api.sendMessage({
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
        
        await api.sendMessage({
            chatId: chatId,
            text: `✅ **Добро пожаловать в админ-панель, ${admin.login}!**`,
            parseMode: 'markdown',
        });
        
        await showAdminDashboard(chatId, api);
    } catch (error) {
        console.error('[ADMIN] Error handling password:', error);
        adminSessions.delete(chatId);
    }
}

async function showAdminDashboard(chatId, api) {
    try {
        const session = adminSessions.get(chatId);
        if (!session || session.mode !== 'admin') {
            await showAdminLogin(chatId, api);
            return;
        }
        
        let courses = [], lessons = [], users = [], payments = [], paidUsers = 0;
        
        if (pgConnected && pgClient) {
            const coursesRes = await pgClient.query('SELECT * FROM courses');
            courses = coursesRes.rows;
            const lessonsRes = await pgClient.query('SELECT * FROM lessons');
            lessons = lessonsRes.rows;
            const usersRes = await pgClient.query('SELECT * FROM users');
            users = usersRes.rows;
            const paymentsRes = await pgClient.query('SELECT * FROM payments WHERE status = $1', ['success']);
            payments = paymentsRes.rows;
            paidUsers = payments.length;
        } else {
            courses = await courseService.getAllCourses(false);
            lessons = database.readTable('lessons');
            users = database.readTable('users');
            payments = database.readTable('payments');
            paidUsers = payments.filter(p => p.status === 'success').length;
        }
        
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
        
        await api.sendKeyboard({
            chatId: chatId,
            text: text,
            buttons: buttons,
            parseMode: 'markdown',
        });
    } catch (error) {
        console.error('[ADMIN] Error showing dashboard:', error);
    }
}

async function handleStartCommand(chatId, userId, text, api) {
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
    
    await api.sendKeyboard({
        chatId: chatId,
        text: messageText,
        buttons: buttons,
        parseMode: 'markdown',
    });
}

async function handleHelpCommand(chatId, api) {
    await api.sendMessage({
        chatId: chatId,
        text: `📚 **Помощь**\n\n/start - Главное меню\n/help - Помощь\n/courses - Уроки\n/admin - Админ-панель\n\nПросто напиши сообщение, и я помогу!`,
        parseMode: 'markdown',
    });
}

async function handleCoursesCommand(chatId, api) {
    await showCourses(chatId, api);
}

async function handleTextMessage(chatId, userId, text, api) {
    const hasAccess = userId ? await checkUserHasPaidAccess(userId) : false;
    
    const buttons = [
        [{ type: 'callback', text: '📚 Уроки', payload: 'show_courses' }]
    ];
    
    if (!hasAccess) {
        buttons.push([{ type: 'callback', text: '💳 Купить доступ', payload: 'buy_access' }]);
    }
    buttons.push([{ type: 'callback', text: '❓ Помощь', payload: 'show_help' }]);
    
    await api.sendKeyboard({
        chatId: chatId,
        text: `📝 Я получил ваше сообщение.\n\nЧто хотите сделать дальше?`,
        buttons: buttons,
        parseMode: 'markdown',
    });
}

async function showCourses(chatId, api) {
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
            
            await api.sendKeyboard({
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
                text += ` ${lesson.description.substring(0, 50)}${lesson.description.length > 50 ? '...' : ''}\n`;
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
        
        await api.sendKeyboard({
            chatId: chatId,
            text: text + 'Выберите урок:',
            buttons: buttons,
            parseMode: 'markdown',
        });
    } catch (error) {
        console.error('[COMMAND] Error in showCourses:', error);
        await api.sendMessage({
            chatId: chatId,
            text: '❌ Ошибка при загрузке уроков',
            parseMode: 'markdown',
        });
    }
}

async function sendLessonToUser(chatId, lessonId, api) {
    try {
        console.log(`[LESSON] Sending lesson ${lessonId} to ${chatId}`);
        
        const lesson = await lessonService.getLessonWithFiles(lessonId);
        if (!lesson) {
            await api.sendMessage({
                chatId: chatId,
                text: '❌ Урок не найден',
                parseMode: 'markdown'
            });
            return;
        }
        
        if (!lesson.is_free) {
            const hasAccess = await checkUserHasPaidAccess(chatId);
            if (!hasAccess) {
                await api.sendKeyboard({
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
        
        const videoFile = lesson.files?.find(f => f.type === 'video');
        const otherFiles = lesson.files?.filter(f => f.type !== 'video') || [];
        
        // 👇 ОПРЕДЕЛЯЕМ ПЛАТФОРМУ
        const isVK = api.constructor.name === 'VKAPI' || typeof api.sendVideoByToken !== 'function';
        
        // ============================================================
        // 1. ОТПРАВЛЯЕМ ОПИСАНИЕ УРОКА
        // ============================================================
        if (!videoFile) {
            await api.sendMessage({
                chatId: chatId,
                text: `📖 **${lesson.title}**\n\n${lesson.description || 'Нет описания'}`,
                parseMode: 'markdown',
            });
        }

        // ============================================================
        // 2. ОТПРАВЛЯЕМ ВИДЕО
        // ============================================================
        if (videoFile) {
            try {
                if (isVK) {
                    // ДЛЯ VK — используем VK ID видео
                    const ownerId = videoFile.vk_owner_id;
                    const videoId = videoFile.vk_video_id;
                    const accessKey = videoFile.vk_access_key;
                    
                    if (ownerId && videoId) {
                        const attachment = accessKey 
                            ? `video${ownerId}_${videoId}_${accessKey}`
                            : `video${ownerId}_${videoId}`;
                        
                        await api.sendMessage({
                            chatId: chatId,
                            text: `🎬 **${lesson.title}**\n\n${lesson.description || ''}`,
                            attachments: [attachment],
                            parseMode: 'markdown',
                        });
                        console.log(`[LESSON] ✅ Video sent to VK: ${attachment}`);
                    } else {
                        // Если нет VK ID — пробуем загрузить сейчас
                        console.log(`[LESSON] No VK ID, attempting to upload to VK...`);
                        
                        try {
                            if (videoFile.token) {
                                // Скачиваем видео из MAX
                                const downloadUrl = `${config.max.baseUrl}/files/${videoFile.token}`;
                                const response = await axios.get(downloadUrl, {
                                    responseType: 'arraybuffer',
                                    timeout: 300000,
                                    headers: { 'Authorization': config.max.token }
                                });
                                
                                const tempDir = path.join(UPLOADS_DIR, 'temp');
                                if (!fs.existsSync(tempDir)) {
                                    fs.mkdirSync(tempDir, { recursive: true });
                                }
                                
                                const tempPath = path.join(tempDir, `${Date.now()}-video.mp4`);
                                fs.writeFileSync(tempPath, Buffer.from(response.data));
                                
                                // Загружаем в VK
                                const vkApi = new VKAPI();
                                const vkResult = await vkApi.uploadPrivateVideo(tempPath, lesson.title);
                                
                                // Сохраняем VK ID в БД
                                await lessonService.addLessonFile(lesson.id, {
                                    filename: videoFile.filename,
                                    originalname: videoFile.originalname,
                                    size: videoFile.size,
                                    mimetype: videoFile.mimetype,
                                    path: videoFile.path,
                                    token: videoFile.token,
                                    vk_owner_id: vkResult.owner_id,
                                    vk_video_id: vkResult.video_id,
                                    vk_access_key: vkResult.access_key,
                                    is_max_uploaded: true,
                                    type: 'video',
                                });
                                
                                fs.unlinkSync(tempPath);
                                
                                const attachment = vkResult.access_key 
                                    ? `video${vkResult.owner_id}_${vkResult.video_id}_${vkResult.access_key}`
                                    : `video${vkResult.owner_id}_${vkResult.video_id}`;
                                
                                await api.sendMessage({
                                    chatId: chatId,
                                    text: `🎬 **${lesson.title}**\n\n${lesson.description || ''}`,
                                    attachments: [attachment],
                                    parseMode: 'markdown',
                                });
                                console.log(`[LESSON] ✅ Video uploaded and sent to VK`);
                            } else {
                                await api.sendMessage({
                                    chatId: chatId,
                                    text: `📖 **${lesson.title}**\n\n${lesson.description || ''}\n\n⚠️ Видео недоступно в VK.`,
                                    parseMode: 'markdown',
                                });
                            }
                        } catch (uploadError) {
                            console.error('[LESSON] Failed to upload video to VK:', uploadError.message);
                            await api.sendMessage({
                                chatId: chatId,
                                text: `📖 **${lesson.title}**\n\n${lesson.description || ''}\n\n⚠️ Видео недоступно в VK.`,
                                parseMode: 'markdown',
                            });
                        }
                    }
                } else {
                    // ДЛЯ MAX — ОТПРАВЛЯЕМ ПО ТОКЕНУ
                    if (videoFile.token && api.sendVideoByToken) {
                        await api.sendVideoByToken({
                            chatId: chatId,
                            token: videoFile.token,
                            caption: `🎬 **${lesson.title}**\n\n${lesson.description || ''}`,
                            parseMode: 'markdown',
                        });
                        console.log(`[LESSON] ✅ Video sent to MAX by token`);
                    } else if (videoFile.path && fs.existsSync(videoFile.path)) {
                        const maxApi = new MaxAPI();
                        const token = await maxApi.uploadFile(videoFile.path, 'video');
                        await api.sendVideoByToken({
                            chatId: chatId,
                            token: token,
                            caption: `🎬 **${lesson.title}**\n\n${lesson.description || ''}`,
                            parseMode: 'markdown',
                        });
                        console.log(`[LESSON] ✅ Video uploaded and sent to MAX`);
                    } else {
                        await api.sendMessage({
                            chatId: chatId,
                            text: `📖 **${lesson.title}**\n\n${lesson.description || ''}\n\n⚠️ Видео недоступно.`,
                            parseMode: 'markdown',
                        });
                    }
                }
            } catch (error) {
                console.error('[LESSON] Failed to send video:', error.message);
                await api.sendMessage({
                    chatId: chatId,
                    text: `📖 **${lesson.title}**\n\n${lesson.description || ''}\n\n⚠️ Видео недоступно.`,
                    parseMode: 'markdown',
                });
            }
        }
        
        // ============================================================
        // 3. ОТПРАВЛЯЕМ ФАЙЛЫ
        // ============================================================
        for (const file of otherFiles) {
            try {
                if (isVK) {
                    // Для VK — ссылка на файл
                    const fileUrl = file.url || file.path || '';
                    if (fileUrl) {
                        await api.sendMessage({
                            chatId: chatId,
                            text: `📎 **${file.original_name || file.filename}**\n${fileUrl}`,
                            parseMode: 'markdown',
                        });
                    }
                } else {
                    // Для MAX — по токену
                    if (file.token && api.sendFileByToken) {
                        await api.sendFileByToken({
                            chatId: chatId,
                            token: file.token,
                            caption: `📎 **${file.original_name || file.filename}**`,
                            parseMode: 'markdown',
                        });
                    } else if (file.path && fs.existsSync(file.path)) {
                        const maxApi = new MaxAPI();
                        const token = await maxApi.uploadFile(file.path, 'file');
                        await api.sendFileByToken({
                            chatId: chatId,
                            token: token,
                            caption: `📎 **${file.original_name || file.filename}**`,
                            parseMode: 'markdown',
                        });
                    }
                }
                console.log(`[LESSON] ✅ File sent: ${file.original_name || file.filename}`);
            } catch (error) {
                console.error('[LESSON] Failed to send file:', error.message);
            }
        }
        
        // ============================================================
        // 4. ОТПРАВЛЯЕМ ТЕСТ
        // ============================================================
        const test = await lessonService.getLessonTest(lessonId);
        if (test && test.answers && test.answers.length > 0) {
            await api.sendKeyboard({
                chatId: chatId,
                text: `📝 **Проверь себя!**\n\nПройти тест по уроку "${lesson.title}"`,
                buttons: [
                    [{ type: 'callback', text: '✅ Проверить себя', payload: `test_${test.id}` }],
                    [{ type: 'callback', text: '📚 Назад к урокам', payload: 'show_courses' }]
                ],
                parseMode: 'markdown',
            });
        } else {
            await api.sendKeyboard({
                chatId: chatId,
                text: `✅ Урок завершён!\n\nВы изучили "${lesson.title}"`,
                buttons: [
                    [{ type: 'callback', text: '📚 Назад к урокам', payload: 'show_courses' }]
                ],
                parseMode: 'markdown',
            });
        }
        
        console.log(`[LESSON] ✅ Lesson ${lessonId} sent to ${chatId}`);
    } catch (error) {
        console.error('[LESSON] Error sending lesson:', error);
        await api.sendMessage({
            chatId: chatId,
            text: '❌ Ошибка при загрузке урока.',
            parseMode: 'markdown',
        });
    }
}
async function showTest(chatId, testId, api) {
    try {
        console.log(`[TEST] showTest called with testId: ${testId}`);
        
        const test = await lessonService.getTestById(testId);
        if (!test) {
            await api.sendMessage({
                chatId: chatId,
                text: '❌ Тест не найден',
                parseMode: 'markdown'
            });
            return;
        }
        
        if (!test.answers || test.answers.length === 0) {
            await api.sendMessage({
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
        
        await api.sendKeyboard({
            chatId: chatId,
            text: text,
            buttons: buttons,
            parseMode: 'markdown',
        });
    } catch (error) {
        console.error('[TEST] Error showing test:', error);
        await api.sendMessage({
            chatId: chatId,
            text: '❌ Ошибка при загрузке теста',
            parseMode: 'markdown',
        });
    }
}

async function handleTestAnswer(chatId, testId, answerId, api) {
    try {
        console.log(`[TEST] handleTestAnswer: testId=${testId}, answerId=${answerId}`);
        
        const result = await lessonService.checkTestAnswer(testId, answerId, chatId);
        const test = await lessonService.getTestById(testId);
        const selectedAnswer = test?.answers?.find(a => a.id === answerId);
        
        if (result.correct) {
            await api.sendMessage({
                chatId: chatId,
                text: `✅ **Правильно!** 🎉\n\nОтличная работа! Вы успешно прошли тест.`,
                parseMode: 'markdown',
            });
            await showCourses(chatId, api);
        } else {
            await api.sendMessage({
                chatId: chatId,
                text: `❌ **Неправильно.**\n\nВаш ответ: ${selectedAnswer?.answer || 'Неизвестно'}\nПопробуйте еще раз!`,
                parseMode: 'markdown',
            });
            await showTest(chatId, testId, api);
        }
    } catch (error) {
        console.error('[TEST] Error handling answer:', error);
        await api.sendMessage({
            chatId: chatId,
            text: '❌ Ошибка при проверке ответа.',
            parseMode: 'markdown',
        });
    }
}

async function handleBuyAccess(chatId, api) {
    try {
        const user = await userService.getUserByPlatformId(chatId);
        
        const payment = await paymentService.createPayment(
            user?.id || chatId,
            999,
            'RUB',
            'manual'
        );
        
        let text = `💳 **Купить доступ к полному курсу**\n\n` +
            `💰 Стоимость: 999 руб.\n` +
            `🆔 Платеж: ${payment.id}\n\n` +
            `Для оплаты переведите 999 руб на карту:\n` +
            `**XXXX XXXX XXXX XXXX**\n\n` +
            `После оплаты нажмите кнопку "Я оплатил(а)"\n` +
            `Укажите номер платежа: ${payment.id}`;
        
        await api.sendKeyboard({
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
        await api.sendMessage({
            chatId: chatId,
            text: '❌ Ошибка при оформлении покупки',
            parseMode: 'markdown',
        });
    }
}

async function handlePaymentCheck(chatId, paymentId, api) {
    try {
        const result = await paymentService.checkPaymentStatus(paymentId);
        
        if (result.status === 'success') {
            await api.sendMessage({
                chatId: chatId,
                text: `✅ **Оплата подтверждена!**\n\nДоступ к курсам открыт. Начинайте обучение! 📚`,
                parseMode: 'markdown',
            });
            await showCourses(chatId, api);
        } else if (result.status === 'pending') {
            await api.sendMessage({
                chatId: chatId,
                text: `⏳ **Платеж в обработке...**\n\nПожалуйста, подождите или проверьте позже.`,
                parseMode: 'markdown',
            });
        } else {
            await api.sendMessage({
                chatId: chatId,
                text: `❌ **Платеж не прошел**\n\nПопробуйте еще раз или свяжитесь с поддержкой.`,
                parseMode: 'markdown',
            });
        }
    } catch (error) {
        console.error('[PAYMENT] Check error:', error);
        await api.sendMessage({
            chatId: chatId,
            text: '❌ Ошибка при проверке оплаты',
            parseMode: 'markdown',
        });
    }
}

async function showHelp(chatId, api) {
    await api.sendMessage({
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
// АДМИН-КОМАНДЫ
// ============================================================

async function handleAdminCommand(chatId, text, api) {
    try {
        const session = adminSessions.get(chatId);
        if (!session) return;
        
        console.log(`[ADMIN] Command in admin mode: ${text}`);
        
        if (session.context === 'creating_lesson') {
            await handleAdminLessonCreateStep2(chatId, text, api);
            return;
        }
        
        if (session.context === 'creating_lesson_description') {
            await handleAdminLessonCreateStep3(chatId, text, api);
            return;
        }
        
        if (session.context === 'editing_lesson_title') {
            await handleAdminLessonEditTitle(chatId, text, api);
            return;
        }
        
        if (session.context === 'editing_lesson_desc') {
            await handleAdminLessonEditDesc(chatId, text, api);
            return;
        }
        
        if (session.context === 'creating_test_question') {
            await handleAdminTestQuestion(chatId, text, api);
            return;
        }
        
        if (session.context === 'creating_test_answers') {
            await handleAdminTestAnswers(chatId, text, api);
            return;
        }
        
        await showAdminDashboard(chatId, api);
    } catch (error) {
        console.error('[ADMIN] Error in admin command:', error);
    }
}

async function handleAdminCallback(chatId, payload, api) {
    try {
        const session = adminSessions.get(chatId);
        if (!session) {
            await showAdminLogin(chatId, api);
            return;
        }
        
        if (payload === 'admin_logout') {
            adminSessions.delete(chatId);
            await api.sendMessage({ chatId: chatId, text: `🚪 Вы вышли из админ-панели.`, parseMode: 'markdown' });
            return;
        }
        
       if (payload === 'admin_back') {
    // Очищаем контекст если был
    const session = adminSessions.get(chatId);
    if (session) {
        session.context = 'dashboard';
        session.lessonId = null;
        session.courseId = null;
    }
    await showAdminDashboard(chatId, api);
    return;
}
        
        if (payload === 'admin_create_lesson') {
            session.context = 'creating_lesson';
            session.courseId = null;
            await api.sendMessage({
                chatId: chatId,
                text: `📝 **Создание урока**\n\nВведите название урока:`,
                parseMode: 'markdown',
            });
            return;
        }
        
        if (payload === 'admin_edit_lessons') {
    await handleAdminEditLessons(chatId, api);
    return;
}
        
        if (payload.startsWith('admin_edit_lesson_')) {
            const lessonId = payload.replace('admin_edit_lesson_', '');
            await showAdminLessonDetail(chatId, lessonId, api);
            return;
        }
        
        if (payload.startsWith('admin_lesson_edit_title_')) {
            const lessonId = payload.replace('admin_lesson_edit_title_', '');
            session.context = 'editing_lesson_title';
            session.lessonId = lessonId;
            await api.sendMessage({
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
            await api.sendMessage({
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
                await showAdminLessonDetail(chatId, lessonId, api);
            }
            return;
        }
        
        if (payload.startsWith('admin_lesson_edit_test_')) {
            const lessonId = payload.replace('admin_lesson_edit_test_', '');
            await handleAdminEditTest(chatId, lessonId, api);
            return;
        }
        
        if (payload.startsWith('admin_lesson_video_')) {
            const lessonId = payload.replace('admin_lesson_video_', '');
            await handleAdminUploadVideo(chatId, lessonId, api);
            return;
        }
        
        if (payload.startsWith('admin_lesson_file_')) {
            const lessonId = payload.replace('admin_lesson_file_', '');
            await handleAdminUploadFile(chatId, lessonId, api);
            return;
        }
        
        if (payload.startsWith('admin_lesson_delete_')) {
            const lessonId = payload.replace('admin_lesson_delete_', '');
            const lesson = await lessonService.getLessonById(lessonId);
            if (lesson) {
                await api.sendKeyboard({
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
            await api.sendMessage({ chatId: chatId, text: `🗑️ Урок удалён.`, parseMode: 'markdown' });
            await handleAdminEditLessons(chatId, api);
            return;
        }
        
        if (payload === 'admin_stats') {
            let users = [], lessons = [], courses = [], payments = [], progress = [];
            
            if (pgConnected && pgClient) {
                const usersRes = await pgClient.query('SELECT * FROM users');
                users = usersRes.rows;
                const lessonsRes = await pgClient.query('SELECT * FROM lessons');
                lessons = lessonsRes.rows;
                const coursesRes = await pgClient.query('SELECT * FROM courses');
                courses = coursesRes.rows;
                const paymentsRes = await pgClient.query('SELECT * FROM payments WHERE status = $1', ['success']);
                payments = paymentsRes.rows;
                const progressRes = await pgClient.query('SELECT * FROM progress WHERE status = $1', ['completed']);
                progress = progressRes.rows;
            } else {
                users = database.readTable('users');
                lessons = database.readTable('lessons');
                courses = await courseService.getAllCourses(false);
                payments = database.readTable('payments').filter(p => p.status === 'success');
                progress = database.readTable('progress').filter(p => p.status === 'completed');
            }
            
            const text = `📊 **Статистика**\n\n` +
                `👤 Пользователей: ${users.length}\n` +
                `📚 Курсов: ${courses.length}\n` +
                `📖 Уроков: ${lessons.length}\n` +
                `✅ Пройдено уроков: ${progress.length}\n` +
                `💳 Платежей: ${payments.length}\n` +
                `💰 Выручка: ${payments.reduce((s, p) => s + (p.amount || 0), 0)} ₽`;
            
            await api.sendKeyboard({
                chatId: chatId,
                text: text,
                buttons: [[{ type: 'callback', text: '⬅️ Назад', payload: 'admin_back' }]],
                parseMode: 'markdown',
            });
            return;
        }
        
        await showAdminDashboard(chatId, api);
    } catch (error) {
        console.error('[ADMIN] Error in admin callback:', error);
        await api.sendMessage({
            chatId: chatId,
            text: '❌ Ошибка в админ-панели',
            parseMode: 'markdown',
        });
    }
}

async function handleAdminEditLessons(chatId, api) {
    try {
        let lessons = await database.readTable('lessons');
        
        // Проверяем что lessons - массив
        if (!Array.isArray(lessons)) {
            console.log('[ADMIN] Lessons is not an array, reinitializing...');
            // Если не массив - создаем новый
            await database.writeTable('lessons', []);
            lessons = [];
        }
        
        if (lessons.length === 0) {
            await api.sendMessage({
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
                {
                    type: 'callback',
                    text: `✏️ ${lesson.title.substring(0, 25)}`,
                    payload: `admin_edit_lesson_${lesson.id}`
                }
            ]);
        }
        
        buttons.push([{ type: 'callback', text: '⬅️ Назад', payload: 'admin_back' }]);
        
        await api.sendKeyboard({
            chatId: chatId,
            text: text,
            buttons: buttons,
            parseMode: 'markdown',
        });
    } catch (error) {
        console.error('[ADMIN] Error showing edit lessons:', error);
        await api.sendMessage({
            chatId: chatId,
            text: `❌ Ошибка: ${error.message}`,
            parseMode: 'markdown',
        });
    }
}

async function showAdminLessonDetail(chatId, lessonId, api) {
    try {
        const lesson = await lessonService.getLessonWithFiles(lessonId);
        if (!lesson) {
            await api.sendMessage({
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
        
        await api.sendKeyboard({
            chatId: chatId,
            text: text,
            buttons: buttons,
            parseMode: 'markdown',
        });
    } catch (error) {
        console.error('[ADMIN] Error showing lesson detail:', error);
        await api.sendMessage({
            chatId: chatId,
            text: `❌ Ошибка: ${error.message}`,
            parseMode: 'markdown',
        });
    }
}

async function handleAdminLessonCreateStep2(chatId, title, api) {
    try {
        const session = adminSessions.get(chatId);
        if (!session) {
            await api.sendMessage({ chatId: chatId, text: '❌ Сессия потеряна', parseMode: 'markdown' });
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
        
        await api.sendMessage({
            chatId: chatId,
            text: `📝 **Создание урока: "${title}"**\n\nВведите описание урока:`,
            parseMode: 'markdown',
        });
    } catch (error) {
        console.error('[ADMIN] Error in lesson create step 2:', error);
    }
}

async function handleAdminLessonCreateStep3(chatId, description, api) {
    try {
        const session = adminSessions.get(chatId);
        if (!session || !session.courseId || !session.lessonTitle) {
            await api.sendMessage({
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
        
        await api.sendMessage({
            chatId: chatId,
            text: `✅ **Урок создан!**\n\n📖 ${lesson.title}\n\nТеперь вы можете:\n• Загрузить видео\n• Добавить файл\n• Создать тест\n• Настроить доступ (бесплатный/платный)`,
            parseMode: 'markdown',
        });
        
        await showAdminLessonDetail(chatId, lesson.id, api);
    } catch (error) {
        console.error('[ADMIN] Error in lesson create step 3:', error);
        await api.sendMessage({
            chatId: chatId,
            text: `❌ Ошибка: ${error.message}`,
            parseMode: 'markdown',
        });
    }
}

async function handleAdminLessonEditTitle(chatId, text, api) {
    try {
        const session = adminSessions.get(chatId);
        const lessonId = session.lessonId;
        
        if (!lessonId) {
            await api.sendMessage({ chatId: chatId, text: '❌ Ошибка: урок не найден', parseMode: 'markdown' });
            return;
        }
        
        await lessonService.updateLesson(lessonId, { title: text });
        session.context = 'dashboard';
        
        await api.sendMessage({
            chatId: chatId,
            text: `✅ Название урока обновлено на: "${text}"`,
            parseMode: 'markdown',
        });
        
        await showAdminLessonDetail(chatId, lessonId, api);
    } catch (error) {
        console.error('[ADMIN] Error updating lesson title:', error);
        await api.sendMessage({
            chatId: chatId,
            text: `❌ Ошибка: ${error.message}`,
            parseMode: 'markdown',
        });
    }
}

async function handleAdminLessonEditDesc(chatId, text, api) {
    try {
        const session = adminSessions.get(chatId);
        const lessonId = session.lessonId;
        
        if (!lessonId) {
            await api.sendMessage({ chatId: chatId, text: '❌ Ошибка: урок не найден', parseMode: 'markdown' });
            return;
        }
        
        await lessonService.updateLesson(lessonId, { description: text });
        session.context = 'dashboard';
        
        await api.sendMessage({
            chatId: chatId,
            text: `✅ Описание урока обновлено.`,
            parseMode: 'markdown',
        });
        
        await showAdminLessonDetail(chatId, lessonId, api);
    } catch (error) {
        console.error('[ADMIN] Error updating lesson description:', error);
        await api.sendMessage({
            chatId: chatId,
            text: `❌ Ошибка: ${error.message}`,
            parseMode: 'markdown',
        });
    }
}

async function handleAdminEditTest(chatId, lessonId, api) {
    try {
        const session = adminSessions.get(chatId);
        session.context = 'creating_test_question';
        session.lessonId = lessonId;
        session.testAnswers = [];
        
        await api.sendMessage({
            chatId: chatId,
            text: `📝 **Создание теста**\n\nВведите вопрос для теста:`,
            parseMode: 'markdown',
        });
    } catch (error) {
        console.error('[ADMIN] Error editing test:', error);
        await api.sendMessage({
            chatId: chatId,
            text: `❌ Ошибка: ${error.message}`,
            parseMode: 'markdown',
        });
    }
}

async function handleAdminTestQuestion(chatId, text, api) {
    try {
        const session = adminSessions.get(chatId);
        session.testQuestion = text;
        session.context = 'creating_test_answers';
        session.testAnswers = [];
        session.answerIndex = 0;
        
        await api.sendMessage({
            chatId: chatId,
            text: `📝 **Вопрос:** ${text}\n\nВведите вариант ответа #1 (или "готово" чтобы завершить):\n\n*Чтобы отметить правильный ответ, добавьте в конце "*"*\nНапример: "Правильный ответ*"`,
            parseMode: 'markdown',
        });
    } catch (error) {
        console.error('[ADMIN] Error in test question:', error);
        await api.sendMessage({
            chatId: chatId,
            text: `❌ Ошибка: ${error.message}`,
            parseMode: 'markdown',
        });
    }
}

async function handleAdminTestAnswers(chatId, text, api) {
    try {
        const session = adminSessions.get(chatId);
        
        if (text.toLowerCase() === 'готово' || text.toLowerCase() === 'done') {
            if (session.testAnswers.length < 2) {
                await api.sendMessage({
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
            
            await api.sendMessage({
                chatId: chatId,
                text: `✅ **Тест создан!**\n\nВопрос: ${session.testQuestion}\nВариантов: ${session.testAnswers.length}`,
                parseMode: 'markdown',
            });
            
            await showAdminLessonDetail(chatId, session.lessonId, api);
            return;
        }
        
        const isCorrect = text.endsWith('*');
        const answerText = isCorrect ? text.slice(0, -1).trim() : text.trim();
        
        if (!answerText) {
            await api.sendMessage({
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
        
        await api.sendMessage({
            chatId: chatId,
            text: `✅ Ответ #${index} добавлен: "${answerText}"${correctMark}\n\nВведите вариант ответа #${index + 1} (или "готово" чтобы завершить):`,
            parseMode: 'markdown',
        });
    } catch (error) {
        console.error('[ADMIN] Error in test answers:', error);
        await api.sendMessage({
            chatId: chatId,
            text: `❌ Ошибка: ${error.message}`,
            parseMode: 'markdown',
        });
    }
}

async function handleAdminUploadVideo(chatId, lessonId, api) {
    try {
        const session = adminSessions.get(chatId);
        if (session) {
            session.context = 'uploading_video';
            session.lessonId = lessonId;
        }
        
        const files = await lessonService.getLessonFiles(lessonId);
        const existingVideo = files.find(f => f.type === 'video');
        
        await api.sendMessage({
            chatId: chatId,
            text: `🎬 **${existingVideo ? 'Заменить' : 'Загрузить'} видео**\n\nОтправьте видео файлом в этот чат.\n\nПоддерживаются: MP4, MOV, WEBM\nМаксимальный размер: 250MB\n\n❗ Видео будет автоматически загружено.`,
            parseMode: 'markdown',
        });
    } catch (error) {
        console.error('[ADMIN] Error uploading video:', error);
        await api.sendMessage({
            chatId: chatId,
            text: `❌ Ошибка: ${error.message}`,
            parseMode: 'markdown',
        });
    }
}

async function handleAdminUploadFile(chatId, lessonId, api) {
    try {
        const session = adminSessions.get(chatId);
        if (session) {
            session.context = 'uploading_file';
            session.lessonId = lessonId;
        }
        
        await api.sendMessage({
            chatId: chatId,
            text: `📎 **Загрузить файл**\n\nОтправьте файл в этот чат.\n\nПоддерживаются: PDF, DOCX, ZIP, изображения\nМаксимальный размер: 250MB\n\n❗ Файл будет автоматически загружен.`,
            parseMode: 'markdown',
        });
    } catch (error) {
        console.error('[ADMIN] Error uploading file:', error);
        await api.sendMessage({
            chatId: chatId,
            text: `❌ Ошибка: ${error.message}`,
            parseMode: 'markdown',
        });
    }
}

// server.js - ЗАМЕНИТЬ ФУНКЦИЮ handleAdminAttachment

async function handleAdminAttachment(chatId, attachments, api) {
    try {
        const session = adminSessions.get(chatId);
        if (!session || session.mode !== 'admin') {
            console.log('[ADMIN] Not admin session');
            return;
        }
        
        const lessonId = session.lessonId;
        if (!lessonId) {
            await api.sendMessage({
                chatId: chatId,
                text: '❌ Не найден урок. Создайте урок заново.',
                parseMode: 'markdown',
            });
            return;
        }
        
        console.log(`[ADMIN] Processing ${attachments.length} attachment(s) for lesson ${lessonId}`);
        
        // 👇 ОПРЕДЕЛЯЕМ ПЛАТФОРМУ
        const isVK = api.constructor.name === 'VKAPI' || typeof api.sendVideoByToken !== 'function';
        
        for (const attachment of attachments) {
            console.log('[ADMIN] Attachment:', JSON.stringify(attachment, null, 2));
            
            let fileType = attachment.type || 'file';
            let fileData = attachment.payload || {};
            let maxType = 'file';
            
            if (fileType === 'video' || fileType.startsWith('video/')) {
                maxType = 'video';
            } else if (fileType === 'image' || fileType.startsWith('image/')) {
                maxType = 'image';
            }
            
            // Если файл уже загружен в MAX (есть токен)
            if (fileData.token) {
                const token = fileData.token;
                const fileName = fileData.filename || 'file';
                
                console.log(`[ADMIN] File already uploaded, token: ${token.substring(0, 20)}...`);
                
                let vkVideo = null;
                
                // 👇 ЕСЛИ ЭТО VK И ВИДЕО — ЗАГРУЖАЕМ В VK
                if (isVK && maxType === 'video') {
                    try {
                        // Пытаемся скачать видео из MAX по токену
                        const videoUrl = fileData.url || '';
                        if (videoUrl) {
                            const response = await axios.get(videoUrl, {
                                responseType: 'arraybuffer',
                                timeout: 300000,
                            });
                            
                            const tempDir = path.join(UPLOADS_DIR, 'temp');
                            if (!fs.existsSync(tempDir)) {
                                fs.mkdirSync(tempDir, { recursive: true });
                            }
                            
                            const tempPath = path.join(tempDir, `${Date.now()}-${fileName}`);
                            fs.writeFileSync(tempPath, Buffer.from(response.data));
                            
                            // Загружаем в VK
                            const vkApi = new VKAPI();
                            vkVideo = await vkApi.uploadPrivateVideo(tempPath, 'Урок');
                            
                            // Удаляем временный файл
                            fs.unlinkSync(tempPath);
                            
                            console.log(`[ADMIN] ✅ VK video uploaded: video${vkVideo.owner_id}_${vkVideo.video_id}`);
                        } else {
                            console.log('[ADMIN] No video URL to download for VK');
                        }
                    } catch (error) {
                        console.error('[ADMIN] Failed to upload to VK:', error.message);
                    }
                }
                
                // Сохраняем в БД
                const fileDataToSave = {
                    filename: fileName,
                    originalname: fileName,
                    size: fileData.size || 0,
                    mimetype: fileType,
                    path: token,
                    url: fileData.url || null,
                    token: token,
                    vk_owner_id: vkVideo?.owner_id || null,
                    vk_video_id: vkVideo?.video_id || null,
                    vk_access_key: vkVideo?.access_key || null,
                    is_max_uploaded: true,
                    type: maxType,
                };
                
                await lessonService.addLessonFile(lessonId, fileDataToSave);
                
                let messageText = `✅ **${maxType === 'video' ? 'Видео' : 'Файл'} загружен!**\n\n📎 ${fileName}`;
                if (vkVideo) {
                    messageText += `\n\n📹 Также загружено в VK`;
                }
                
                await api.sendMessage({
                    chatId: chatId,
                    text: messageText,
                    parseMode: 'markdown',
                });
                
                await showAdminLessonDetail(chatId, lessonId, api);
                return;
            }
            
            // Если файл пришел как URL (скачиваем)
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
                    
                    let token = null;
                    let vkVideo = null;
                    
                    // Загружаем в MAX
                    const maxApi = new MaxAPI();
                    token = await maxApi.uploadFile(tempPath, maxType);
                    
                    // 👇 ЕСЛИ ЭТО VK И ВИДЕО — ЗАГРУЖАЕМ В VK
                    if (isVK && maxType === 'video') {
                        try {
                            const vkApi = new VKAPI();
                            vkVideo = await vkApi.uploadPrivateVideo(tempPath, 'Урок');
                            console.log(`[ADMIN] ✅ VK video uploaded: video${vkVideo.owner_id}_${vkVideo.video_id}`);
                        } catch (vkError) {
                            console.error('[ADMIN] VK upload failed:', vkError.message);
                        }
                    }
                    
                    fs.unlinkSync(tempPath);
                    
                    // Сохраняем в БД
                    const fileDataToSave = {
                        filename: fileName,
                        originalname: fileName,
                        size: response.data.length,
                        mimetype: fileType,
                        path: token,
                        url: null,
                        token: token,
                        vk_owner_id: vkVideo?.owner_id || null,
                        vk_video_id: vkVideo?.video_id || null,
                        vk_access_key: vkVideo?.access_key || null,
                        is_max_uploaded: true,
                        type: maxType,
                    };
                    
                    await lessonService.addLessonFile(lessonId, fileDataToSave);
                    
                    let messageText = `✅ **${maxType === 'video' ? 'Видео' : 'Файл'} загружен!**\n\n📎 ${fileName}`;
                    if (vkVideo) {
                        messageText += `\n\n📹 Также загружено в VK`;
                    }
                    
                    await api.sendMessage({
                        chatId: chatId,
                        text: messageText,
                        parseMode: 'markdown',
                    });
                    
                    await showAdminLessonDetail(chatId, lessonId, api);
                    return;
                    
                } catch (error) {
                    console.error('[ADMIN] Error downloading/uploading file:', error.message);
                    await api.sendMessage({
                        chatId: chatId,
                        text: `❌ Ошибка загрузки файла: ${error.message}`,
                        parseMode: 'markdown',
                    });
                    return;
                }
            }
        }
        
        await api.sendMessage({
            chatId: chatId,
            text: `❌ Не удалось обработать вложение. Отправьте файл как вложение.`,
            parseMode: 'markdown',
        });
    } catch (error) {
        console.error('[ADMIN] Error handling attachment:', error);
        await api.sendMessage({
            chatId: chatId,
            text: `❌ Ошибка: ${error.message}`,
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
        databases: {
            postgresql: pgConnected ? 'connected' : 'fallback (JSON)',
            json: 'available',
        },
        directories: { data: DATA_DIR, logs: LOG_DIR, uploads: UPLOADS_DIR },
    });
});

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(), 
        uptime: process.uptime(),
        postgresql: pgConnected,
    });
});

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
// MAX WEBHOOK
// ============================================================

app.post('/webhook/max', async (req, res) => {
    console.log('[MAX WEBHOOK] ========== WEBHOOK RECEIVED ==========');
    try {
        const webhookSecret = config.max.webhookSecret;
        if (webhookSecret) {
            const received = req.headers['x-max-bot-api-secret'];
            if (!received || received !== webhookSecret) {
                console.warn('[MAX WEBHOOK] Invalid secret!');
                return res.status(401).send('Unauthorized');
            }
        }
        
        res.status(200).send('ok');
        console.log('[MAX WEBHOOK] Sent 200 OK');
        
        setImmediate(async () => {
            try {
                const update = req.body;
                console.log('[MAX WEBHOOK] Processing update type:', update.update_type);
                
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
                        console.log(`[MAX WEBHOOK] Bot added to chat: ${update.chat_id}`);
                        break;
                    case 'bot_removed':
                        console.log(`[MAX WEBHOOK] Bot removed from chat: ${update.chat_id}`);
                        break;
                    default:
                        console.log(`[MAX WEBHOOK] Unhandled update type: ${update.update_type}`);
                }
                console.log('[MAX WEBHOOK] Processing complete');
            } catch (error) {
                console.error('[MAX WEBHOOK] Error processing:', error);
                logger.error({ err: error, update: req.body }, 'Error processing webhook');
            }
        });
    } catch (error) {
        console.error('[MAX WEBHOOK] Fatal error:', error);
        res.status(500).send('Internal server error');
    }
});

// ============================================================
// VK WEBHOOK
// ============================================================

app.post('/webhook/vk', async (req, res) => {
    console.log('[VK WEBHOOK] ========== WEBHOOK RECEIVED ==========');
    try {
        const { type, secret, object, group_id } = req.body;
        
        console.log('[VK WEBHOOK] Type:', type);
        console.log('[VK WEBHOOK] Group ID:', group_id);
        
        //if (config.vk.secret && secret !== config.vk.secret) {
            //console.warn('[VK WEBHOOK] Invalid secret');
           // return res.status(403).send('Invalid secret');
       // }
        
        switch (type) {
            case 'confirmation':
                console.log('[VK WEBHOOK] Confirmation request');
                return res.send(config.vk.confirmationToken || '642837b1');
            
            case 'message_new':
                res.send('ok');
                setImmediate(async () => {
                    try {
                        await vkModule.handleMessageNew(object);
                    } catch (error) {
                        console.error('[VK WEBHOOK] Error processing message:', error);
                    }
                });
                return;
            
            case 'message_event':
                res.send('ok');
                setImmediate(async () => {
                    try {
                        await vkModule.handleMessageEvent(object);
                    } catch (error) {
                        console.error('[VK WEBHOOK] Error processing event:', error);
                    }
                });
                return;
            
            default:
                console.log(`[VK WEBHOOK] Unhandled type: ${type}`);
                return res.send('ok');
        }
    } catch (error) {
        console.error('[VK WEBHOOK] Error:', error);
        return res.send('ok');
    }
});

// ============================================================
// АДМИН РОУТЫ
// ============================================================

app.post('/admin/register-max-webhook', async (req, res) => {
    try {
        const maxApi = new MaxAPI();
        const webhookUrl = `${config.server.publicUrl}/webhook/max`;
        const result = await maxApi.registerWebhook(webhookUrl);
        res.json({ success: true, result, webhookUrl });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/admin/max-webhook-info', async (req, res) => {
    try {
        const maxApi = new MaxAPI();
        const info = await maxApi.getWebhookInfo();
        res.json(info);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/admin/max-webhook', async (req, res) => {
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

app.post('/admin/register-vk-webhook', async (req, res) => {
    try {
        const webhookUrl = `${config.server.publicUrl}/webhook/vk`;
        res.json({
            success: true,
            message: 'Настройте вебхук в настройках сообщества VK',
            webhookUrl: webhookUrl,
            instructions: `
                1. Перейдите в настройки сообщества
                2. Выберите "Работа с API"
                3. В разделе "Callback API" укажите URL: ${webhookUrl}
                4. Установите секретный ключ: ${config.vk.secret || 'не установлен'}
                5. Выберите события: "Входящее сообщение", "Нажатие на кнопку"
                6. Подтвердите сервер
            `
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/admin/vk-webhook-info', async (req, res) => {
    try {
        const webhookUrl = `${config.server.publicUrl}/webhook/vk`;
        res.json({
            webhookUrl: webhookUrl,
            groupId: config.vk.groupId,
            apiVersion: config.vk.apiVersion,
            hasToken: !!config.vk.groupToken,
            hasSecret: !!config.vk.secret,
            hasConfirmationToken: !!config.vk.confirmationToken,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/admin/logs', (req, res) => {
    try {
        const logDir = LOG_DIR;
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

app.get('/admin/db-status', async (req, res) => {
    try {
        let pgStatus = false;
        let tables = [];
        
        if (pgConnected && pgClient) {
            const result = await pgClient.query(`
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public'
                ORDER BY table_name
            `);
            tables = result.rows.map(r => r.table_name);
            pgStatus = true;
        }
        
        res.json({
            postgresql: {
                connected: pgStatus,
                tables: tables,
            },
            json_storage: {
                available: true,
                data_dir: DATA_DIR,
            },
            uploads_dir: UPLOADS_DIR,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
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

(async function start() {
    // Подключаем PostgreSQL
    try {
        await connectPostgreSQL();
    } catch (error) {
        console.warn('[STARTUP] PostgreSQL connection failed, using JSON storage');
    }
    
    // Устанавливаем клиент в database
    try {
        database.setPGClient(pgClient, pgConnected);
        console.log(`[DB] PostgreSQL client set: ${pgConnected ? '✅ connected' : '⚠️ fallback'}`);
    } catch (error) {
        console.warn('[DB] Could not set PG client:', error.message);
    }
    
    // Создаем админа
    await ensureAdmin();
    
    const server = app.listen(PORT, HOST, () => {
        console.log('[STARTUP] ========================================');
        console.log(`[STARTUP] ✅ Server running on port ${PORT}`);
        console.log(`[STARTUP] Health: http://${HOST}:${PORT}/health`);
        console.log(`[STARTUP] MAX Webhook URL: ${config.server.publicUrl}/webhook/max`);
        console.log(`[STARTUP] VK Webhook URL: ${config.server.publicUrl}/webhook/vk`);
        console.log(`[STARTUP] Admin panel: ${config.server.publicUrl}/admin`);
        console.log(`[STARTUP] PostgreSQL: ${pgConnected ? '✅ Connected' : '⚠️ Fallback (JSON)'}`);
        console.log('[STARTUP] ✅ Ready');
        console.log('[STARTUP] ========================================');
    });
    
    server.on('error', (error) => {
        console.error('[STARTUP] Server error:', error.message);
        process.exit(1);
    });
    
    const shutdown = (signal) => {
        console.log(`[SHUTDOWN] Received ${signal}`);
        if (pgConnected && pgClient) {
            pgClient.end();
            console.log('[SHUTDOWN] PostgreSQL connection closed');
        }
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
})();

console.log('[STARTUP] ✅ Bootstrap complete');
