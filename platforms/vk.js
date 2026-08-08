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
    // ОТПРАВКА ВИДЕО/ФАЙЛОВ (заглушки для VK)
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
    // ЗАГРУЗКА ВИДЕО В VK
    // ============================================================

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
            const uploadResponse = await this.client.post('/video.save', null, {
                params: {
                    group_id: this.groupId,
                    access_token: this.token,
                    v: this.apiVersion,
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
// ОБРАБОТЧИКИ КОМАНД
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
        text: `🔐 **Введите пароль администратора**\n\nОтправьте пароль сообщением.`,
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
            created_at: Date.now()
        });

        console.log(`[VK] ✅ Admin session saved for ${chatId}:`, adminSessions.get(chatId));

        await vkApi.sendMessage({
            chatId: chatId,
            text: `✅ **Добро пожаловать в админ-панель, ${admin.login}!**`,
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
            const coursesRes = await pgClient.query('SELECT * FROM courses');
            courses = coursesRes.rows || [];
            const lessonsRes = await pgClient.query('SELECT * FROM lessons');
            lessons = lessonsRes.rows || [];
            const usersRes = await pgClient.query('SELECT * FROM users');
            users = usersRes.rows || [];
        } else {
            courses = await courseService.getAllCourses(false);
            lessons = database.readTable('lessons') || [];
            users = database.readTable('users') || [];
        }
        
        const text = `🔐 **Админ-панель**\n\n` +
            `👤 ${session.login} (${session.role})\n` +
            `📚 Курсов: ${courses.length}\n` +
            `📖 Уроков: ${lessons.length}\n` +
            `👥 Пользователей: ${users.length}\n\n` +
            `Выберите действие:`;
        
        const buttons = [
            [{ text: '📖 Создать урок', payload: 'admin_create_lesson' }],
            [{ text: '📝 Редактировать уроки', payload: 'admin_edit_lessons' }],
            [{ text: '📊 Статистика', payload: 'admin_stats' }],
            [{ text: '🚪 Выйти', payload: 'admin_logout' }]
        ];
        
        await vkApi.sendKeyboard({ chatId, text, buttons });
    } catch (error) {
        console.error('[VK] Error showing dashboard:', error);
        await vkApi.sendMessage({
            chatId: chatId,
            text: '❌ Ошибка при загрузке админ-панели',
        });
    }
}

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
            text: `📝 **Создание урока: "${text}"**\n\nВведите описание урока:`,
        });
        return;
    }
    
    if (context === 'creating_lesson_desc') {
        const title = session.lessonTitle;
        const description = text;
        
        let courses = await courseService.getAllCourses(false);
        let courseId = courses?.[0]?.id;
        
        if (!courseId) {
            const course = await courseService.createCourse({
                title: 'Основной курс',
                description: 'Все уроки',
                price: 0,
                isActive: true,
            });
            courseId = course.id;
        }
        
        const lesson = await lessonService.createLesson({
            courseId: courseId,
            title: title,
            description: description,
            orderNumber: 0,
            isFree: true,
        });
        
        session.context = 'dashboard';
        session.lessonId = lesson.id;
        
        await vkApi.sendMessage({
            chatId,
            text: `✅ **Урок создан!**\n\n📖 ${lesson.title}\n\nТеперь вы можете загрузить видео или файл.`,
        });
        await showAdminDashboard(chatId, vkApi);
        return;
    }
    
    if (context === 'editing_lesson_title') {
        const lessonId = session.lessonId;
        if (lessonId) {
            await lessonService.updateLesson(lessonId, { title: text });
            session.context = 'dashboard';
            await vkApi.sendMessage({
                chatId,
                text: `✅ Название обновлено: "${text}"`,
            });
            await showAdminDashboard(chatId, vkApi);
        }
        return;
    }
    
    if (context === 'editing_lesson_desc') {
        const lessonId = session.lessonId;
        if (lessonId) {
            await lessonService.updateLesson(lessonId, { description: text });
            session.context = 'dashboard';
            await vkApi.sendMessage({
                chatId,
                text: '✅ Описание обновлено.',
            });
            await showAdminDashboard(chatId, vkApi);
        }
        return;
    }
    
    if (context === 'editing_test') {
        await handleTestCreation(chatId, text, vkApi);
        return;
    }
    
    await vkApi.sendMessage({
        chatId,
        text: '❓ Неизвестная команда. Используйте кнопки меню.',
    });
}

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
            text: '🚪 Вы вышли из админ-панели.',
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
        await vkApi.sendMessage({
            chatId,
            text: '📝 **Создание урока**\n\nВведите название урока:',
        });
        return;
    }
    
    if (payload === 'admin_edit_lessons') {
        let lessons = database.readTable('lessons') || [];
        
        if (lessons.length === 0) {
            await vkApi.sendMessage({
                chatId,
                text: '❌ Нет созданных уроков. Создайте урок через "Создать урок".',
            });
            return;
        }
        
        let text = '📝 **Редактирование уроков**\n\nВыберите урок:\n\n';
        const buttons = [];
        for (const lesson of lessons) {
            text += `📖 ${lesson.title}\n`;
            buttons.push([{ text: `✏️ ${lesson.title.substring(0, 25)}`, payload: `admin_edit_lesson_${lesson.id}` }]);
        }
        buttons.push([{ text: '⬅️ Назад', payload: 'admin_back' }]);
        
        await vkApi.sendKeyboard({ chatId, text, buttons });
        return;
    }
    
    if (payload.startsWith('admin_edit_lesson_')) {
        const lessonId = payload.replace('admin_edit_lesson_', '');
        const lesson = await lessonService.getLessonWithFiles(lessonId);
        if (!lesson) {
            await vkApi.sendMessage({ chatId, text: '❌ Урок не найден' });
            return;
        }
        
        session.lessonId = lessonId;
        session.context = 'editing_lesson';
        
        const hasVideo = lesson.files?.find(f => f.type === 'video');
        const hasFile = lesson.files?.find(f => f.type === 'file');
        
        const text = `📝 **${lesson.title}**\n\n` +
            `📝 Описание: ${lesson.description || 'Нет'}\n` +
            `🆓 ${lesson.is_free ? 'Бесплатный' : 'Платный'}\n` +
            `🎬 Видео: ${hasVideo ? '✅ Есть' : '❌ Нет'}\n` +
            `📎 Файлы: ${hasFile ? '✅ Есть' : '❌ Нет'}\n\n` +
            `Выберите действие:`;
        
        const buttons = [
            [{ text: '✏️ Изменить название', payload: `admin_lesson_edit_title_${lessonId}` }],
            [{ text: '✏️ Изменить описание', payload: `admin_lesson_edit_desc_${lessonId}` }],
            [{ text: '🎬 Загрузить видео', payload: `admin_lesson_video_${lessonId}` }],
            [{ text: '📎 Загрузить файл', payload: `admin_lesson_file_${lessonId}` }],
            [{ text: lesson.is_free ? '🔒 Сделать платным' : '🆓 Сделать бесплатным', payload: `admin_lesson_toggle_free_${lessonId}` }],
            [{ text: '📝 Редактировать тест', payload: `admin_lesson_edit_test_${lessonId}` }],
            [{ text: '🗑️ Удалить урок', payload: `admin_lesson_delete_${lessonId}` }],
            [{ text: '⬅️ Назад', payload: 'admin_edit_lessons' }]
        ];
        
        await vkApi.sendKeyboard({ chatId, text, buttons });
        return;
    }
    
    if (payload.startsWith('admin_lesson_edit_title_')) {
        const lessonId = payload.replace('admin_lesson_edit_title_', '');
        session.lessonId = lessonId;
        session.context = 'editing_lesson_title';
        await vkApi.sendMessage({
            chatId,
            text: '✏️ Введите новое название урока:',
        });
        return;
    }
    
    if (payload.startsWith('admin_lesson_edit_desc_')) {
        const lessonId = payload.replace('admin_lesson_edit_desc_', '');
        session.lessonId = lessonId;
        session.context = 'editing_lesson_desc';
        await vkApi.sendMessage({
            chatId,
            text: '✏️ Введите новое описание урока:',
        });
        return;
    }
    
    if (payload.startsWith('admin_lesson_video_')) {
        const lessonId = payload.replace('admin_lesson_video_', '');
        session.lessonId = lessonId;
        session.context = 'uploading_video';
        await vkApi.sendMessage({
            chatId,
            text: '🎬 **Загрузка видео**\n\nОтправьте видео файлом в этот чат.\n\nПоддерживаются: MP4, MOV, WEBM\nМаксимальный размер: 250MB',
        });
        return;
    }
    
    if (payload.startsWith('admin_lesson_file_')) {
        const lessonId = payload.replace('admin_lesson_file_', '');
        session.lessonId = lessonId;
        session.context = 'uploading_file';
        await vkApi.sendMessage({
            chatId,
            text: '📎 **Загрузка файла**\n\nОтправьте файл в этот чат.\n\nПоддерживаются: PDF, DOCX, ZIP, изображения',
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
            await handleAdminCallback(chatId, `admin_edit_lesson_${lessonId}`, vkApi);
        }
        return;
    }
    
    if (payload.startsWith('admin_lesson_edit_test_')) {
        const lessonId = payload.replace('admin_lesson_edit_test_', '');
        session.lessonId = lessonId;
        session.context = 'editing_test';
        
        const test = await lessonService.getLessonTest(lessonId);
        if (test) {
            let text = `📝 **Редактирование теста**\n\n`;
            text += `Вопрос: ${test.question}\n\n`;
            text += 'Варианты ответов:\n';
            test.answers.forEach((a, i) => {
                text += `${i + 1}. ${a.answer} ${a.is_correct ? '✅' : ''}\n`;
            });
            text += '\nОтправьте новый тест в формате:\n';
            text += 'Вопрос: Текст вопроса\n';
            text += '1. Ответ 1 (правильный)\n';
            text += '2. Ответ 2\n';
            text += '3. Ответ 3\n';
            text += '4. Ответ 4';
            await vkApi.sendMessage({ chatId, text });
        } else {
            await vkApi.sendMessage({
                chatId,
                text: '📝 **Создание теста**\n\nОтправьте тест в формате:\n\nВопрос: Текст вопроса\n1. Ответ 1 (правильный)\n2. Ответ 2\n3. Ответ 3\n4. Ответ 4',
            });
        }
        return;
    }
    
    if (payload.startsWith('admin_lesson_delete_')) {
        const lessonId = payload.replace('admin_lesson_delete_', '');
        const lesson = await lessonService.getLessonById(lessonId);
        if (lesson) {
            await vkApi.sendKeyboard({
                chatId,
                text: `⚠️ **Удалить урок "${lesson.title}"?**`,
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
            text: '🗑️ Урок удален.',
        });
        await handleAdminCallback(chatId, 'admin_edit_lessons', vkApi);
        return;
    }
    
    if (payload === 'admin_stats') {
        let users = [], lessons = [], courses = [], payments = [], progress = [];
        
        if (pgConnected && pgClient) {
            const usersRes = await pgClient.query('SELECT * FROM users');
            users = usersRes.rows || [];
            const lessonsRes = await pgClient.query('SELECT * FROM lessons');
            lessons = lessonsRes.rows || [];
            const coursesRes = await pgClient.query('SELECT * FROM courses');
            courses = coursesRes.rows || [];
            const paymentsRes = await pgClient.query('SELECT * FROM payments WHERE status = $1', ['success']);
            payments = paymentsRes.rows || [];
            const progressRes = await pgClient.query('SELECT * FROM progress WHERE status = $1', ['completed']);
            progress = progressRes.rows || [];
        } else {
            users = database.readTable('users') || [];
            lessons = database.readTable('lessons') || [];
            courses = await courseService.getAllCourses(false);
            payments = (database.readTable('payments') || []).filter(p => p.status === 'success');
            progress = (database.readTable('progress') || []).filter(p => p.status === 'completed');
        }
        
        const text = `📊 **Статистика**\n\n` +
            `👤 Пользователей: ${users.length}\n` +
            `📚 Курсов: ${courses.length}\n` +
            `📖 Уроков: ${lessons.length}\n` +
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

async function handleTestCreation(chatId, text, vkApi) {
    try {
        const session = adminSessions.get(chatId);
        if (!session || !session.lessonId) {
            await vkApi.sendMessage({ chatId, text: '❌ Сессия потеряна' });
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
                                answerText.endsWith('✅');
                const cleanAnswer = answerText
                    .replace(/\s*\(правильный\)\s*/i, '')
                    .replace(/\s*\(верный\)\s*/i, '')
                    .replace(/\s*✅\s*$/, '')
                    .trim();
                if (cleanAnswer) {
                    answers.push({ text: cleanAnswer, isCorrect });
                }
            }
        }

        if (!question || answers.length < 2) {
            await vkApi.sendMessage({
                chatId,
                text: '❌ Неверный формат. Нужно: вопрос и минимум 2 варианта ответа.\n\nПример:\nВопрос: Что такое 2+2?\n1. 3\n2. 4 (правильный)\n3. 5\n4. 6',
            });
            return;
        }

        await lessonService.createTest(lessonId, {
            question: question,
            answers: answers
        });

        session.context = 'editing_lesson';
        await vkApi.sendMessage({
            chatId,
            text: `✅ **Тест сохранен!**\n\nВопрос: ${question}\nКоличество ответов: ${answers.length}`,
        });
        
        await handleAdminCallback(chatId, `admin_edit_lesson_${lessonId}`, vkApi);
    } catch (error) {
        console.error('[VK TEST] Error:', error);
        await vkApi.sendMessage({
            chatId,
            text: `❌ Ошибка: ${error.message}`,
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
    setPGClient,
    handleAdminPassword,
    showAdminLogin,
    showAdminDashboard,
    handleAdminCallback,
    handleAdminCommand,
    handleTestCreation,
};
