// ============================================================
// platforms/vk.js - ПОЛНАЯ ИСПРАВЛЕННАЯ ВЕРСИЯ
// ============================================================

const crypto = require('crypto');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../logger');
const database = require('../database');
const userService = require('../core/user');
const courseService = require('../core/course');
const lessonService = require('../core/lesson');
const paymentService = require('../core/payment');

// ============================================================
// ПЕРЕМЕННЫЕ ДЛЯ POSTGRESQL
// ============================================================

let pgClient = null;
let pgConnected = false;

function setPGClient(client, connected) {
    pgClient = client;
    pgConnected = connected;
    console.log('[VK] PostgreSQL client set:', connected ? '✅ connected' : '⚠️ fallback');
}

// ============================================================
// ОБЩИЕ ФУНКЦИИ (будут установлены из server.js)
// ============================================================

let sharedFunctions = {};

function setSharedFunctions(functions) {
    sharedFunctions = functions;
    console.log('[VK] Shared functions set');
}

// ============================================================
// VK API КЛИЕНТ
// ============================================================

class VKAPI {
    constructor() {
        this.token = config.vk.groupToken;
        this.apiVersion = config.vk.apiVersion || '5.131';
        this.baseUrl = 'https://api.vk.com/method';
        this.confirmationToken = config.vk.confirmationToken || '3bae5d25';
        this.groupId = config.vk.groupId;

        if (!this.token) {
            console.warn('[VK] ⚠️ VK_GROUP_TOKEN не установлен!');
        }

        this.client = axios.create({
            baseURL: this.baseUrl,
            timeout: 30000,
        });

        this.client.interceptors.request.use(
            (config) => {
                console.log(`[VK] Request: ${config.method.toUpperCase()} ${config.url}`);
                return config;
            },
            (error) => Promise.reject(error)
        );

        this.client.interceptors.response.use(
            (response) => {
                if (response.data && response.data.error) {
                    console.error('[VK] API Error:', response.data.error);
                }
                return response;
            },
            (error) => {
                console.error('[VK] Request failed:', error.message);
                return Promise.reject(error);
            }
        );
    }

    // ============================================================
    // ОТПРАВКА СООБЩЕНИЯ
    // ============================================================

    async sendMessage({ chatId, text, parseMode = 'html', attachments = [] }) {
        try {
            const params = {
                user_id: chatId,
                message: text || ' ',
                random_id: Math.floor(Math.random() * 2147483647),
                access_token: this.token,
                v: this.apiVersion,
            };

            if (attachments && attachments.length > 0) {
                params.attachment = attachments.join(',');
            }

            console.log(`[VK] Sending message to ${chatId}: "${text?.substring(0, 50)}..."`);
            if (attachments.length > 0) {
                console.log(`[VK] Attachments: ${attachments.join(',')}`);
            }

            const response = await this.client.post('/messages.send', null, { params });

            if (response.data && response.data.error) {
                throw new Error(`VK API Error: ${response.data.error.error_msg}`);
            }

            return response.data;
        } catch (error) {
            console.error(`[VK] ❌ Failed to send message to ${chatId}:`, error.message);
            throw error;
        }
    }

    // ============================================================
    // ОТПРАВКА КЛАВИАТУРЫ
    // ============================================================

    async sendKeyboard({ chatId, text, buttons, parseMode = 'html' }) {
        try {
            const vkButtons = buttons.map(row =>
                row.map(btn => ({
                    action: {
                        type: 'text',
                        label: btn.text || btn.payload || 'Кнопка',
                        payload: JSON.stringify({ payload: btn.payload || '' }),
                    },
                    color: this.getButtonColor(btn),
                }))
            );

            const keyboard = {
                one_time: false,
                buttons: vkButtons,
            };

            const params = {
                user_id: chatId,
                message: text || ' ',
                keyboard: JSON.stringify(keyboard),
                random_id: Math.floor(Math.random() * 2147483647),
                access_token: this.token,
                v: this.apiVersion,
            };

            console.log(`[VK] Sending keyboard to ${chatId}: ${buttons.length} rows`);

            const response = await this.client.post('/messages.send', null, { params });

            if (response.data && response.data.error) {
                throw new Error(`VK API Error: ${response.data.error.error_msg}`);
            }

            return response.data;
        } catch (error) {
            console.error(`[VK] ❌ Failed to send keyboard to ${chatId}:`, error.message);
            return this.sendMessage({ chatId, text, parseMode });
        }
    }

    getButtonColor(btn) {
        if (btn.color) return btn.color;
        if (btn.payload === 'admin_panel' || btn.payload === 'admin_login') return 'negative';
        if (btn.payload === 'buy_access' || btn.payload === 'payment_confirmed') return 'positive';
        return 'primary';
    }

    // ============================================================
    // ОТПРАВКА ВИДЕО ПО ID
    // ============================================================

    async sendVideoById({ chatId, ownerId, videoId, accessKey = '', caption = '', parseMode = 'html' }) {
        try {
            let attachment = `video${ownerId}_${videoId}`;
            if (accessKey) {
                attachment += `_${accessKey}`;
            }
            
            console.log(`[VK] Sending video by ID: ${attachment} to ${chatId}`);
            
            return await this.sendMessage({
                chatId,
                text: caption || '🎬 Видео к уроку',
                parseMode,
                attachments: [attachment]
            });
        } catch (error) {
            console.error(`[VK] ❌ Failed to send video by ID to ${chatId}:`, error.message);
            throw error;
        }
    }

    // platforms/vk.js - ИСПРАВЛЕННЫЙ МЕТОД uploadPrivateVideo

async uploadPrivateVideo(filePath, lessonTitle) {
    try {
        console.log(`[VK] Uploading private video: ${filePath}`);
        
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        const stats = fs.statSync(filePath);
        const fileSizeInMB = stats.size / (1024 * 1024);
        console.log(`[VK] File size: ${fileSizeInMB.toFixed(2)} MB`);

        if (fileSizeInMB > 250) {
            throw new Error(`Video too large: ${fileSizeInMB.toFixed(2)} MB (max 250 MB)`);
        }

        console.log('[VK] Getting upload server...');
        
        // ✅ ИСПРАВЛЕНО: явно указываем group_id и is_private=1
        const uploadResponse = await this.client.post('/video.save', null, {
            params: {
                group_id: this.groupId,          // ID группы
                access_token: this.token,
                v: this.apiVersion,
                wallpost: 0,                     // Не публиковать на стене
                is_private: 1,                   // Скрытое видео
                privacy_view: 'only_me',         // Только для владельца
                name: lessonTitle || 'Урок',
                description: 'Видео доступно через бота',
            }
        });
        
        const uploadData = uploadResponse.data.response;
        if (!uploadData) {
            console.error('[VK] Upload response:', uploadResponse.data);
            throw new Error('No upload data received from VK');
        }
        
        const uploadUrl = uploadData.upload_url;
        console.log(`[VK] Upload URL: ${uploadUrl}`);
        
        console.log('[VK] Uploading video...');
        const formData = new FormData();
        formData.append('video_file', fs.createReadStream(filePath));
        
        const uploadResult = await axios.post(uploadUrl, formData, {
            headers: {
                ...formData.getHeaders(),
            },
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
            timeout: 600000,
        });
        
        console.log('[VK] Upload response received');
        
        const data = uploadResult.data;
        
        if (!data.video_file) {
            console.error('[VK] Upload response missing video_file:', data);
            throw new Error('No video_file in upload response');
        }
        
        console.log('[VK] Saving video...');
        const saveResponse = await this.client.post('/video.save', null, {
            params: {
                group_id: this.groupId,
                video_file: data.video_file,
                name: lessonTitle || 'Урок',
                description: 'Видео доступно через бота',
                wallpost: 0,
                is_private: 1,
                privacy_view: 'only_me',
                access_token: this.token,
                v: this.apiVersion,
            }
        });
        
        const video = saveResponse.data.response;
        if (!video) {
            console.error('[VK] Save response missing video:', saveResponse.data);
            throw new Error('No video in save response');
        }
        
        // ✅ ИСПРАВЛЕНО: owner_id должен быть с минусом (ID группы)
        const ownerId = video.owner_id; // Уже с минусом, т.к. это группа
        console.log(`[VK] ✅ Video saved: video${ownerId}_${video.video_id}`);
        console.log(`[VK] ✅ Video is private (not published to wall)`);
        
        return {
            owner_id: ownerId,
            video_id: video.video_id,
            access_key: video.access_key || '',
        };
        
    } catch (error) {
        console.error('[VK] uploadPrivateVideo error:', error.message);
        if (error.response) {
            console.error('[VK] Response status:', error.response.status);
            console.error('[VK] Response data:', error.response.data);
        }
        throw error;
    }
}

