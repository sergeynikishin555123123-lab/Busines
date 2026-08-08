// ============================================================
// ИМПОРТЫ
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

// 👇 ДОБАВЬТЕ ЭТИ ПЕРЕМЕННЫЕ СЮДА (после импортов)
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
        this.confirmationToken = config.vk.confirmationToken || 'test';
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
    // ЗАГЛУШКИ ДЛЯ ОТПРАВКИ ВИДЕО/ФАЙЛОВ (имитация MAX методов)
    // ============================================================

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

    async uploadPrivateVideo(filePath, lessonTitle) {
    try {
        console.log(`[VK] Uploading private video: ${filePath}`);
        
        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        // Проверяем размер
        const stats = fs.statSync(filePath);
        const fileSizeInMB = stats.size / (1024 * 1024);
        console.log(`[VK] File size: ${fileSizeInMB.toFixed(2)} MB`);

        if (fileSizeInMB > 250) {
            throw new Error(`Video too large: ${fileSizeInMB.toFixed(2)} MB (max 250 MB)`);
        }

        // Получаем сервер для загрузки
        console.log('[VK] Getting upload server...');
        const uploadResponse = await this.client.post('/video.save', null, {
            params: {
                group_id: this.groupId,
                access_token: this.token,
                v: this.apiVersion,
            }
        });
        
        const uploadData = uploadResponse.data.response;
        if (!uploadData) {
            throw new Error('No upload data received from VK');
        }
        
        const uploadUrl = uploadData.upload_url;
        console.log(`[VK] Upload URL: ${uploadUrl}`);
        
        // Загружаем видео
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
        
        // Сохраняем видео
        console.log('[VK] Saving video with private access...');
        const data = uploadResult.data;
        
        if (!data.video_file) {
            console.error('[VK] Upload response missing video_file:', data);
            throw new Error('No video_file in upload response');
        }
        
        const saveResponse = await this.client.post('/video.save', null, {
            params: {
                group_id: this.groupId,
                video_file: data.video_file,
                name: lessonTitle || 'Урок',
                description: 'Видео доступно только через бота',
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
        
        console.log(`[VK] ✅ Video saved: video${video.owner_id}_${video.video_id}`);
        
        return {
            owner_id: video.owner_id,
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

    async uploadFile(filePath, fileType = 'file') {
        console.log(`[VK] uploadFile called (stub) for ${filePath}`);
        return `vk_stub_token_${Date.now()}`;
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
        let payload = null;

        console.log(`[VK HANDLER] Message from ${userId}: "${text}"`);

        if (message.message?.payload) {
            try {
                const parsed = JSON.parse(message.message.payload);
                payload = parsed.payload || null;
            } catch (e) {}
        }

       const { VKAPI } = require('./platforms/vk');
const vkApi = new VKAPI();
vkVideo = await vkApi.uploadPrivateVideo(localFilePath, 'Урок');

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
// ОБРАБОТЧИКИ КОМАНД (используют sharedFunctions)
// ============================================================

async function handleStartCommand(chatId, vkApi) {
    const { checkUserHasPaidAccess } = sharedFunctions;
    const hasAccess = checkUserHasPaidAccess ? await checkUserHasPaidAccess(chatId) : false;

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
    const { showCourses } = sharedFunctions;
    if (showCourses) {
        await showCourses(chatId, vkApi);
    } else {
        await vkApi.sendMessage({
            chatId,
            text: '📚 Функция уроков временно недоступна.',
        });
    }
}

async function handleTextMessage(chatId, text, vkApi) {
    console.log(`[VK TEXT] chatId=${chatId}, text="${text}"`);
    
    const adminSession = adminSessions.get(chatId);
    
    // Если пользователь вводит пароль
    if (adminSession && adminSession.mode === 'awaiting_password') {
        console.log(`[VK TEXT] Processing admin password`);
        const { handleAdminPassword } = sharedFunctions;
        if (handleAdminPassword) {
            await handleAdminPassword(chatId, text, vkApi);
        } else {
            console.error('[VK TEXT] handleAdminPassword not found');
            await vkApi.sendMessage({
                chatId,
                text: '❌ Ошибка: обработчик пароля не найден',
            });
            adminSessions.delete(chatId);
        }
        return;
    }

    // Если пользователь уже в админ-режиме
    if (adminSession && adminSession.mode === 'admin') {
        console.log(`[VK TEXT] Admin mode active, forwarding to admin handler`);
        const { handleAdminCommand } = sharedFunctions;
        if (handleAdminCommand) {
            await handleAdminCommand(chatId, text, vkApi);
        }
        return;
    }

    // Обычное сообщение пользователя
    const { checkUserHasPaidAccess } = sharedFunctions;
    const hasAccess = checkUserHasPaidAccess ? await checkUserHasPaidAccess(chatId) : false;

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
async function handleCallback(chatId, payload, vkApi) {
    console.log(`[VK CALLBACK] chatId=${chatId}, payload=${payload}`);

    // 👇 СНАЧАЛА ПРОВЕРЯЕМ АДМИН-СЕССИЮ
    const adminSession = adminSessions.get(chatId);
    
    // Если пользователь уже в админ-режиме — ВСЕ callback идут в админ-обработчик
    if (adminSession && adminSession.mode === 'admin') {
        console.log(`[VK CALLBACK] Admin mode active, forwarding to admin handler`);
        const { handleAdminCallback } = sharedFunctions;
        if (handleAdminCallback) {
            await handleAdminCallback(chatId, payload, vkApi);
        } else {
            console.error('[VK CALLBACK] handleAdminCallback not found');
            await vkApi.sendMessage({
                chatId,
                text: '❌ Ошибка: админ-обработчик не найден',
            });
        }
        return;
    }

    // Если пользователь в процессе ввода пароля
    if (adminSession && adminSession.mode === 'awaiting_password') {
        console.log(`[VK CALLBACK] Awaiting password, ignoring callback`);
        await vkApi.sendMessage({
            chatId,
            text: '⏳ Введите пароль администратора сообщением.',
        });
        return;
    }

    // 👇 ТОЛЬКО ПОСЛЕ ПРОВЕРКИ АДМИН-СЕССИИ — обрабатываем вход
    if (payload === 'admin_panel' || payload === 'admin_login') {
        console.log(`[VK CALLBACK] Admin login requested`);
        const { showAdminLogin } = sharedFunctions;
        if (showAdminLogin) {
            await showAdminLogin(chatId, vkApi);
        }
        return;
    }

    // Остальные обработчики (пользовательские)
    console.log(`[VK CALLBACK] User callback: ${payload}`);
    const handlers = {
        'show_courses': async () => {
            const { showCourses } = sharedFunctions;
            if (showCourses) await showCourses(chatId, vkApi);
        },
        'show_help': async () => {
            await handleHelpCommand(chatId, vkApi);
        },
        'buy_access': async () => {
            const { handleBuyAccess } = sharedFunctions;
            if (handleBuyAccess) await handleBuyAccess(chatId, vkApi);
        },
    };

    if (handlers[payload]) {
        await handlers[payload]();
        return;
    }

    if (payload.startsWith('payment_check_')) {
        const { handlePaymentCheck } = sharedFunctions;
        const paymentId = payload.replace('payment_check_', '');
        if (handlePaymentCheck) await handlePaymentCheck(chatId, paymentId, vkApi);
        return;
    }

    if (payload.startsWith('lesson_')) {
        const { sendLessonToUser } = sharedFunctions;
        const lessonId = payload.replace('lesson_', '');
        if (sendLessonToUser) await sendLessonToUser(chatId, lessonId, vkApi);
        return;
    }

    if (payload.startsWith('test_') && !payload.startsWith('test_answer_')) {
        const { showTest } = sharedFunctions;
        const testId = payload.replace('test_', '');
        if (showTest) await showTest(chatId, testId, vkApi);
        return;
    }

    if (payload.startsWith('test_answer_')) {
        const { handleTestAnswer } = sharedFunctions;
        const withoutPrefix = payload.replace('test_answer_', '');
        const underscoreIndex = withoutPrefix.lastIndexOf('_');
        const testId = withoutPrefix.substring(0, underscoreIndex);
        const answerId = withoutPrefix.substring(underscoreIndex + 1);
        if (handleTestAnswer) await handleTestAnswer(chatId, testId, answerId, vkApi);
        return;
    }

    await vkApi.sendMessage({
        chatId,
        text: `✅ Вы выбрали: ${payload}`,
    });
}
// ============================================================
// ПОКАЗ АДМИН-ЛОГИНА
// ============================================================

async function showAdminLogin(chatId, vkApi) {
    console.log(`[VK] showAdminLogin called for ${chatId}`);
    
    // Проверяем, не залогинен ли уже
    const session = adminSessions.get(chatId);
    if (session && session.mode === 'admin') {
        const { showAdminDashboard } = sharedFunctions;
        if (showAdminDashboard) {
            await showAdminDashboard(chatId, vkApi);
        } else {
            await vkApi.sendMessage({
                chatId,
                text: '✅ Вы уже авторизованы как администратор.\n\nИспользуйте кнопки меню.',
            });
        }
        return;
    }

    // Запрашиваем пароль
    adminSessions.set(chatId, { mode: 'awaiting_password' });
    
    await vkApi.sendKeyboard({
        chatId,
        text: `🔐 **Введите пароль администратора**\n\nОтправьте пароль сообщением.`,
        buttons: [
            [{ text: '❌ Отмена', payload: 'show_courses' }]
        ],
    });
}

// ============================================================
// 👇 ДОБАВЬТЕ ФУНКЦИЮ СЮДА (ПОСЛЕ showAdminLogin)
// ============================================================

// ============================================================
// ОБРАБОТКА ПАРОЛЯ АДМИНА
// ============================================================

async function handleAdminPassword(chatId, password, vkApi) {
    console.log(`[VK] handleAdminPassword called for ${chatId}`);
    
    try {
        const bcrypt = require('bcryptjs');
        let admin = null;
        let database = require('../database');
        
        // Пробуем через PostgreSQL
        if (pgConnected && pgClient) {
            const result = await pgClient.query('SELECT * FROM admins');
            for (const a of result.rows) {
                if (await bcrypt.compare(password, a.password_hash)) {
                    admin = a;
                    break;
                }
            }
        } else {
            // Fallback на JSON
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
            await vkApi.sendMessage({
                chatId,
                text: '❌ **Неверный пароль!** Попробуйте снова через /admin',
                parseMode: 'markdown',
            });
            return;
        }
        
        // Сохраняем сессию
        adminSessions.set(chatId, {
            mode: 'admin',
            adminId: admin.id,
            login: admin.login,
            role: admin.role,
            context: 'dashboard'
        });
        
        await vkApi.sendMessage({
            chatId,
            text: `✅ **Добро пожаловать в админ-панель, ${admin.login}!**`,
            parseMode: 'markdown',
        });
        
        // Показываем админ-дашборд
        const { showAdminDashboard } = sharedFunctions;
        if (showAdminDashboard) {
            await showAdminDashboard(chatId, vkApi);
        } else {
            await vkApi.sendMessage({
                chatId,
                text: '❌ Ошибка: админ-дашборд не найден',
            });
        }
        
    } catch (error) {
        console.error('[VK] Error handling admin password:', error);
        adminSessions.delete(chatId);
        await vkApi.sendMessage({
            chatId,
            text: '❌ Ошибка при проверке пароля. Попробуйте позже.',
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
                return res.send(config.vk.confirmationToken || 'test');

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
    setPGClient,           // 👇 ДОБАВЬТЕ СЮДА
    handleAdminPassword,   // 👇 ДОБАВЬТЕ СЮДА
};
