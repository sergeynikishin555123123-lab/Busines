// server.js - ПОЛНАЯ ИСПРАВЛЕННАЯ ВЕРСИЯ
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
            connectionTimeoutMillis: 30000,
            keepAlive: true,
            keepAliveInitialDelayMillis: 10000,
        });
        
        await pgClient.connect();
        pgConnected = true;
        console.log('[POSTGRES] ✅ Connected successfully');
        
        await initPostgreSQLTables();
        
        // Keep-alive ping каждые 2 минуты
        setInterval(async () => {
            if (pgConnected && pgClient) {
                try {
                    await pgClient.query('SELECT 1');
                } catch (error) {
                    console.warn('[POSTGRES] Keep-alive failed:', error.message);
                }
            }
        }, 120000);
        
        // Переподключение при обрыве
        pgClient.on('error', async (err) => {
            console.error('[POSTGRES] Connection error:', err.message);
            pgConnected = false;
            
            setTimeout(async () => {
                console.log('[POSTGRES] Attempting to reconnect...');
                try {
                    await reconnectPostgreSQL();
                } catch (e) {
                    console.error('[POSTGRES] ❌ Reconnection failed:', e.message);
                }
            }, 5000);
        });
        
        return pgClient;
    } catch (error) {
        console.error('[POSTGRES] ❌ Connection error:', error.message);
        pgConnected = false;
        pgClient = null;
        console.warn('[POSTGRES] ⚠️ Falling back to JSON storage');
        return null;
    }
}

async function reconnectPostgreSQL() {
    try {
        const newClient = new Client({
            user: process.env.PG_USER || 'gen_user',
            host: process.env.PG_HOST || 'f588fb3b4ee16a08f7a0a9b2.twc1.net',
            database: process.env.PG_DATABASE || 'default_db',
            password: process.env.PG_PASSWORD,
            port: parseInt(process.env.PG_PORT) || 5432,
            ssl: { rejectUnauthorized: false },
            connectionTimeoutMillis: 30000,
            keepAlive: true,
        });
        
        await newClient.connect();
        pgClient = newClient;
        pgConnected = true;
        
        if (database && database.setPGClient) {
            database.setPGClient(pgClient, pgConnected);
        }
        if (vkModule && vkModule.setPGClient) {
            vkModule.setPGClient(pgClient, pgConnected);
        }
        
        console.log('[POSTGRES] ✅ Reconnected successfully');
        return pgClient;
    } catch (error) {
        console.error('[POSTGRES] ❌ Reconnection error:', error.message);
        pgConnected = false;
        throw error;
    }
}