    // ============================================================
    // ПОЛУЧЕНИЕ ИНФОРМАЦИИ О ВИДЕО
    // ============================================================

    async getVideoInfo(ownerId, videoId) {
        try {
            const response = await this.client.post('/video.get', null, {
                params: {
                    videos: `${ownerId}_${videoId}`,
                    access_token: this.token,
                    v: this.apiVersion,
                }
            });
            
            if (response.data && response.data.error) {
                throw new Error(`VK API Error: ${response.data.error.error_msg}`);
            }
            
            const items = response.data.response?.items || [];
            return items[0] || null;
        } catch (error) {
            console.error('[VK] getVideoInfo error:', error.message);
            return null;
        }
    }

    // ============================================================
    // ЗАГРУЗКА ФАЙЛА (заглушка)
    // ============================================================

    async uploadFile(filePath, fileType = 'file') {
        console.log(`[VK] uploadFile called (stub) for ${filePath}`);
        return `vk_stub_token_${Date.now()}`;
    }

    async sendVideoByToken({ chatId, token, caption = '', parseMode = 'html' }) {
        console.log(`[VK] sendVideoByToken called (stub) for ${chatId}`);
        return this.sendMessage({
            chatId,
            text: `${caption}\n\n🎬 Видео доступно по ссылке (токен: ${token?.substring(0, 20)}...)`,
            parseMode,
        });
    }

    async sendFileByToken({ chatId, token, caption = '', parseMode = 'html' }) {
        console.log(`[VK] sendFileByToken called (stub) for ${chatId}`);
        return this.sendMessage({
            chatId,
            text: `${caption}\n\n📎 Файл доступен по ссылке (токен: ${token?.substring(0, 20)}...)`,
            parseMode,
        });
    }

    async sendImageByToken({ chatId, token, caption = '', parseMode = 'html' }) {
        console.log(`[VK] sendImageByToken called (stub) for ${chatId}`);
        return this.sendMessage({
            chatId,
            text: `${caption}\n\n🖼️ Изображение доступно по ссылке (токен: ${token?.substring(0, 20)}...)`,
            parseMode,
        });
    }
}

// ============================================================
// ХРАНИЛИЩЕ СЕССИЙ АДМИНА
// ============================================================

const adminSessions = new Map();

// ============================================================
// ОБРАБОТКА СООБЩЕНИЙ
// ============================================================

async function handleMessageNew(message) {
    try {
        const userId = String(
            message.message?.from_id || 
            message.from_id || 
            message.user_id || 
            message.object?.message?.from_id
        );
        const text = message.message?.text || message.text || '';
        
        let attachments = [];
        if (message.message?.attachments) {
            attachments = message.message.attachments;
        } else if (message.attachments) {
            attachments = message.attachments;
        } else if (message.object?.message?.attachments) {
            attachments = message.object.message.attachments;
        }
        
        let payload = null;

        console.log(`[VK HANDLER] Message from ${userId}: "${text}"`);
        console.log(`[VK HANDLER] Attachments: ${attachments.length}`);

        if (message.message?.payload) {
            try {
                const parsed = JSON.parse(message.message.payload);
                payload = parsed.payload || null;
            } catch (e) {}
        }

        const vkApi = new VKAPI();

        if (userId && userId !== 'undefined') {
            try {
                await userService.registerUser({
                    platform_user_id: userId,
                    platform: 'vk',
                    first_name: 'Пользователь VK',
                    last_name: '',
                    username: '',
                    chat_id: userId,
                });
            } catch (regError) {
                console.warn('[VK USER] Registration error:', regError.message);
            }
        } else {
            console.warn('[VK HANDLER] Skipping registration: userId is undefined');
            return;
        }

        if (attachments.length > 0) {
            const adminSession = adminSessions.get(userId);
            if (adminSession && adminSession.mode === 'admin') {
                console.log(`[VK HANDLER] Admin attachment detected, processing...`);
                await handleAdminAttachmentVk(userId, attachments, vkApi);
                return;
            }
        }

        if (payload) {
            await handleCallback(userId, payload, vkApi);
            return;
        }

        if (text.startsWith('/start')) {
            await handleStartCommand(userId, vkApi);
        } else if (text.startsWith('/help')) {
            await handleHelpCommand(userId, vkApi);
        } else if (text.startsWith('/courses')) {
            await handleCoursesCommand(userId, vkApi);
        } else if (text.startsWith('/admin')) {
            await showAdminLogin(userId, vkApi);
        } else {
            const adminSession = adminSessions.get(userId);
            if (adminSession && adminSession.mode === 'admin') {
                await handleAdminCommand(userId, text, vkApi);
                return;
            }
            await handleTextMessage(userId, text, vkApi);
        }

        console.log(`[VK HANDLER] ✅ Message from ${userId} processed`);
    } catch (error) {
        console.error('[VK HANDLER] Error:', error);
    }
}

async function handleMessageEvent(event) {
    try {
        const userId = String(
            event.user_id || 
            event.message?.from_id || 
            event.object?.user_id
        );
        let payload = null;

        if (event.payload) {
            try {
                const parsed = typeof event.payload === 'string'
                    ? JSON.parse(event.payload)
                    : event.payload;
                payload = parsed.payload || null;
            } catch (e) {}
        }

        console.log(`[VK EVENT] User ${userId}, payload: ${payload}`);

        if (payload && userId && userId !== 'undefined') {
            const vkApi = new VKAPI();
            await handleCallback(userId, payload, vkApi);
        }
    } catch (error) {
        console.error('[VK EVENT] Error:', error);
    }
}

// ============================================================
// ОБРАБОТЧИКИ КОМАНД
// ============================================================

