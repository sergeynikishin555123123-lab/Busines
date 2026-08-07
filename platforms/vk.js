// platforms/vk.js - ПОЛНАЯ ИСПРАВЛЕННАЯ ВЕРСИЯ

const crypto = require('crypto');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../logger');
const database = require('../database');
const userService = require('../core/user');

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

    // ============================================================
    // ЗАГРУЗКА ПРИВАТНОГО ВИДЕО В VK
    // ============================================================
    
    async uploadPrivateVideo(filePath, lessonTitle) {
        try {
            console.log(`[VK] Uploading private video: ${filePath}`);
            
            if (!fs.existsSync(filePath)) {
                throw new Error(`File not found: ${filePath}`);
            }

            console.log('[VK] Getting upload server...');
            const uploadResponse = await this.client.post('/video.save', null, {
                params: {
                    group_id: this.groupId,
                    access_token: this.token,
                    v: this.apiVersion,
                }
            });
            
            const uploadData = uploadResponse.data.response;
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
            
            console.log('[VK] Saving video with private access...');
            const data = uploadResult.data;
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
            console.log(`[VK] ✅ Video saved: video${video.owner_id}_${video.video_id}`);
            
            return {
                owner_id: video.owner_id,
                video_id: video.video_id,
                access_key: video.access_key || '',
            };
            
        } catch (error) {
            console.error('[VK] uploadPrivateVideo error:', error.message);
            if (error.response) {
                console.error('[VK] Response:', error.response.data);
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
        text: `📝 Я получил ваше сообщение.

Что хотите сделать дальше?`,
        buttons,
    });
}

// ============================================================
// ОБРАБОТКА CALLBACK
// ============================================================

async function handleCallback(chatId, payload, vkApi) {
    console.log(`[VK CALLBACK] chatId=${chatId}, payload=${payload}`);

    if (payload === 'admin_panel' || payload === 'admin_login') {
        const { showAdminLogin } = sharedFunctions;
        if (showAdminLogin) {
            await showAdminLogin(chatId, vkApi);
        }
        return;
    }

    const adminSession = adminSessions.get(chatId);
    if (adminSession && adminSession.mode === 'admin') {
        const { handleAdminCallback } = sharedFunctions;
        if (handleAdminCallback) {
            await handleAdminCallback(chatId, payload, vkApi);
        }
        return;
    }

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
    const { showAdminLogin } = sharedFunctions;
    if (showAdminLogin) {
        await showAdminLogin(chatId, vkApi);
    } else {
        await vkApi.sendMessage({
            chatId,
            text: `🔐 Админ-панель\n\nВведите /admin для входа.`,
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
};