async function initPostgreSQLTables() {
    if (!pgConnected || !pgClient) return;

    try {
        console.log('[POSTGRES] Creating tables...');

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

        await pgClient.query(`
            CREATE TABLE IF NOT EXISTS courses (
                id VARCHAR(36) PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                price DECIMAL(10,2) DEFAULT 0,
                image_url TEXT,
                is_active BOOLEAN DEFAULT TRUE,
                order_number INTEGER DEFAULT 0,
                platform VARCHAR(50) DEFAULT 'max',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

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
                platform VARCHAR(50) DEFAULT 'max',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

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
                platform VARCHAR(50) DEFAULT 'max',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pgClient.query(`
            CREATE TABLE IF NOT EXISTS tests (
                id VARCHAR(36) PRIMARY KEY,
                lesson_id VARCHAR(36) REFERENCES lessons(id) ON DELETE CASCADE,
                question TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        await pgClient.query(`
            CREATE TABLE IF NOT EXISTS test_answers (
                id VARCHAR(36) PRIMARY KEY,
                test_id VARCHAR(36) REFERENCES tests(id) ON DELETE CASCADE,
                answer TEXT NOT NULL,
                is_correct BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

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

        console.log('[POSTGRES] Running migrations...');
        try {
            await pgClient.query(`ALTER TABLE lessons ADD COLUMN IF NOT EXISTS platform VARCHAR(50) DEFAULT 'max'`);
            await pgClient.query(`ALTER TABLE courses ADD COLUMN IF NOT EXISTS platform VARCHAR(50) DEFAULT 'max'`);
            await pgClient.query(`ALTER TABLE lesson_files ADD COLUMN IF NOT EXISTS platform VARCHAR(50) DEFAULT 'max'`);
            await pgClient.query(`ALTER TABLE lesson_files ADD COLUMN IF NOT EXISTS vk_owner_id VARCHAR(50)`);
            await pgClient.query(`ALTER TABLE lesson_files ADD COLUMN IF NOT EXISTS vk_video_id VARCHAR(50)`);
            await pgClient.query(`ALTER TABLE lesson_files ADD COLUMN IF NOT EXISTS vk_access_key VARCHAR(50)`);
            console.log('[POSTGRES] ✅ Migrations applied: platform and vk_* columns added');
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
// ДАТАБАЗА
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
// ПОДКЛЮЧЕНИЕ СЕРВИСОВ
// ============================================================

const MaxAPI = require('./platforms/max');
const courseService = require('./core/course');
const lessonService = require('./core/lesson');
const userService = require('./core/user');
const progressService = require('./core/progress');
const paymentService = require('./core/payment');

// ============================================================
// РАЗДЕЛЬНЫЕ СЕССИИ ДЛЯ MAX И VK
// ============================================================

const adminSessionsMax = new Map();
const adminSessionsVk = new Map();

// ============================================================
// ФУНКЦИЯ ПРОВЕРКИ ДОСТУПА ПОЛЬЗОВАТЕЛЯ
// ============================================================

async function checkUserHasPaidAccess(userId) {
    try {
        if (!userId) return false;
        const userIdStr = String(userId);
        
        if (pgConnected && pgClient) {
            try {
                const result = await pgClient.query(`
                    SELECT EXISTS (
                        SELECT 1 FROM user_course_access uca
                        JOIN courses c ON c.id = uca.course_id
                        WHERE uca.user_id = $1 AND c.price > 0 AND c.is_active = true
                    ) as has_access
                `, [userIdStr]);
                return result.rows[0]?.has_access || false;
            } catch (pgError) {
                console.warn('[ACCESS] PG error, fallback to JSON:', pgError.message);
            }
        }
        
        const access = await database.readTable('user_course_access') || [];
        const paidCourses = await courseService.getPaidCourses();
        
        for (const course of paidCourses) {
            const hasAccess = access.find(a =>
                String(a.user_id) === userIdStr &&
                a.course_id === course.id
            );
            if (hasAccess) return true;
        }
        
        const payments = await database.readTable('payments') || [];
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
            const session = adminSessionsMax.get(chatId);
            if (session && session.mode === 'admin') {
                await handleAdminAttachmentMax(chatId, attachments, maxApi);
                return;
            }
        }
        
        const adminSession = adminSessionsMax.get(chatId);
        if (adminSession && adminSession.mode === 'awaiting_password') {
            await handleAdminPasswordMax(chatId, text, maxApi);
            return;
        }
        
        if (adminSession && adminSession.mode === 'admin') {
            await handleAdminCommandMax(chatId, text, maxApi);
            return;
        }
        
        if (text.startsWith('/start')) {
            await handleStartCommandMax(chatId, userId, text, maxApi);
        } else if (text.startsWith('/help')) {
            await handleHelpCommandMax(chatId, maxApi);
        } else if (text.startsWith('/courses')) {
            await handleCoursesCommandMax(chatId, maxApi);
        } else if (text.startsWith('/admin')) {
            await showAdminLoginMax(chatId, maxApi);
        } else {
            await handleTextMessageMax(chatId, userId, text, maxApi);
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
        const adminSession = adminSessionsMax.get(chatId);
        console.log(`[HANDLER] Admin session:`, adminSession ? {
            mode: adminSession.mode,
            login: adminSession.login,
            context: adminSession.context,
            lessonId: adminSession.lessonId
        } : 'NOT FOUND');
        
        if (payload === 'admin_panel') {
            await showAdminLoginMax(chatId, maxApi);
            return;
        }
        
        if (payload === 'admin_login') {
            adminSessionsMax.set(chatId, { mode: 'awaiting_password' });
            await maxApi.sendMessage({
                chatId: chatId,
                text: `🔐 **Введите пароль администратора**\n\nОтправьте пароль сообщением.`,
                parseMode: 'markdown',
            });
            return;
        }
        
        if (adminSession && adminSession.mode === 'admin') {
            await handleAdminCallbackMax(chatId, payload, maxApi);
            return;
        }
        
        if (payload === 'show_courses') {
            await showCoursesMax(chatId, maxApi);
        } else if (payload === 'show_help') {
            await showHelpMax(chatId, maxApi);
        } else if (payload === 'buy_access') {
            await handleBuyAccessMax(chatId, maxApi);
        } else if (payload.startsWith('payment_check_')) {
            const paymentId = payload.replace('payment_check_', '');
            await handlePaymentCheckMax(chatId, paymentId, maxApi);
        } else if (payload.startsWith('lesson_')) {
            const lessonId = payload.replace('lesson_', '');
            await sendLessonToUserMax(chatId, lessonId, maxApi);
        } else if (payload.startsWith('test_') && !payload.startsWith('test_answer_')) {
            const testId = payload.replace('test_', '');
            await showTestMax(chatId, testId, maxApi);
        } else if (payload.startsWith('test_answer_')) {
            const withoutPrefix = payload.replace('test_answer_', '');
            const underscoreIndex = withoutPrefix.lastIndexOf('_');
            const testId = withoutPrefix.substring(0, underscoreIndex);
            const answerId = withoutPrefix.substring(underscoreIndex + 1);
            await handleTestAnswerMax(chatId, testId, answerId, maxApi);
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
// ОБЩИЕ КОМАНДЫ ДЛЯ MAX
// ============================================================

async function handleStartCommandMax(chatId, userId, text, api) {
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

async function handleHelpCommandMax(chatId, api) {
    await api.sendMessage({
        chatId: chatId,
        text: `📚 **Помощь**\n\n/start - Главное меню\n/help - Помощь\n/courses - Уроки\n/admin - Админ-панель\n\nПросто напиши сообщение, и я помогу!`,
        parseMode: 'markdown',
    });
}

async function handleCoursesCommandMax(chatId, api) {
    await showCoursesMax(chatId, api);
}

async function handleTextMessageMax(chatId, userId, text, api) {
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

async function showHelpMax(chatId, api) {
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
// MAX - ПОКАЗ УРОКОВ
// ============================================================

async function showCoursesMax(chatId, api) {
    try {
        const hasAccess = await checkUserHasPaidAccess(chatId);
        const platform = 'max';
        
        let allLessons;
        if (hasAccess) {
            allLessons = await lessonService.getAllLessons();
        } else {
            allLessons = await lessonService.getFreeLessons();
        }
        
        allLessons = (allLessons || []).filter(l => l.platform === platform || !l.platform);
        
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
            const icon = '📖';
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

// ============================================================
// MAX - ОТПРАВКА УРОКА
// ============================================================

async function sendLessonToUserMax(chatId, lessonId, api) {
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
        
        await api.sendMessage({
            chatId: chatId,
            text: `📖 **${lesson.title}**\n\n${lesson.description || 'Нет описания'}`,
            parseMode: 'markdown',
        });

        if (videoFile) {
            try {
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
            } catch (error) {
                console.error('[LESSON] Failed to send video:', error.message);
                await api.sendMessage({
                    chatId: chatId,
                    text: `📖 **${lesson.title}**\n\n${lesson.description || ''}\n\n⚠️ Видео недоступно.`,
                    parseMode: 'markdown',
                });
            }
        }
        
        for (const file of otherFiles) {
            try {
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
                console.log(`[LESSON] ✅ File sent: ${file.original_name || file.filename}`);
            } catch (error) {
                console.error('[LESSON] Failed to send file:', error.message);
            }
        }
        
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

// ============================================================
// MAX - ТЕСТЫ
// ============================================================

async function showTestMax(chatId, testId, api) {
    try {
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

async function handleTestAnswerMax(chatId, testId, answerId, api) {
    try {
        const result = await lessonService.checkTestAnswer(testId, answerId, chatId);
        const test = await lessonService.getTestById(testId);
        const selectedAnswer = test?.answers?.find(a => a.id === answerId);
        
        if (result.correct) {
            await api.sendMessage({
                chatId: chatId,
                text: `✅ **Правильно!** 🎉\n\nОтличная работа! Вы успешно прошли тест.`,
                parseMode: 'markdown',
            });
            await showCoursesMax(chatId, api);
        } else {
            await api.sendMessage({
                chatId: chatId,
                text: `❌ **Неправильно.**\n\nВаш ответ: ${selectedAnswer?.answer || 'Неизвестно'}\nПопробуйте еще раз!`,
                parseMode: 'markdown',
            });
            await showTestMax(chatId, testId, api);
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

// ============================================================
// MAX - ПОКУПКА ДОСТУПА
// ============================================================

async function handleBuyAccessMax(chatId, api) {
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

async function handlePaymentCheckMax(chatId, paymentId, api) {
    try {
        const result = await paymentService.checkPaymentStatus(paymentId);
        
        if (result.status === 'success') {
            await api.sendMessage({
                chatId: chatId,
                text: `✅ **Оплата подтверждена!**\n\nДоступ к курсам открыт. Начинайте обучение! 📚`,
                parseMode: 'markdown',
            });
            await showCoursesMax(chatId, api);
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

// ============================================================
// MAX - АДМИН-ФУНКЦИИ
// ============================================================

async function showAdminLoginMax(chatId, api) {
    try {
        const session = adminSessionsMax.get(chatId);
        if (session && session.mode === 'admin') {
            await showAdminDashboardMax(chatId, api);
            return;
        }
        
        await api.sendKeyboard({
            chatId: chatId,
            text: `🔐 **Админ-панель MAX**\n\nВойдите для управления контентом.`,
            buttons: [
                [{ type: 'callback', text: '🔐 Войти', payload: 'admin_login' }],
                [{ type: 'callback', text: '❓ Помощь', payload: 'show_help' }]
            ],
            parseMode: 'markdown',
        });
    } catch (error) {
        console.error('[ADMIN MAX] Error showing login:', error);
    }
}

async function handleAdminPasswordMax(chatId, password, api) {
    try {
        let admin = null;
        let admins = [];
        
        if (pgConnected && pgClient) {
            try {
                const result = await pgClient.query('SELECT * FROM admins');
                admins = result.rows || [];
            } catch (pgError) {
                console.warn('[ADMIN MAX] PG error:', pgError.message);
            }
        }
        
        if (admins.length === 0) {
            admins = database.readTable('admins') || [];
        }
        
        if (admins.length === 0) {
            await api.sendMessage({
                chatId: chatId,
                text: '❌ Администраторы не найдены. Обратитесь к разработчику.',
                parseMode: 'markdown',
            });
            adminSessionsMax.delete(chatId);
            return;
        }
        
        for (const a of admins) {
            if (a.password_hash && await bcrypt.compare(password, a.password_hash)) {
                admin = a;
                break;
            }
        }
        
        if (!admin) {
            adminSessionsMax.delete(chatId);
            await api.sendMessage({
                chatId: chatId,
                text: `❌ **Неверный пароль!** Попробуйте снова через /admin`,
                parseMode: 'markdown',
            });
            return;
        }
        
        adminSessionsMax.set(chatId, {
            mode: 'admin',
            adminId: admin.id,
            login: admin.login,
            role: admin.role,
            context: 'dashboard',
            platform: 'max'
        });
        
        await api.sendMessage({
            chatId: chatId,
            text: `✅ **Добро пожаловать в админ-панель MAX, ${admin.login}!**`,
            parseMode: 'markdown',
        });
        
        await showAdminDashboardMax(chatId, api);
    } catch (error) {
        console.error('[ADMIN MAX] Error handling password:', error);
        adminSessionsMax.delete(chatId);
        await api.sendMessage({
            chatId: chatId,
            text: '❌ Ошибка при проверке пароля. Попробуйте позже.',
            parseMode: 'markdown',
        });
    }
}

async function showAdminDashboardMax(chatId, api) {
    try {
        const session = adminSessionsMax.get(chatId);
        if (!session || session.mode !== 'admin') {
            await showAdminLoginMax(chatId, api);
            return;
        }
        
        let courses = [], lessons = [], users = [], payments = [], paidUsers = 0;
        
        if (pgConnected && pgClient) {
            try {
                const coursesRes = await pgClient.query('SELECT * FROM courses');
                courses = coursesRes.rows || [];
                const lessonsRes = await pgClient.query('SELECT * FROM lessons');
                lessons = lessonsRes.rows || [];
                const usersRes = await pgClient.query('SELECT * FROM users');
                users = usersRes.rows || [];
                const paymentsRes = await pgClient.query('SELECT * FROM payments WHERE status = $1', ['success']);
                payments = paymentsRes.rows || [];
                paidUsers = payments.length;
            } catch (e) {
                console.warn('[ADMIN MAX] PG stats error:', e.message);
            }
        }
        
        if (courses.length === 0) {
            courses = await courseService.getAllCourses(false);
            lessons = await database.readTable('lessons') || [];
            users = await database.readTable('users') || [];
            payments = await database.readTable('payments') || [];
            paidUsers = payments.filter(p => p.status === 'success').length;
        }
        
        const text = `🔐 **Админ-панель MAX**\n\n` +
            `👤 ${session.login}\n` +
            `📚 Курсов: ${courses.length}\n` +
            `📖 Уроков: ${lessons.length}\n` +
            `👥 Пользователей: ${users.length}\n` +
            `💳 Купили доступ: ${paidUsers}\n\n` +
            `Выберите действие:`;
        
        const buttons = [
            [{ type: 'callback', text: '➕ Создать урок MAX', payload: 'admin_create_lesson' }],
            [{ type: 'callback', text: '📝 Редактировать уроки MAX', payload: 'admin_edit_lessons' }],
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
        console.error('[ADMIN MAX] Error showing dashboard:', error);
    }
}

async function handleAdminCallbackMax(chatId, payload, api) {
    console.log(`[ADMIN MAX] Callback: ${payload}`);
    
    // Проверка сессии
    const session = adminSessionsMax.get(chatId);
    if (!session || session.mode !== 'admin') {
        console.log(`[ADMIN MAX] ❌ No valid session for ${chatId}`);
        await api.sendMessage({
            chatId: chatId,
            text: '⏳ Сессия истекла. Войдите заново через /admin',
            parseMode: 'markdown',
        });
        return;
    }
    
    // Выход
    if (payload === 'admin_logout') {
        adminSessionsMax.delete(chatId);
        await api.sendMessage({ chatId: chatId, text: '🚪 Вы вышли из админ-панели MAX.', parseMode: 'markdown' });
        return;
    }
    
    // Назад
    if (payload === 'admin_back') {
        await showAdminDashboardMax(chatId, api);
        return;
    }
    
    // Создание урока
    if (payload === 'admin_create_lesson') {
        session.context = 'creating_lesson';
        await api.sendMessage({
            chatId: chatId,
            text: '📝 **Создание урока MAX**\n\nВведите название урока:',
            parseMode: 'markdown',
        });
        return;
    }
    
    // Список уроков
    if (payload === 'admin_edit_lessons') {
        await handleAdminEditLessonsMax(chatId, api);
        return;
    }
    
    // Редактирование конкретного урока
    if (payload.startsWith('admin_edit_lesson_')) {
        const lessonId = payload.replace('admin_edit_lesson_', '');
        session.lessonId = lessonId;
        session.context = 'editing_lesson';
        await showAdminLessonDetailMax(chatId, lessonId, api);
        return;
    }
    
    // Статистика
    if (payload === 'admin_stats') {
        await showAdminStatsMax(chatId, api);
        return;
    }
    
    // ============================================================
    // ДЕЙСТВИЯ С УРОКОМ
    // ============================================================
    
    // Изменить название
    if (payload.startsWith('admin_lesson_edit_title_')) {
        const lessonId = payload.replace('admin_lesson_edit_title_', '');
        session.lessonId = lessonId;
        session.context = 'editing_title';
        await api.sendMessage({
            chatId: chatId,
            text: '✏️ **Введите новое название урока:**',
            parseMode: 'markdown',
        });
        return;
    }
    
    // Изменить описание
    if (payload.startsWith('admin_lesson_edit_desc_')) {
        const lessonId = payload.replace('admin_lesson_edit_desc_', '');
        session.lessonId = lessonId;
        session.context = 'editing_desc';
        await api.sendMessage({
            chatId: chatId,
            text: '✏️ **Введите новое описание урока:**',
            parseMode: 'markdown',
        });
        return;
    }
    
    // Загрузить видео
    if (payload.startsWith('admin_lesson_video_')) {
        const lessonId = payload.replace('admin_lesson_video_', '');
        session.lessonId = lessonId;
        session.context = 'uploading_video';
        await api.sendMessage({
            chatId: chatId,
            text: '🎬 **Загрузка видео**\n\nОтправьте видео файлом в этот чат.\n\nПоддерживаются: MP4, WebM, MOV\nМаксимальный размер: 250MB',
            parseMode: 'markdown',
        });
        return;
    }
    
    // Загрузить файл
    if (payload.startsWith('admin_lesson_file_')) {
        const lessonId = payload.replace('admin_lesson_file_', '');
        session.lessonId = lessonId;
        session.context = 'uploading_file';
        await api.sendMessage({
            chatId: chatId,
            text: '📎 **Загрузка файла**\n\nОтправьте файл в этот чат.\n\nПоддерживаются: PDF, DOCX, ZIP, изображения\nМаксимальный размер: 250MB',
            parseMode: 'markdown',
        });
        return;
    }
    
    // Переключить доступ
    if (payload.startsWith('admin_lesson_toggle_free_')) {
        const lessonId = payload.replace('admin_lesson_toggle_free_', '');
        const lesson = await lessonService.getLessonById(lessonId);
        if (lesson) {
            await lessonService.updateLesson(lessonId, { isFree: !lesson.is_free });
            await api.sendMessage({
                chatId: chatId,
                text: `🔄 Доступ изменен на: ${!lesson.is_free ? '🆓 Бесплатный' : '💰 Платный'}`,
                parseMode: 'markdown',
            });
            await showAdminLessonDetailMax(chatId, lessonId, api);
        }
        return;
    }
    
    // Редактировать тест
    if (payload.startsWith('admin_lesson_edit_test_')) {
        const lessonId = payload.replace('admin_lesson_edit_test_', '');
        session.lessonId = lessonId;
        session.context = 'editing_test';
        await api.sendMessage({
            chatId: chatId,
            text: '📝 **Редактирование теста**\n\nОтправьте тест в формате:\n\nВопрос: Текст вопроса\n1. Ответ 1 (правильный)\n2. Ответ 2\n3. Ответ 3\n4. Ответ 4',
            parseMode: 'markdown',
        });
        return;
    }
    
    // Удалить урок
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
    
    // Подтверждение удаления
    if (payload.startsWith('admin_lesson_delete_confirm_')) {
        const lessonId = payload.replace('admin_lesson_delete_confirm_', '');
        const lesson = await lessonService.getLessonById(lessonId);
        if (lesson) {
            await lessonService.deleteLesson(lessonId);
            await api.sendMessage({
                chatId: chatId,
                text: `🗑️ Урок "${lesson.title}" удален.`,
                parseMode: 'markdown',
            });
            await handleAdminCallbackMax(chatId, 'admin_edit_lessons', api);
        }
        return;
    }
    
    await showAdminDashboardMax(chatId, api);
}

async function handleAdminCommandMax(chatId, text, api) {
    const session = adminSessionsMax.get(chatId);
    if (!session || session.mode !== 'admin') {
        await showAdminLoginMax(chatId, api);
        return;
    }
    
    const context = session.context || '';
    const lessonId = session.lessonId;
    
    // Создание урока - название
    if (context === 'creating_lesson') {
        session.lessonTitle = text;
        session.context = 'creating_lesson_description';
        await api.sendMessage({
            chatId: chatId,
            text: `📝 **Создание урока MAX: "${text}"**\n\nВведите описание урока:`,
            parseMode: 'markdown',
        });
        return;
    }
    
    // Создание урока - описание
    if (context === 'creating_lesson_description') {
        const title = session.lessonTitle;
        const description = text;
        const platform = 'max';
        
        let courses = await courseService.getAllCourses(false);
        let courseId = courses?.find(c => c.platform === 'max')?.id;
        
        if (!courseId) {
            const course = await courseService.createCourse({
                title: 'Основной курс MAX',
                description: 'Все уроки для MAX',
                price: 0,
                isActive: true,
                platform: platform,
            });
            courseId = course.id;
        }
        
        const lesson = await lessonService.createLesson({
            courseId: courseId,
            title: title,
            description: description,
            orderNumber: 0,
            isFree: true,
            platform: platform,
        });
        
        session.context = 'editing_lesson';
        session.lessonId = lesson.id;
        
        await api.sendMessage({
            chatId: chatId,
            text: `✅ **Урок MAX создан!**\n\n📖 ${lesson.title}`,
            parseMode: 'markdown',
        });
        
        await showAdminLessonDetailMax(chatId, lesson.id, api);
        return;
    }
    
    // Изменить название
    if (context === 'editing_title' && lessonId) {
        await lessonService.updateLesson(lessonId, { title: text });
        session.context = 'editing_lesson';
        await api.sendMessage({
            chatId: chatId,
            text: `✅ Название обновлено: "${text}"`,
            parseMode: 'markdown',
        });
        await showAdminLessonDetailMax(chatId, lessonId, api);
        return;
    }
    
    // Изменить описание
    if (context === 'editing_desc' && lessonId) {
        await lessonService.updateLesson(lessonId, { description: text });
        session.context = 'editing_lesson';
        await api.sendMessage({
            chatId: chatId,
            text: '✅ Описание обновлено.',
            parseMode: 'markdown',
        });
        await showAdminLessonDetailMax(chatId, lessonId, api);
        return;
    }
    
    // Редактирование теста
    if (context === 'editing_test' && lessonId) {
        await handleTestCreationMax(chatId, text, api);
        return;
    }
    
    await showAdminDashboardMax(chatId, api);
}

async function handleAdminEditLessonsMax(chatId, api) {
    let lessons = await database.readTable('lessons') || [];
    lessons = lessons.filter(l => l.platform === 'max' || !l.platform);
    
    if (lessons.length === 0) {
        await api.sendMessage({
            chatId: chatId,
            text: '📝 Нет уроков MAX для редактирования',
            parseMode: 'markdown',
        });
        return;
    }
    
    let text = '📝 **Редактирование уроков MAX**\n\nВыберите урок:\n\n';
    const buttons = [];
    
    for (const lesson of lessons) {
        const isFree = lesson.is_free ? '🆓' : '🔒';
        text += `📖 ${lesson.title} ${isFree}\n`;
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
}

async function showAdminLessonDetailMax(chatId, lessonId, api) {
    const lesson = await lessonService.getLessonWithFiles(lessonId);
    if (!lesson) {
        await api.sendMessage({
            chatId: chatId,
            text: '❌ Урок MAX не найден',
            parseMode: 'markdown'
        });
        return;
    }
    
    const files = await lessonService.getLessonFiles(lessonId);
    const hasVideo = files.some(f => f.type === 'video');
    const hasFile = files.some(f => f.type === 'file');
    
    let text = `📝 **Редактирование урока MAX**\n\n`;
    text += `📖 **${lesson.title}**\n\n`;
    text += `🆓 ${lesson.is_free ? 'Бесплатный' : 'Платный'}\n`;
    text += `🎬 Видео: ${hasVideo ? '✅ Есть' : '❌ Нет'}\n`;
    text += `📎 Файлы: ${hasFile ? '✅ Есть' : '❌ Нет'}\n\n`;
    
    const buttons = [
        [{ type: 'callback', text: '✏️ Изменить название', payload: `admin_lesson_edit_title_${lessonId}` }],
        [{ type: 'callback', text: '✏️ Изменить описание', payload: `admin_lesson_edit_desc_${lessonId}` }],
        [{ type: 'callback', text: hasVideo ? '🎬 Заменить видео' : '🎬 Загрузить видео', payload: `admin_lesson_video_${lessonId}` }],
        [{ type: 'callback', text: hasFile ? '📎 Заменить файл' : '📎 Загрузить файл', payload: `admin_lesson_file_${lessonId}` }],
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
}

async function handleAdminAttachmentMax(chatId, attachments, api) {
    const session = adminSessionsMax.get(chatId);
    if (!session || session.mode !== 'admin') {
        console.log('[ADMIN MAX] Not admin session');
        return;
    }
    
    const lessonId = session.lessonId;
    if (!lessonId) {
        await api.sendMessage({
            chatId: chatId,
            text: '❌ Не найден урок MAX. Откройте урок заново.',
            parseMode: 'markdown',
        });
        return;
    }
    
    for (const attachment of attachments) {
        if (attachment.payload && attachment.payload.token) {
            const token = attachment.payload.token;
            const fileName = attachment.payload.filename || 'file';
            const fileType = attachment.type || 'file';
            
            const fileDataToSave = {
                filename: fileName,
                originalname: fileName,
                size: attachment.payload.size || 0,
                mimetype: fileType,
                path: token,
                token: token,
                is_max_uploaded: true,
                type: fileType.startsWith('video') ? 'video' : 'file',
                platform: 'max'
            };
            
            await lessonService.addLessonFile(lessonId, fileDataToSave);
            
            await api.sendMessage({
                chatId: chatId,
                text: `✅ **Файл MAX загружен!**\n\n📎 ${fileName}`,
                parseMode: 'markdown',
            });
            
            await showAdminLessonDetailMax(chatId, lessonId, api);
            return;
        }
    }
    
    await api.sendMessage({
        chatId: chatId,
        text: '❌ Не удалось обработать вложение. Отправьте файл как вложение.',
        parseMode: 'markdown',
    });
}

async function handleTestCreationMax(chatId, text, api) {
    try {
        const session = adminSessionsMax.get(chatId);
        if (!session || !session.lessonId) {
            await api.sendMessage({ chatId: chatId, text: '❌ Сессия потеряна', parseMode: 'markdown' });
            return;
        }

        const lessonId = session.lessonId;
        const lines = text.split('\n').filter(l => l.trim());

        let question = '';
        const answers = [];

        for (const line of lines) {
            if (line.toLowerCase().startsWith('вопрос:')) {
                question = line.replace(/^вопрос:\s*/i, '').trim();
            } else if (/^\d+[\.\)]\s*/.test(line)) {
                const answerText = line.replace(/^\d+[\.\)]\s*/, '').trim();
                const isCorrect = answerText.toLowerCase().includes('(правильный)') || 
                                answerText.toLowerCase().includes('(верный)') ||
                                answerText.endsWith('✅') ||
                                answerText.endsWith('*');
                const cleanAnswer = answerText
                    .replace(/\s*\(правильный\)\s*/i, '')
                    .replace(/\s*\(верный\)\s*/i, '')
                    .replace(/\s*✅\s*$/i, '')
                    .replace(/\s*\*\s*$/i, '')
                    .trim();
                if (cleanAnswer) {
                    answers.push({ text: cleanAnswer, isCorrect });
                }
            }
        }

        if (!question || answers.length < 2) {
            await api.sendMessage({
                chatId: chatId,
                text: '❌ Неверный формат. Нужно: вопрос и минимум 2 варианта ответа.\n\nПример:\nВопрос: Что такое 2+2?\n1. 3\n2. 4 (правильный)\n3. 5\n4. 6',
                parseMode: 'markdown',
            });
            return;
        }

        const result = await lessonService.createTest(lessonId, {
            question: question,
            answers: answers
        });

        let answerText = result.answers.map((a, i) => {
            return `${i + 1}. ${a.answer} ${a.is_correct ? '✅' : ''}`;
        }).join('\n');

        await api.sendMessage({
            chatId: chatId,
            text: `✅ **Тест сохранен!**\n\n📝 ${result.question}\n\n📋 Варианты ответов:\n${answerText}`,
            parseMode: 'markdown',
        });

        session.context = 'editing_lesson';
        await showAdminLessonDetailMax(chatId, lessonId, api);
    } catch (error) {
        console.error('[TEST] Error:', error);
        await api.sendMessage({
            chatId: chatId,
            text: `❌ Ошибка: ${error.message}`,
            parseMode: 'markdown',
        });
    }
}

async function showAdminStatsMax(chatId, api) {
    let users = [], lessons = [], courses = [], payments = [], progress = [];
    
    if (pgConnected && pgClient) {
        try {
            const usersRes = await pgClient.query('SELECT * FROM users WHERE platform = $1', ['max']);
            users = usersRes.rows || [];
            const lessonsRes = await pgClient.query('SELECT * FROM lessons WHERE platform = $1', ['max']);
            lessons = lessonsRes.rows || [];
            const coursesRes = await pgClient.query('SELECT * FROM courses WHERE platform = $1', ['max']);
            courses = coursesRes.rows || [];
            const paymentsRes = await pgClient.query('SELECT * FROM payments WHERE status = $1', ['success']);
            payments = paymentsRes.rows || [];
            const progressRes = await pgClient.query('SELECT * FROM progress');
            progress = progressRes.rows || [];
        } catch (e) {
            console.warn('[ADMIN MAX] PG stats error:', e.message);
        }
    }
    
    if (users.length === 0) {
        users = (await database.readTable('users') || []).filter(u => u.platform === 'max');
        lessons = (await database.readTable('lessons') || []).filter(l => l.platform === 'max');
        courses = (await courseService.getAllCourses(false)).filter(c => c.platform === 'max');
        payments = (await database.readTable('payments') || []).filter(p => p.status === 'success');
        progress = (await database.readTable('progress') || []).filter(p => p.status === 'completed');
    }
    
    const text = `📊 **Статистика MAX**\n\n` +
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
}

// ============================================================
// ПОДКЛЮЧЕНИЕ VK МОДУЛЯ
// ============================================================

const vkModule = require('./platforms/vk');

vkModule.setSharedFunctions({
    checkUserHasPaidAccess,
    showCourses: async (chatId, api) => {
        await showCoursesVk(chatId, api);
    },
    sendLessonToUser: async (chatId, lessonId, api) => {
        await vkModule.sendLessonToUserVk(chatId, lessonId, api);
    },
    showTest: async (chatId, testId, api) => {
        await showTestVk(chatId, testId, api);
    },
    handleTestAnswer: async (chatId, testId, answerId, api) => {
        await handleTestAnswerVk(chatId, testId, answerId, api);
    },
    handleBuyAccess: async (chatId, api) => {
        await handleBuyAccessVk(chatId, api);
    },
    handlePaymentCheck: async (chatId, paymentId, api) => {
        await handlePaymentCheckVk(chatId, paymentId, api);
    },
    adminSessions: adminSessionsVk,
});

// ============================================================
// ФУНКЦИИ ДЛЯ VK
// ============================================================

async function showCoursesVk(chatId, api) {
    try {
        const hasAccess = await checkUserHasPaidAccess(chatId);
        const platform = 'vk';
        
        let allLessons;
        if (hasAccess) {
            allLessons = await lessonService.getAllLessons();
        } else {
            allLessons = await lessonService.getFreeLessons();
        }
        
        allLessons = (allLessons || []).filter(l => l.platform === platform || !l.platform);
        
        if (!allLessons || allLessons.length === 0) {
            const text = hasAccess
                ? '📚 **Уроки**\n\nПока нет уроков. Загляните позже!'
                : '📚 **Бесплатные уроки**\n\nПока нет бесплатных уроков.\n\n💳 Купите доступ к полному курсу!';
            
            const buttons = hasAccess
                ? [[{ text: '❓ Помощь', payload: 'show_help' }]]
                : [
                    [{ text: '💳 Купить доступ', payload: 'buy_access' }],
                    [{ text: '❓ Помощь', payload: 'show_help' }]
                  ];
            
            await api.sendKeyboard({ chatId, text, buttons });
            return;
        }
        
        let text = hasAccess
            ? '📚 **Все уроки**\n\n'
            : '📚 **Бесплатные уроки**\n\n';
        
        const buttons = [];
        
        for (const lesson of allLessons) {
            const icon = '📖';
            const isFree = lesson.is_free ? '🆓' : '🔒';
            
            text += `${icon} **${lesson.title}** ${isFree}\n`;
            if (lesson.description) {
                text += ` ${lesson.description.substring(0, 50)}${lesson.description.length > 50 ? '...' : ''}\n`;
            }
            text += '\n';
            
            buttons.push([
                {
                    text: `${icon} ${lesson.title.substring(0, 25)}`,
                    payload: `lesson_${lesson.id}`
                }
            ]);
        }
        
        if (!hasAccess) {
            buttons.push([{ text: '💳 Купить доступ', payload: 'buy_access' }]);
        }
        buttons.push([{ text: '❓ Помощь', payload: 'show_help' }]);
        
        await api.sendKeyboard({ chatId, text: text + 'Выберите урок:', buttons });
    } catch (error) {
        console.error('[VK COURSES] Error:', error);
        await api.sendMessage({
            chatId: chatId,
            text: '❌ Ошибка при загрузке уроков',
        });
    }
}

async function showTestVk(chatId, testId, api) {
    try {
        const test = await lessonService.getTestById(testId);
        if (!test) {
            await api.sendMessage({
                chatId: chatId,
                text: '❌ Тест не найден',
            });
            return;
        }
        
        if (!test.answers || test.answers.length === 0) {
            await api.sendMessage({
                chatId: chatId,
                text: '❌ У теста нет вариантов ответов',
            });
            return;
        }
        
        const text = `📝 **${test.question || 'Проверьте знания'}**\n\nВыберите правильный ответ:`;
        
        const buttons = [];
        const shuffledAnswers = [...test.answers].sort(() => Math.random() - 0.5);
        
        for (const answer of shuffledAnswers) {
            buttons.push([
                {
                    text: answer.answer || 'Вариант',
                    payload: `test_answer_${testId}_${answer.id}`
                }
            ]);
        }
        
        buttons.push([{
            text: '⬅️ Назад к уроку',
            payload: `lesson_${test.lesson_id}`
        }]);
        
        await api.sendKeyboard({ chatId, text, buttons });
    } catch (error) {
        console.error('[VK TEST] Error showing test:', error);
        await api.sendMessage({
            chatId: chatId,
            text: '❌ Ошибка при загрузке теста',
        });
    }
}

async function handleTestAnswerVk(chatId, testId, answerId, api) {
    try {
        const result = await lessonService.checkTestAnswer(testId, answerId, chatId);
        const test = await lessonService.getTestById(testId);
        const selectedAnswer = test?.answers?.find(a => a.id === answerId);
        
        if (result.correct) {
            await api.sendMessage({
                chatId: chatId,
                text: `✅ **Правильно!** 🎉\n\nОтличная работа! Вы успешно прошли тест.`,
            });
            await showCoursesVk(chatId, api);
        } else {
            await api.sendMessage({
                chatId: chatId,
                text: `❌ **Неправильно.**\n\nВаш ответ: ${selectedAnswer?.answer || 'Неизвестно'}\nПопробуйте еще раз!`,
            });
            await showTestVk(chatId, testId, api);
        }
    } catch (error) {
        console.error('[VK TEST] Error handling answer:', error);
        await api.sendMessage({
            chatId: chatId,
            text: '❌ Ошибка при проверке ответа.',
        });
    }
}

async function handleBuyAccessVk(chatId, api) {
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
                [{ text: '✅ Я оплатил(а)', payload: `payment_check_${payment.id}` }],
                [{ text: '📚 Назад к урокам', payload: 'show_courses' }]
            ],
        });
    } catch (error) {
        console.error('[VK PAYMENT] Error:', error);
        await api.sendMessage({
            chatId: chatId,
            text: '❌ Ошибка при оформлении покупки',
        });
    }
}

async function handlePaymentCheckVk(chatId, paymentId, api) {
    try {
        const result = await paymentService.checkPaymentStatus(paymentId);
        
        if (result.status === 'success') {
            await api.sendMessage({
                chatId: chatId,
                text: `✅ **Оплата подтверждена!**\n\nДоступ к курсам открыт. Начинайте обучение! 📚`,
            });
            await showCoursesVk(chatId, api);
        } else if (result.status === 'pending') {
            await api.sendMessage({
                chatId: chatId,
                text: `⏳ **Платеж в обработке...**\n\nПожалуйста, подождите или проверьте позже.`,
            });
        } else {
            await api.sendMessage({
                chatId: chatId,
                text: `❌ **Платеж не прошел**\n\nПопробуйте еще раз или свяжитесь с поддержкой.`,
            });
        }
    } catch (error) {
        console.error('[VK PAYMENT] Check error:', error);
        await api.sendMessage({
            chatId: chatId,
            text: '❌ Ошибка при проверке оплаты',
        });
    }
}

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
// НАСТРОЙКА СЕССИЙ - POSTGRESQL
// ============================================================

let sessionStore;

try {
    if (pgConnected && pgClient) {
        console.log('[STARTUP] Setting up PostgreSQL session store...');
        const PgSession = require('connect-pg-simple')(session);
        sessionStore = new PgSession({
            pool: pgClient,
            tableName: 'session',
            createTableIfMissing: false,
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
// АВТОМАТИЧЕСКОЕ СОЗДАНИЕ АДМИНА
// ============================================================

async function ensureAdmin() {
    try {
        let admins = [];
        
        if (pgConnected && pgClient) {
            const result = await pgClient.query('SELECT * FROM admins');
            admins = result.rows || [];
        } else {
            admins = database.readTable('admins') || [];
        }
        
        if (admins.length === 0) {
            console.log('[STARTUP] No admin found, creating default admin...');
            const login = config.admin.defaultLogin || 'admin';
            const password = config.admin.defaultPassword || 'admin123';
            const passwordHash = await bcrypt.hash(password, 12);
            
            if (pgConnected && pgClient) {
                await pgClient.query(
                    'INSERT INTO admins (id, login, password_hash, role) VALUES ($1, $2, $3, $4)',
                    [database.generateId(), login, passwordHash, 'superadmin']
                );
            } else {
                const adminsList = database.readTable('admins') || [];
                adminsList.push({
                    id: database.generateId(),
                    login: login,
                    password_hash: passwordHash,
                    role: 'superadmin',
                    platform_user_id: null,
                    created_at: database.now(),
                });
                database.writeTable('admins', adminsList);
            }
            
            console.log(`[STARTUP] ✅ Admin created: ${login} / ${password}`);
        } else {
            console.log(`[STARTUP] Admin(s) already exist (${admins.length})`);
        }
    } catch (error) {
        console.error('[STARTUP] Error creating admin:', error.message);
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
        console.log('[VK WEBHOOK] Secret received:', secret);
        console.log('[VK WEBHOOK] Secret expected:', config.vk.secret);
        
        if (secret && config.vk.secret && secret !== config.vk.secret) {
            console.warn('[VK WEBHOOK] ❌ Invalid secret');
            return res.status(403).send('Invalid secret');
        }
        
        switch (type) {
            case 'confirmation':
                console.log('[VK WEBHOOK] 🔑 Confirmation request');
                return res.status(200).type('text/plain').send(config.vk.confirmationToken || 'be82e6fe');
            
            case 'message_new':
                console.log('[VK WEBHOOK] 📨 New message received');
                res.status(200).send('ok');
                
                setImmediate(async () => {
                    try {
                        await vkModule.handleMessageNew(object);
                    } catch (error) {
                        console.error('[VK WEBHOOK] Error processing message:', error);
                    }
                });
                return;
            
            case 'message_event':
                console.log('[VK WEBHOOK] 🎯 Message event received');
                res.status(200).send('ok');
                
                setImmediate(async () => {
                    try {
                        await vkModule.handleMessageEvent(object);
                    } catch (error) {
                        console.error('[VK WEBHOOK] Error processing event:', error);
                    }
                });
                return;
            
            default:
                console.log(`[VK WEBHOOK] ⚠️ Unhandled type: ${type}`);
                return res.status(200).send('ok');
        }
    } catch (error) {
        console.error('[VK WEBHOOK] 💥 Fatal error:', error);
        console.error('[VK WEBHOOK] Stack:', error.stack);
        return res.status(200).send('ok');
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
    try {
        await connectPostgreSQL();
    } catch (error) {
        console.warn('[STARTUP] PostgreSQL connection failed, using JSON storage');
    }
    
    try {
        database.setPGClient(pgClient, pgConnected);
        console.log(`[DB] PostgreSQL client set: ${pgConnected ? '✅ connected' : '⚠️ fallback'}`);
    } catch (error) {
        console.warn('[DB] Could not set PG client:', error.message);
    }
    
    try {
        vkModule.setPGClient(pgClient, pgConnected);
        console.log(`[VK] PostgreSQL client set: ${pgConnected ? '✅ connected' : '⚠️ fallback'}`);
    } catch (error) {
        console.warn('[VK] Could not set PG client:', error.message);
    }
    
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