async function handleStartCommand(chatId, vkApi) {
    const hasAccess = await sharedFunctions.checkUserHasPaidAccess(chatId);

    let text = `👋 **Привет! Я обучающий бот!**

Здесь вы найдете уроки по программированию.`;

    const buttons = [
        [{ text: '📚 Уроки', payload: 'show_courses' }]
    ];

    if (!hasAccess) {
        buttons.push([{ text: '💳 Купить доступ', payload: 'buy_access' }]);
    }

    buttons.push([{ text: '❓ Помощь', payload: 'show_help' }]);

    await vkApi.sendKeyboard({ chatId, text, buttons });
}

async function handleHelpCommand(chatId, vkApi) {
    await vkApi.sendMessage({
        chatId,
        text: `📚 **Помощь**

/start - Главное меню
/help - Помощь
/courses - Уроки
/admin - Админ-панель

Просто напиши сообщение, и я помогу!`,
    });
}

async function handleCoursesCommand(chatId, vkApi) {
    if (sharedFunctions.showCourses) {
        await sharedFunctions.showCourses(chatId, vkApi);
    } else {
        await vkApi.sendMessage({
            chatId,
            text: '📚 Функция уроков временно недоступна.',
        });
    }
}

// ============================================================
// ОБРАБОТКА ТЕКСТОВЫХ СООБЩЕНИЙ
// ============================================================

async function handleTextMessage(chatId, text, vkApi) {
    console.log(`[VK TEXT] chatId=${chatId}, text="${text}"`);
    
    const adminSession = adminSessions.get(chatId);
    
    if (adminSession && adminSession.mode === 'awaiting_password') {
        console.log(`[VK TEXT] Processing admin password`);
        await handleAdminPassword(chatId, text, vkApi);
        return;
    }

    if (adminSession && adminSession.mode === 'admin') {
        console.log(`[VK TEXT] Admin mode active, forwarding to admin handler`);
        await handleAdminCommand(chatId, text, vkApi);
        return;
    }

    const hasAccess = await sharedFunctions.checkUserHasPaidAccess(chatId);

    const buttons = [
        [{ text: '📚 Уроки', payload: 'show_courses' }]
    ];

    if (!hasAccess) {
        buttons.push([{ text: '💳 Купить доступ', payload: 'buy_access' }]);
    }

    buttons.push([{ text: '❓ Помощь', payload: 'show_help' }]);

    await vkApi.sendKeyboard({
        chatId,
        text: `📝 Я получил ваше сообщение.\n\nЧто хотите сделать дальше?`,
        buttons,
    });
}

// ============================================================
// ОБРАБОТКА CALLBACK
// ============================================================

async function handleCallback(chatId, payload, vkApi) {
    console.log(`[VK CALLBACK] chatId=${chatId}, payload=${payload}`);
    console.log(`[VK CALLBACK] Current session:`, adminSessions.get(chatId));

    const adminSession = adminSessions.get(chatId);
    
    if (adminSession && adminSession.mode === 'admin') {
        console.log(`[VK CALLBACK] ✅ Admin mode active for ${chatId}`);
        await handleAdminCallback(chatId, payload, vkApi);
        return;
    }

    if (adminSession && adminSession.mode === 'awaiting_password') {
        console.log(`[VK CALLBACK] Awaiting password, ignoring callback`);
        await vkApi.sendMessage({
            chatId,
            text: '⏳ Введите пароль администратора сообщением.',
        });
        return;
    }

    if (payload === 'admin_panel' || payload === 'admin_login') {
        console.log(`[VK CALLBACK] Admin login requested`);
        await showAdminLogin(chatId, vkApi);
        return;
    }

    console.log(`[VK CALLBACK] User callback: ${payload}`);
    
    if (payload === 'show_courses' && sharedFunctions.showCourses) {
        await sharedFunctions.showCourses(chatId, vkApi);
        return;
    }
    
    if (payload === 'show_help') {
        await handleHelpCommand(chatId, vkApi);
        return;
    }
    
    if (payload === 'buy_access' && sharedFunctions.handleBuyAccess) {
        await sharedFunctions.handleBuyAccess(chatId, vkApi);
        return;
    }

    if (payload.startsWith('payment_check_')) {
        const paymentId = payload.replace('payment_check_', '');
        if (sharedFunctions.handlePaymentCheck) {
            await sharedFunctions.handlePaymentCheck(chatId, paymentId, vkApi);
        }
        return;
    }

    if (payload.startsWith('lesson_')) {
        const lessonId = payload.replace('lesson_', '');
        if (sharedFunctions.sendLessonToUser) {
            await sharedFunctions.sendLessonToUser(chatId, lessonId, vkApi);
        }
        return;
    }

    if (payload.startsWith('test_') && !payload.startsWith('test_answer_')) {
        const testId = payload.replace('test_', '');
        if (sharedFunctions.showTest) {
            await sharedFunctions.showTest(chatId, testId, vkApi);
        }
        return;
    }

    if (payload.startsWith('test_answer_')) {
        const withoutPrefix = payload.replace('test_answer_', '');
        const underscoreIndex = withoutPrefix.lastIndexOf('_');
        const testId = withoutPrefix.substring(0, underscoreIndex);
        const answerId = withoutPrefix.substring(underscoreIndex + 1);
        if (sharedFunctions.handleTestAnswer) {
            await sharedFunctions.handleTestAnswer(chatId, testId, answerId, vkApi);
        }
        return;
    }

    await vkApi.sendMessage({
        chatId,
        text: `✅ Вы выбрали: ${payload}`,
    });
}

// ============================================================
// АДМИН-ФУНКЦИИ
// ============================================================

async function showAdminLogin(chatId, vkApi) {
    console.log(`[VK] showAdminLogin called for ${chatId}`);
    
    const session = adminSessions.get(chatId);
    if (session && session.mode === 'admin') {
        await showAdminDashboard(chatId, vkApi);
        return;
    }

    adminSessions.set(chatId, { mode: 'awaiting_password' });
    
    await vkApi.sendKeyboard({
        chatId,
        text: `🔐 **Введите пароль администратора VK**\n\nОтправьте пароль сообщением.`,
        buttons: [
            [{ text: '❌ Отмена', payload: 'show_courses' }]
        ],
    });
}

async function handleAdminPassword(chatId, password, vkApi) {
    console.log(`[VK] handleAdminPassword called for ${chatId}`);
    
    try {
        const bcrypt = require('bcryptjs');
        let admin = null;
        let admins = [];

        if (pgConnected && pgClient) {
            const result = await pgClient.query('SELECT * FROM admins');
            admins = result.rows || [];
        } else {
            admins = database.readTable('admins') || [];
        }

        if (admins.length === 0) {
            console.error('[VK] No admins found in database!');
            await vkApi.sendMessage({
                chatId: chatId,
                text: '❌ Администраторы не найдены. Обратитесь к разработчику.',
            });
            adminSessions.delete(chatId);
            return;
        }

        for (const a of admins) {
            if (a.password_hash && await bcrypt.compare(password, a.password_hash)) {
                admin = a;
                break;
            }
        }

        if (!admin) {
            adminSessions.delete(chatId);
            await vkApi.sendMessage({
                chatId: chatId,
                text: '❌ **Неверный пароль!** Попробуйте снова через /admin',
            });
            return;
        }

        adminSessions.set(chatId, {
            mode: 'admin',
            adminId: admin.id,
            login: admin.login,
            role: admin.role,
            context: 'dashboard',
            platform: 'vk',
            created_at: Date.now()
        });

        console.log(`[VK] ✅ Admin session saved for ${chatId}:`, adminSessions.get(chatId));

        await vkApi.sendMessage({
            chatId: chatId,
            text: `✅ **Добро пожаловать в админ-панель VK, ${admin.login}!**`,
        });

        await showAdminDashboard(chatId, vkApi);

    } catch (error) {
        console.error('[VK] Error handling admin password:', error);
        adminSessions.delete(chatId);
        await vkApi.sendMessage({
            chatId: chatId,
            text: '❌ Ошибка при проверке пароля. Попробуйте позже.',
        });
    }
}

async function showAdminDashboard(chatId, vkApi) {
    try {
        const session = adminSessions.get(chatId);
        if (!session || session.mode !== 'admin') {
            await showAdminLogin(chatId, vkApi);
            return;
        }
        
        let courses = [], lessons = [], users = [];
        
        if (pgConnected && pgClient) {
            try {
                const coursesRes = await pgClient.query('SELECT * FROM courses WHERE platform = $1', ['vk']);
                courses = coursesRes.rows || [];
            } catch (e) { courses = []; }
            
            try {
                const lessonsRes = await pgClient.query('SELECT * FROM lessons WHERE platform = $1', ['vk']);
                lessons = lessonsRes.rows || [];
            } catch (e) { lessons = []; }
            
            try {
                const usersRes = await pgClient.query('SELECT * FROM users WHERE platform = $1', ['vk']);
                users = usersRes.rows || [];
            } catch (e) { users = []; }
        } else {
            courses = (await courseService.getAllCourses(false)).filter(c => c.platform === 'vk');
            lessons = (await database.readTable('lessons') || []).filter(l => l.platform === 'vk');
            users = (await database.readTable('users') || []).filter(u => u.platform === 'vk');
        }
        
        // Если нет уроков с platform 'vk', показываем все уроки для статистики
        if (lessons.length === 0) {
            const allLessons = await database.readTable('lessons') || [];
            lessons = allLessons;
        }
        
        const text = `🔐 **Админ-панель VK**\n\n` +
            `👤 ${session.login} (${session.role})\n` +
            `📚 Курсов VK: ${courses.length}\n` +
            `📖 Уроков VK: ${lessons.length}\n` +
            `👥 Пользователей VK: ${users.length}\n\n` +
            `Выберите действие:`;
        
        const buttons = [
            [{ text: '📖 Создать урок VK', payload: 'admin_create_lesson' }],
            [{ text: '📝 Редактировать уроки VK', payload: 'admin_edit_lessons' }],
            [{ text: '📊 Статистика VK', payload: 'admin_stats' }],
            [{ text: '🚪 Выйти', payload: 'admin_logout' }]
        ];
        
        await vkApi.sendKeyboard({ chatId, text, buttons });
    } catch (error) {
        console.error('[VK] Error showing dashboard:', error);
        await vkApi.sendMessage({
            chatId: chatId,
            text: '❌ Ошибка при загрузке админ-панели VK: ' + error.message,
        });
    }
}

// ============================================================
// ОБРАБОТКА АДМИН-КОМАНД
// ============================================================

async function handleAdminCommand(chatId, text, vkApi) {
    console.log(`[VK ADMIN COMMAND] ${chatId}: "${text}"`);
    
    const session = adminSessions.get(chatId);
    if (!session || session.mode !== 'admin') {
        await showAdminLogin(chatId, vkApi);
        return;
    }
    
    const context = session.context || '';
    
    if (context === 'creating_lesson') {
        session.lessonTitle = text;
        session.context = 'creating_lesson_desc';
        await vkApi.sendMessage({
            chatId,
            text: `📝 **Создание урока VK: "${text}"**\n\nВведите описание урока:`,
        });
        return;
    }
    
    if (context === 'creating_lesson_desc') {
        const title = session.lessonTitle;
        const description = text;
        const platform = session.platform || 'vk';
        
        let courses = await courseService.getAllCourses(false);
        let courseId = courses?.find(c => c.platform === 'vk')?.id;
        
        if (!courseId) {
            const course = await courseService.createCourse({
                title: 'Основной курс VK',
                description: 'Все уроки для VK',
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
        
        await vkApi.sendMessage({
            chatId,
            text: `✅ **Урок VK создан!**\n\n📖 ${lesson.title}\n\nТеперь вы можете:\n• Загрузить видео\n• Добавить файл\n• Создать тест\n• Настроить доступ`,
        });
        
        await handleAdminEditLessonVk(chatId, lesson.id, vkApi);
        return;
    }
    
    if (context === 'editing_lesson_title') {
        const lessonId = session.lessonId;
        if (lessonId) {
            await lessonService.updateLesson(lessonId, { title: text });
            session.context = 'editing_lesson';
            await vkApi.sendMessage({
                chatId,
                text: `✅ Название обновлено: "${text}"`,
            });
            await handleAdminEditLessonVk(chatId, lessonId, vkApi);
        }
        return;
    }
    
    if (context === 'editing_lesson_desc') {
        const lessonId = session.lessonId;
        if (lessonId) {
            await lessonService.updateLesson(lessonId, { description: text });
            session.context = 'editing_lesson';
            await vkApi.sendMessage({
                chatId,
                text: '✅ Описание обновлено.',
            });
            await handleAdminEditLessonVk(chatId, lessonId, vkApi);
        }
        return;
    }
    
    if (context === 'uploading_video') {
        await vkApi.sendMessage({
            chatId,
            text: '📎 Отправьте видео как вложение (файл).\n\nНажмите "📎" (прикрепить), выберите "Файл" и выберите видео.',
        });
        return;
    }
    
    if (context === 'uploading_file') {
        await vkApi.sendMessage({
            chatId,
            text: '📎 Отправьте файл как вложение.\n\nНажмите "📎" (прикрепить) и выберите файл.',
        });
        return;
    }
    
    if (context === 'editing_test_question') {
        await handleTestCreation(chatId, text, vkApi);
        return;
    }
    
    if (context === 'editing_test_answers') {
        await handleTestCreation(chatId, text, vkApi);
        return;
    }
    
    await vkApi.sendMessage({
        chatId,
        text: '❓ Неизвестная команда. Используйте кнопки меню.',
    });
}

// ============================================================
// АДМИН-CALLBACK (ИСПРАВЛЕННАЯ)
// ============================================================

async function handleAdminCallback(chatId, payload, vkApi) {
    console.log(`[VK ADMIN CALLBACK] ${chatId}: ${payload}`);
    
    const session = adminSessions.get(chatId);
    if (!session || session.mode !== 'admin') {
        await showAdminLogin(chatId, vkApi);
        return;
    }
    
    if (payload === 'admin_logout') {
        adminSessions.delete(chatId);
        await vkApi.sendMessage({
            chatId,
            text: '🚪 Вы вышли из админ-панели VK.',
        });
        return;
    }
    
    if (payload === 'admin_back') {
        session.context = 'dashboard';
        await showAdminDashboard(chatId, vkApi);
        return;
    }
    
    if (payload === 'admin_create_lesson') {
        session.context = 'creating_lesson';
        session.platform = 'vk';
        session.lessonTitle = null;
        await vkApi.sendMessage({
            chatId,
            text: '📝 **Создание урока VK**\n\nВведите название урока:',
        });
        return;
    }
    
    if (payload === 'admin_edit_lessons') {
        try {
            let allLessons = await database.readTable('lessons') || [];
            if (!Array.isArray(allLessons)) {
                allLessons = [];
            }
            
            console.log(`[VK] Всего уроков в БД: ${allLessons.length}`);
            
            let lessons = allLessons.filter(l => l.platform === 'vk');
            
            if (lessons.length === 0) {
                lessons = allLessons;
                console.log('[VK] Нет уроков с platform="vk", показываем все уроки');
            }
            
            if (lessons.length === 0) {
                await vkApi.sendKeyboard({
                    chatId,
                    text: '📝 Нет созданных уроков.\n\nНажмите "📖 Создать урок VK" чтобы добавить первый урок!',
                    buttons: [
                        [{ text: '📖 Создать урок VK', payload: 'admin_create_lesson' }],
                        [{ text: '⬅️ Назад', payload: 'admin_back' }]
                    ]
                });
                return;
            }
            
            let text = '📝 **Редактирование уроков VK**\n\nВыберите урок для редактирования:\n\n';
            const buttons = [];
            
            for (const lesson of lessons) {
                if (!lesson || !lesson.id) continue;
                const title = lesson.title || 'Без названия';
                const isFree = lesson.is_free ? '🆓' : '🔒';
                const platform = lesson.platform || 'max';
                text += `📖 ${title} ${isFree} (${platform})\n`;
                buttons.push([
                    { 
                        text: `✏️ ${title.substring(0, 25)}`, 
                        payload: `admin_edit_lesson_${lesson.id}` 
                    }
                ]);
            }
            
            buttons.push([{ text: '⬅️ Назад', payload: 'admin_back' }]);
            
            await vkApi.sendKeyboard({ chatId, text, buttons });
        } catch (error) {
            console.error('[VK] Error in admin_edit_lessons:', error);
            await vkApi.sendMessage({
                chatId,
                text: `❌ Ошибка при загрузке уроков: ${error.message}`,
            });
        }
        return;
    }
    
    if (payload.startsWith('admin_edit_lesson_')) {
        const lessonId = payload.replace('admin_edit_lesson_', '');
        await handleAdminEditLessonVk(chatId, lessonId, vkApi);
        return;
    }
    
    if (payload.startsWith('admin_lesson_edit_title_')) {
        const lessonId = payload.replace('admin_lesson_edit_title_', '');
        session.lessonId = lessonId;
        session.context = 'editing_lesson_title';
        await vkApi.sendMessage({
            chatId,
            text: '✏️ Введите новое название урока VK:',
        });
        return;
    }
    
    if (payload.startsWith('admin_lesson_edit_desc_')) {
        const lessonId = payload.replace('admin_lesson_edit_desc_', '');
        session.lessonId = lessonId;
        session.context = 'editing_lesson_desc';
        await vkApi.sendMessage({
            chatId,
            text: '✏️ Введите новое описание урока VK:',
        });
        return;
    }
    
    if (payload.startsWith('admin_lesson_video_')) {
        const lessonId = payload.replace('admin_lesson_video_', '');
        session.lessonId = lessonId;
        session.context = 'uploading_video';
        await vkApi.sendMessage({
            chatId,
            text: '🎬 **Загрузка видео VK**\n\nОтправьте видео файлом в этот чат.\n\n📌 Видео будет загружено в сообщество.\n📌 НЕ будет опубликовано на стене.\n\nПоддерживаются: MP4, MOV, WEBM\nМаксимальный размер: 250MB',
        });
        return;
    }
    
    if (payload.startsWith('admin_lesson_file_')) {
        const lessonId = payload.replace('admin_lesson_file_', '');
        session.lessonId = lessonId;
        session.context = 'uploading_file';
        await vkApi.sendMessage({
            chatId,
            text: '📎 **Загрузка файла VK**\n\nОтправьте файл в этот чат.\n\nПоддерживаются: PDF, DOCX, ZIP, изображения\nМаксимальный размер: 250MB',
        });
        return;
    }
    
    if (payload.startsWith('admin_lesson_toggle_free_')) {
        const lessonId = payload.replace('admin_lesson_toggle_free_', '');
        const lesson = await lessonService.getLessonById(lessonId);
        if (lesson) {
            await lessonService.updateLesson(lessonId, { isFree: !lesson.is_free });
            await vkApi.sendMessage({
                chatId,
                text: `🔄 Доступ изменен на: ${!lesson.is_free ? '🆓 Бесплатный' : '💰 Платный'}`,
            });
            await handleAdminEditLessonVk(chatId, lessonId, vkApi);
        }
        return;
    }
    
    if (payload.startsWith('admin_lesson_edit_test_')) {
        const lessonId = payload.replace('admin_lesson_edit_test_', '');
        session.lessonId = lessonId;
        session.context = 'editing_test_question';
        session.testAnswers = [];
        session.testQuestion = null;
        await vkApi.sendMessage({
            chatId,
            text: '📝 **Создание теста VK**\n\nВведите вопрос для теста:',
        });
        return;
    }
    
    if (payload.startsWith('admin_lesson_delete_')) {
        const lessonId = payload.replace('admin_lesson_delete_', '');
        const lesson = await lessonService.getLessonById(lessonId);
        if (lesson) {
            await vkApi.sendKeyboard({
                chatId,
                text: `⚠️ **Удалить урок VK "${lesson.title}"?**`,
                buttons: [
                    [{ text: '✅ Да', payload: `admin_lesson_delete_confirm_${lessonId}` }],
                    [{ text: '❌ Нет', payload: `admin_edit_lesson_${lessonId}` }]
                ],
            });
        }
        return;
    }
    
    if (payload.startsWith('admin_lesson_delete_confirm_')) {
        const lessonId = payload.replace('admin_lesson_delete_confirm_', '');
        await lessonService.deleteLesson(lessonId);
        await vkApi.sendMessage({
            chatId,
            text: '🗑️ Урок VK удален.',
        });
        // ✅ ИСПРАВЛЕНО: вызываем admin_edit_lessons через handleAdminCallback
        await handleAdminCallback(chatId, 'admin_edit_lessons', vkApi);
        return;
    }
    
    if (payload === 'admin_stats') {
        let users = [], lessons = [], courses = [], payments = [], progress = [];
        
        if (pgConnected && pgClient) {
            const usersRes = await pgClient.query('SELECT * FROM users WHERE platform = $1', ['vk']);
            users = usersRes.rows || [];
            const lessonsRes = await pgClient.query('SELECT * FROM lessons WHERE platform = $1', ['vk']);
            lessons = lessonsRes.rows || [];
            const coursesRes = await pgClient.query('SELECT * FROM courses WHERE platform = $1', ['vk']);
            courses = coursesRes.rows || [];
            const paymentsRes = await pgClient.query('SELECT * FROM payments WHERE status = $1', ['success']);
            payments = paymentsRes.rows || [];
            const progressRes = await pgClient.query('SELECT * FROM progress WHERE status = $1', ['completed']);
            progress = progressRes.rows || [];
        } else {
            users = (await database.readTable('users') || []).filter(u => u.platform === 'vk');
            lessons = (await database.readTable('lessons') || []).filter(l => l.platform === 'vk');
            courses = (await courseService.getAllCourses(false)).filter(c => c.platform === 'vk');
            payments = (await database.readTable('payments') || []).filter(p => p.status === 'success');
            progress = (await database.readTable('progress') || []).filter(p => p.status === 'completed');
        }
        
        const text = `📊 **Статистика VK**\n\n` +
            `👤 Пользователей VK: ${users.length}\n` +
            `📚 Курсов VK: ${courses.length}\n` +
            `📖 Уроков VK: ${lessons.length}\n` +
            `✅ Пройдено уроков: ${progress.length}\n` +
            `💳 Оплат: ${payments.length}\n` +
            `💰 Выручка: ${payments.reduce((s, p) => s + (p.amount || 0), 0)} ₽`;
        
        await vkApi.sendKeyboard({
            chatId,
            text: text,
            buttons: [[{ text: '⬅️ Назад', payload: 'admin_back' }]]
        });
        return;
    }
    
    await showAdminDashboard(chatId, vkApi);
}

// ============================================================
// РЕДАКТИРОВАНИЕ УРОКА VK
// ============================================================

async function handleAdminEditLessonVk(chatId, lessonId, vkApi) {
    try {
        const session = adminSessions.get(chatId);
        if (!session || session.mode !== 'admin') {
            await showAdminLogin(chatId, vkApi);
            return;
        }
        
        const lesson = await lessonService.getLessonWithFiles(lessonId);
        if (!lesson) {
            await vkApi.sendMessage({ chatId, text: '❌ Урок VK не найден' });
            return;
        }
        
        session.lessonId = lessonId;
        session.context = 'editing_lesson';
        
        const files = await lessonService.getLessonFiles(lessonId);
        const hasVideo = files.find(f => f.type === 'video' && (f.platform === 'vk' || !f.platform));
        const hasFile = files.find(f => f.type === 'file' && (f.platform === 'vk' || !f.platform));
        
        let text = `📝 **Редактирование урока VK**\n\n`;
        text += `📖 **${lesson.title}**\n\n`;
        text += `📝 Описание: ${lesson.description || 'Нет'}\n`;
        text += `🆓 ${lesson.is_free ? 'Бесплатный' : 'Платный'}\n`;
        text += `🎬 Видео: ${hasVideo ? '✅ Есть' : '❌ Нет'}\n`;
        text += `📎 Файл: ${hasFile ? '✅ Есть' : '❌ Нет'}\n\n`;
        text += `Выберите действие:`;
        
        const buttons = [
            [{ text: '✏️ Изменить название', payload: `admin_lesson_edit_title_${lessonId}` }],
            [{ text: '✏️ Изменить описание', payload: `admin_lesson_edit_desc_${lessonId}` }],
            [{ text: hasVideo ? '🎬 Заменить видео' : '🎬 Добавить видео', payload: `admin_lesson_video_${lessonId}` }],
            [{ text: hasFile ? '📎 Заменить файл' : '📎 Добавить файл', payload: `admin_lesson_file_${lessonId}` }],
            [{ text: lesson.is_free ? '🔒 Сделать платным' : '🆓 Сделать бесплатным', payload: `admin_lesson_toggle_free_${lessonId}` }],
            [{ text: '📝 Редактировать тест', payload: `admin_lesson_edit_test_${lessonId}` }],
            [{ text: '🗑️ Удалить урок', payload: `admin_lesson_delete_${lessonId}` }],
            [{ text: '⬅️ Назад', payload: 'admin_edit_lessons' }]
        ];
        
        await vkApi.sendKeyboard({ chatId, text, buttons });
    } catch (error) {
        console.error('[VK] Error showing lesson detail:', error);
        await vkApi.sendMessage({
            chatId,
            text: `❌ Ошибка: ${error.message}`,
        });
    }
}

// ============================================================
// ОБРАБОТКА ВЛОЖЕНИЙ В VK
// ============================================================

async function handleAdminAttachmentVk(chatId, attachments, vkApi) {
    try {
        const session = adminSessions.get(chatId);
        if (!session || session.mode !== 'admin') {
            console.log('[VK ADMIN] Not admin session');
            await vkApi.sendMessage({
                chatId,
                text: '❌ Сначала войдите в админ-панель VK через /admin',
            });
            return;
        }
        
        const lessonId = session.lessonId;
        if (!lessonId) {
            await vkApi.sendMessage({
                chatId,
                text: '❌ Не найден урок VK. Создайте урок заново.',
            });
            return;
        }
        
        console.log(`[VK ADMIN] Processing ${attachments.length} attachment(s) for lesson ${lessonId}`);
        
        for (const attachment of attachments) {
            console.log('[VK ADMIN] Full attachment:', JSON.stringify(attachment, null, 2));
            
            const type = attachment.type;
            
            // platforms/vk.js - В функции handleAdminAttachmentVk, найдите блок с video и замените:

if (type === 'video' && attachment.video) {
    const video = attachment.video;
    // ✅ ИСПРАВЛЕНО: owner_id уже должен быть с минусом (ID группы)
    const ownerId = video.owner_id;
    const videoId = video.id;
    const accessKey = video.access_key || '';
    const title = video.title || 'Видео';
    
    console.log(`[VK ADMIN] Video: owner_id=${ownerId}, id=${videoId}, title=${title}`);
    
    if (ownerId && videoId) {
        // ✅ ИСПРАВЛЕНО: сохраняем owner_id как есть (с минусом)
        const fileDataToSave = {
            filename: title,
            originalname: title,
            size: 0,
            mimetype: 'video/mp4',
            path: `video${ownerId}_${videoId}`,
            token: null,
            vk_owner_id: ownerId,        // Сохраняем с минусом
            vk_video_id: videoId,
            vk_access_key: accessKey,
            is_max_uploaded: true,
            type: 'video',
            platform: 'vk'
        };
        
        const existingFiles = await lessonService.getLessonFiles(lessonId);
        const oldVideo = existingFiles.find(f => f.type === 'video' && (f.platform === 'vk' || !f.platform));
        if (oldVideo) {
            await lessonService.deleteLessonFile(oldVideo.id);
            console.log(`[VK ADMIN] Old video deleted: ${oldVideo.id}`);
        }
        
        await lessonService.addLessonFile(lessonId, fileDataToSave);
        
        await vkApi.sendMessage({
            chatId,
            text: `✅ **Видео VK сохранено!**\n\n📹 ${title}\n\nВидео сохранено в уроке.`,
        });
        
        await handleAdminEditLessonVk(chatId, lessonId, vkApi);
        return;
    }
}
            
           // platforms/vk.js - ИСПРАВЛЕННАЯ ОБРАБОТКА ДОКУМЕНТОВ

if (type === 'doc' && attachment.doc) {
    const doc = attachment.doc;
    const docUrl = doc.url || '';
    const fileName = doc.title || 'file';
    const fileExt = doc.ext || '';
    const isVideo = ['mp4', 'mov', 'avi', 'webm', 'mkv', 'm4v', '3gp'].includes(fileExt.toLowerCase());
    
    console.log(`[VK ADMIN] Doc: ${fileName}, ext: ${fileExt}, isVideo: ${isVideo}`);
    console.log(`[VK ADMIN] Doc URL: ${docUrl}`);
    
    // ✅ ИСПРАВЛЕНО: обрабатываем видео
    if (isVideo && docUrl) {
        await vkApi.sendMessage({
            chatId,
            text: `⏳ **Загрузка видео в сообщество VK...**\n\nЭто может занять несколько минут.\n\n📌 Видео НЕ будет опубликовано на стене.`,
        });
        
        try {
            const response = await axios.get(docUrl, {
                responseType: 'arraybuffer',
                timeout: 600000,
            });
            
            const tempDir = path.join('/tmp', 'vk_uploads');
            if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
            
            const tempPath = path.join(tempDir, `${Date.now()}-${fileName}`);
            fs.writeFileSync(tempPath, Buffer.from(response.data));
            
            const vkApiClient = new VKAPI();
            const vkResult = await vkApiClient.uploadPrivateVideo(tempPath, 'Урок VK');
            
            fs.unlinkSync(tempPath);
            
            // ✅ ИСПРАВЛЕНО: правильно формируем fileData
            const fileDataToSave = {
                filename: fileName,
                originalname: fileName,
                size: response.data.length,
                mimetype: 'video/mp4', // ✅ строка
                path: `video${vkResult.owner_id}_${vkResult.video_id}`,
                url: null,
                token: null,
                vk_owner_id: vkResult.owner_id,
                vk_video_id: vkResult.video_id,
                vk_access_key: vkResult.access_key || null,
                is_max_uploaded: true,
                type: 'video',
                platform: 'vk'
            };
            
            const existingFiles = await lessonService.getLessonFiles(lessonId);
            const oldVideo = existingFiles.find(f => f.type === 'video' && (f.platform === 'vk' || !f.platform));
            if (oldVideo) {
                await lessonService.deleteLessonFile(oldVideo.id);
            }
            
            await lessonService.addLessonFile(lessonId, fileDataToSave);
            
            await vkApi.sendMessage({
                chatId,
                text: `✅ **Видео VK загружено в сообщество!**\n\n📹 ${fileName}\n\n📌 Видео НЕ опубликовано на стене.\n\nТеперь видео доступно всем пользователям бота.`,
            });
            
            await handleAdminEditLessonVk(chatId, lessonId, vkApi);
            return;
        } catch (error) {
            console.error('[VK ADMIN] Video upload error:', error);
            await vkApi.sendMessage({
                chatId,
                text: `❌ Ошибка загрузки видео: ${error.message}\n\nПопробуйте загрузить видео через кнопку "Видео" в интерфейсе VK.`,
            });
            return;
        }
    }
    
    // ✅ ИСПРАВЛЕНО: обработка обычного файла
    if (docUrl) {
        await vkApi.sendMessage({
            chatId,
            text: `📎 **Файл VK**\n\n${fileName}\n${docUrl}`,
        });
        
        // ✅ ИСПРАВЛЕНО: правильно формируем fileData с mimetype как строкой
        const fileDataToSave = {
            filename: fileName,
            originalname: fileName,
            size: doc.size || 0,
            mimetype: doc.type || 'application/octet-stream', // ✅ строка
            path: docUrl,
            url: docUrl,
            type: 'file',
            platform: 'vk'
        };
        
        const existingFiles = await lessonService.getLessonFiles(lessonId);
        const oldFile = existingFiles.find(f => f.type === 'file' && (f.platform === 'vk' || !f.platform));
        if (oldFile) {
            await lessonService.deleteLessonFile(oldFile.id);
        }
        
        await lessonService.addLessonFile(lessonId, fileDataToSave);
        
        await handleAdminEditLessonVk(chatId, lessonId, vkApi);
        return;
    }
}
        }
        
        await vkApi.sendMessage({
            chatId,
            text: '❌ Не удалось обработать вложение.\n\n📌 Для загрузки видео:\n1. Нажмите "📎" (прикрепить)\n2. Выберите "Файл"\n3. Выберите видеофайл (.mp4, .mov)\n\nИли просто отправьте видео через кнопку "Видео" в интерфейсе VK.',
        });
    } catch (error) {
        console.error('[VK ADMIN] Error handling attachment:', error);
        await vkApi.sendMessage({
            chatId,
            text: `❌ Ошибка: ${error.message}`,
        });
    }
}

// ============================================================
// ОБРАБОТКА ТЕСТА
// ============================================================

async function handleTestCreation(chatId, text, vkApi) {
    try {
        const session = adminSessions.get(chatId);
        if (!session || !session.lessonId) {
            await vkApi.sendMessage({ chatId, text: '❌ Сессия потеряна' });
            return;
        }

        const lessonId = session.lessonId;
        const context = session.context || '';
        
        // ============================================
        // ⭐ ШАГ 1: ВВОД ВОПРОСА
        // ============================================
        if (context === 'editing_test_question') {
            session.testQuestion = text;
            session.testAnswers = [];
            session.context = 'editing_test_answers';
            session.answerIndex = 1;
            
            await vkApi.sendMessage({
                chatId,
                text: `📝 **Вопрос:** ${text}\n\nВведите вариант ответа #1 (чтобы отметить правильный, поставьте * в конце):\n\n*Например: 4 (правильный)* или *4**`,
            });
            return;
        }
        
        // ============================================
        // ⭐ ШАГ 2: ВВОД ОТВЕТОВ (ПО ОДНОМУ)
        // ============================================
        if (context === 'editing_test_answers') {
            const lowerText = text.toLowerCase().trim();
            
            // Проверяем, не хочет ли пользователь завершить
            if (lowerText === 'готово' || lowerText === 'done' || lowerText === 'конец') {
                if (session.testAnswers.length < 2) {
                    await vkApi.sendMessage({
                        chatId,
                        text: `⚠️ Нужно минимум 2 варианта ответа. Добавьте еще варианты.\n\nТекущий ответ #${session.testAnswers.length + 1}:`,
                    });
                    return;
                }
                
                // Проверяем, есть ли правильный ответ
                const hasCorrect = session.testAnswers.some(a => a.isCorrect);
                if (!hasCorrect) {
                    session.testAnswers[0].isCorrect = true;
                    await vkApi.sendMessage({
                        chatId,
                        text: `ℹ️ Первый ответ автоматически отмечен как правильный.`,
                    });
                }
                
                // Сохраняем тест
                const result = await lessonService.createTest(lessonId, {
                    question: session.testQuestion,
                    answers: session.testAnswers,
                });
                
                session.context = 'editing_lesson';
                
                let answerText = result.answers.map((a, i) => {
                    return `${i + 1}. ${a.answer} ${a.is_correct ? '✅' : ''}`;
                }).join('\n');
                
                await vkApi.sendMessage({
                    chatId,
                    text: `✅ **Тест VK сохранен!**\n\n📝 Вопрос: ${result.question}\n\n📋 Варианты ответов:\n${answerText}`,
                });
                
                await handleAdminEditLessonVk(chatId, lessonId, vkApi);
                return;
            }
            
            // Добавляем ответ
            const isCorrect = text.endsWith('*');
            const cleanAnswer = isCorrect ? text.slice(0, -1).trim() : text.trim();
            
            if (!cleanAnswer) {
                await vkApi.sendMessage({
                    chatId,
                    text: `⚠️ Пустой ответ. Введите текст ответа #${session.testAnswers.length + 1}:`,
                });
                return;
            }
            
            session.testAnswers.push({
                text: cleanAnswer,
                isCorrect: isCorrect,
            });
            
            const correctMark = isCorrect ? ' ✅ (правильный)' : '';
            const answerNum = session.testAnswers.length;
            
            await vkApi.sendMessage({
                chatId,
                text: `✅ Ответ #${answerNum} добавлен: "${cleanAnswer}"${correctMark}\n\nВведите вариант ответа #${answerNum + 1} (или "готово" чтобы завершить):\n\n*Чтобы отметить правильный ответ, поставьте * в конце*`,
            });
            return;
        }
        
        // Если что-то пошло не так
        await vkApi.sendMessage({
            chatId,
            text: '❌ Неизвестная команда. Используйте кнопки меню.',
        });
    } catch (error) {
        console.error('[VK TEST] Error:', error);
        const session = adminSessions.get(chatId);
        if (session) session.context = 'editing_lesson';
        await vkApi.sendMessage({
            chatId,
            text: `❌ Ошибка: ${error.message}`,
        });
        if (session && session.lessonId) {
            await handleAdminEditLessonVk(chatId, session.lessonId, vkApi);
        }
    }
}

// ============================================================
// ОТПРАВКА УРОКА ПОЛЬЗОВАТЕЛЮ (С ВИДЕО КАК ВЛОЖЕНИЕ)
// ============================================================

async function sendLessonToUserVk(chatId, lessonId, vkApi) {
    try {
        console.log(`[VK LESSON] Sending lesson ${lessonId} to ${chatId}`);
        
        const lesson = await lessonService.getLessonWithFiles(lessonId);
        if (!lesson) {
            await vkApi.sendMessage({
                chatId,
                text: '❌ Урок не найден',
            });
            return;
        }
        
        if (!lesson.is_free) {
            const hasAccess = await sharedFunctions.checkUserHasPaidAccess(chatId);
            if (!hasAccess) {
                await vkApi.sendKeyboard({
                    chatId: chatId,
                    text: `🔒 **Этот урок платный**\n\n"${lesson.title}" доступен только после покупки полного курса.\n\n💳 Купите доступ чтобы открыть все уроки!`,
                    buttons: [
                        [{ text: '💳 Купить доступ', payload: 'buy_access' }],
                        [{ text: '📚 Назад к урокам', payload: 'show_courses' }]
                    ],
                });
                return;
            }
        }
        
        const files = await lessonService.getLessonFiles(lessonId);
        const videoFile = files.find(f => f.type === 'video' && (f.platform === 'vk' || !f.platform));
        const otherFiles = files.filter(f => f.type !== 'video' && (f.platform === 'vk' || !f.platform));
        
        await vkApi.sendMessage({
            chatId,
            text: `📖 **${lesson.title}**\n\n${lesson.description || 'Нет описания'}`,
        });
        
        // platforms/vk.js - В функции sendLessonToUserVk, найдите блок с отправкой видео:

if (videoFile) {
    try {
        // ✅ ИСПРАВЛЕНО: owner_id уже с минусом, используем как есть
        const ownerId = videoFile.vk_owner_id;
        const videoId = videoFile.vk_video_id;
        const accessKey = videoFile.vk_access_key || '';
        
        if (ownerId && videoId) {
            console.log(`[VK LESSON] Sending video: video${ownerId}_${videoId}`);
            
            let attachment = `video${ownerId}_${videoId}`;
            if (accessKey) {
                attachment += `_${accessKey}`;
            }
            
            await vkApi.sendMessage({
                chatId: chatId,
                text: `🎬 **${lesson.title}**\n\n${lesson.description || ''}`,
                attachments: [attachment],
            });
            
            console.log(`[VK LESSON] ✅ Video sent as attachment: ${attachment}`);
        } else {
            await vkApi.sendMessage({
                chatId: chatId,
                text: `📖 **${lesson.title}**\n\n${lesson.description || ''}\n\n⚠️ Видео недоступно.`,
            });
        }
    } catch (error) {
        console.error('[VK LESSON] Failed to send video:', error.message);
        await vkApi.sendMessage({
            chatId: chatId,
            text: `📖 **${lesson.title}**\n\n${lesson.description || ''}\n\n⚠️ Видео недоступно.`,
        });
    }
}
        
        for (const file of otherFiles) {
            try {
                const fileUrl = file.url || file.path || '';
                if (fileUrl) {
                    await vkApi.sendMessage({
                        chatId,
                        text: `📎 **${file.original_name || file.filename}**\n${fileUrl}`,
                    });
                }
                console.log(`[VK LESSON] ✅ File sent: ${file.original_name || file.filename}`);
            } catch (error) {
                console.error('[VK LESSON] Failed to send file:', error.message);
            }
        }
        
        const test = await lessonService.getLessonTest(lessonId);
        if (test && test.answers && test.answers.length > 0) {
            await vkApi.sendKeyboard({
                chatId: chatId,
                text: `📝 **Проверь себя!**\n\nПройти тест по уроку "${lesson.title}"`,
                buttons: [
                    [{ text: '✅ Проверить себя', payload: `test_${test.id}` }],
                    [{ text: '📚 Назад к урокам', payload: 'show_courses' }]
                ],
            });
        } else {
            await vkApi.sendKeyboard({
                chatId: chatId,
                text: `✅ Урок завершён!\n\nВы изучили "${lesson.title}"`,
                buttons: [
                    [{ text: '📚 Назад к урокам', payload: 'show_courses' }]
                ],
            });
        }
        
        console.log(`[VK LESSON] ✅ Lesson ${lessonId} sent to ${chatId}`);
    } catch (error) {
        console.error('[VK LESSON] Error sending lesson:', error);
        await vkApi.sendMessage({
            chatId,
            text: '❌ Ошибка при загрузке урока.',
        });
    }
}

// ============================================================
// ВЕБХУК ОБРАБОТЧИК
// ============================================================

async function webhookHandler(req, res) {
    try {
        const { type, secret, object, group_id } = req.body;

        console.log('[VK WEBHOOK] Type:', type);
        console.log('[VK WEBHOOK] Group ID:', group_id);

        if (config.vk.secret && secret !== config.vk.secret) {
            console.warn('[VK WEBHOOK] Invalid secret');
            return res.status(403).send('Invalid secret');
        }

        switch (type) {
            case 'confirmation':
                console.log('[VK WEBHOOK] Confirmation request');
                console.log(`[VK WEBHOOK] ✅ Sending confirmation: ${config.vk.confirmationToken || 'test'}`);
                return res.send(config.vk.confirmationToken || '3bae5d25');


            case 'message_new':
                res.send('ok');
                setImmediate(async () => {
                    try {
                        await handleMessageNew(object);
                    } catch (error) {
                        console.error('[VK WEBHOOK] Error processing message:', error);
                    }
                });
                return;

            case 'message_event':
                res.send('ok');
                setImmediate(async () => {
                    try {
                        await handleMessageEvent(object);
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
}

// ============================================================
// ЭКСПОРТЫ
// ============================================================

module.exports = {
    VKAPI,
    webhookHandler,
    handleMessageNew,
    handleMessageEvent,
    handleCallback,
    adminSessions,
    setSharedFunctions,
    setPGClient,
    handleAdminPassword,
    showAdminLogin,
    showAdminDashboard,
    handleAdminCallback,
    handleAdminCommand,
    handleAdminEditLessonVk,
    handleAdminAttachmentVk,
    handleTestCreation,
    sendLessonToUserVk,
};
