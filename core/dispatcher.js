// core/dispatcher.js - ПОЛНАЯ ИСПРАВЛЕННАЯ ВЕРСИЯ
const database = require('../database');
const logger = require('../logger');
const courseService = require('./course');
const lessonService = require('./lesson');
const userService = require('./user');
const progressService = require('./progress');
const paymentService = require('./payment');
const MaxAPI = require('../platforms/max');
const path = require('path');
const fs = require('fs');
const axios = require('axios');

// Директория для загрузок (из переменной окружения)
const UPLOADS_DIR = process.env.UPLOADS_DIR || '/tmp/uploads';

class Dispatcher {
    constructor() {
        this.handlers = new Map();
        this.adminSessions = new Map(); // Хранилище сессий администраторов
        this.registerHandlers();
    }

    registerHandlers() {
        this.handlers.set('/start', this.handleStart.bind(this));
        this.handlers.set('/help', this.handleHelp.bind(this));
        this.handlers.set('/admin', this.handleAdminLogin.bind(this));
    }

    // ============================================================
    // ГЛАВНЫЙ МЕТОД
    // ============================================================
    async handleMessage(platform, userId, message, payload = null) {
        try {
            const user = await userService.getOrCreateUser(platform, userId, {
                firstName: message?.from?.first_name || '',
                lastName: message?.from?.last_name || '',
                username: message?.from?.username || '',
            });

            if (payload) {
                return await this.handleCallback(platform, user, payload);
            }

            if (message && message.startsWith('/')) {
                const command = message.split(' ')[0].toLowerCase();
                const handler = this.handlers.get(command);
                if (handler) {
                    return await handler(platform, user, message);
                }
            }

            return await this.handleText(platform, user, message);
        } catch (error) {
            logger.error({ err: error, platform, userId }, 'Dispatcher error');
            throw error;
        }
    }

    // ============================================================
    // КОМАНДЫ
    // ============================================================
    async handleStart(platform, user, message) {
        const maxApi = new MaxAPI();
        const chatId = user.platform_user_id;
        const text = '👋 **Добро пожаловать в обучающий бот!**\n\nВыберите действие:';
        const buttons = [
            [{ type: 'callback', text: '📚 Уроки', payload: 'show_lessons' }],
            [{ type: 'callback', text: '💰 Купить доступ', payload: 'buy_access' }],
            [{ type: 'callback', text: '❓ Помощь', payload: 'show_help' }]
        ];
        await maxApi.sendKeyboard({ chatId, text, buttons, parseMode: 'markdown' });
        await this.logUserAction(user.id, 'start');
    }

    async handleHelp(platform, user, message) {
        const maxApi = new MaxAPI();
        const chatId = user.platform_user_id;
        const text = `📚 **Помощь**

/start - Главное меню
/help - Показать это сообщение
/admin - Админ-панель

**Как пользоваться:**
1. Изучайте бесплатные уроки
2. Купите доступ ко всем урокам
3. Проходите тесты после каждого урока`;
        await maxApi.sendMessage({ chatId, text, parseMode: 'markdown' });
    }

    // ============================================================
    // АДМИН-ПАНЕЛЬ (в боте)
    // ============================================================
    async handleAdminLogin(platform, user, message) {
        const maxApi = new MaxAPI();
        const chatId = user.platform_user_id;
        const session = this.adminSessions.get(chatId);

        if (session && session.mode === 'admin') {
            return await this.showAdminDashboard(platform, user);
        }

        this.adminSessions.set(chatId, { mode: 'awaiting_password' });
        await maxApi.sendMessage({
            chatId,
            text: '🔐 **Введите пароль администратора**\n\nОтправьте пароль сообщением.',
            parseMode: 'markdown'
        });
    }

    async handleAdminPassword(platform, user, password) {
        const maxApi = new MaxAPI();
        const chatId = user.platform_user_id;
        const admins = database.readTable('admins');
        const bcrypt = require('bcryptjs');

        let admin = null;
        for (const a of admins) {
            if (await bcrypt.compare(password, a.password_hash)) {
                admin = a;
                break;
            }
        }

        if (!admin) {
            this.adminSessions.delete(chatId);
            await maxApi.sendMessage({
                chatId,
                text: '❌ **Неверный пароль!** Попробуйте снова через /admin',
                parseMode: 'markdown'
            });
            return;
        }

        this.adminSessions.set(chatId, {
            mode: 'admin',
            adminId: admin.id,
            login: admin.login,
            role: admin.role,
            context: 'dashboard'
        });

        await maxApi.sendMessage({
            chatId,
            text: `✅ **Добро пожаловать в админ-панель, ${admin.login}!**`,
            parseMode: 'markdown'
        });
        await this.showAdminDashboard(platform, user);
    }

    async showAdminDashboard(platform, user) {
        const maxApi = new MaxAPI();
        const chatId = user.platform_user_id;
        const session = this.adminSessions.get(chatId);
        if (!session || session.mode !== 'admin') {
            return await this.handleAdminLogin(platform, user, '');
        }

        const courses = await courseService.getAllCourses(false);
        const lessons = database.readTable('lessons');
        const users = database.readTable('users');

        const text = `🔐 **Админ-панель**

👤 ${session.login} (${session.role})
📚 Всего курсов: ${courses.length}
📖 Всего уроков: ${lessons.length}
👤 Пользователей: ${users.length}

Выберите действие:`;

        const buttons = [
            [{ type: 'callback', text: '📖 Создать урок', payload: 'admin_create_lesson' }],
            [{ type: 'callback', text: '✏️ Редактировать уроки', payload: 'admin_edit_lessons' }],
            [{ type: 'callback', text: '📊 Статистика', payload: 'admin_stats' }],
            [{ type: 'callback', text: '🚪 Выйти', payload: 'admin_logout' }]
        ];
        await maxApi.sendKeyboard({ chatId, text, buttons, parseMode: 'markdown' });
    }

    // ============================================================
    // ОБРАБОТКА АДМИН-КОМАНД
    // ============================================================
    async handleAdminCallback(platform, user, payload) {
        const maxApi = new MaxAPI();
        const chatId = user.platform_user_id;
        const session = this.adminSessions.get(chatId);

        if (!session || session.mode !== 'admin') {
            await this.handleAdminLogin(platform, user, '');
            return;
        }

        // Выход
        if (payload === 'admin_logout') {
            this.adminSessions.delete(chatId);
            await maxApi.sendMessage({ chatId, text: '🚪 Вы вышли из админ-панели.', parseMode: 'markdown' });
            return;
        }

        // Назад
        if (payload === 'admin_back') {
            await this.showAdminDashboard(platform, user);
            return;
        }

        // Статистика
        if (payload === 'admin_stats') {
            const users = database.readTable('users');
            const lessons = database.readTable('lessons');
            const courses = await courseService.getAllCourses(false);
            const payments = database.readTable('payments');
            const progress = database.readTable('progress');
            const courseAccess = database.readTable('user_course_access');

            const text = `📊 **Статистика**

👤 Пользователей: ${users.length}
📚 Курсов: ${courses.length}
📖 Уроков: ${lessons.length}
✅ Пройдено уроков: ${progress.filter(p => p.status === 'completed').length}
💳 Оплат: ${payments.filter(p => p.status === 'success').length}
💰 Выручка: ${payments.filter(p => p.status === 'success').reduce((s, p) => s + (p.amount || 0), 0)} ₽
🔓 Купили доступ: ${courseAccess.length}`;

            const buttons = [[{ type: 'callback', text: '⬅️ Назад', payload: 'admin_back' }]];
            await maxApi.sendKeyboard({ chatId, text, buttons, parseMode: 'markdown' });
            return;
        }

        // Создание урока
        if (payload === 'admin_create_lesson') {
            session.context = 'creating_lesson';
            await maxApi.sendMessage({
                chatId,
                text: '📝 **Создание урока**\n\nВведите **название** урока:',
                parseMode: 'markdown'
            });
            return;
        }

        // Список уроков для редактирования
        if (payload === 'admin_edit_lessons') {
            const lessons = database.readTable('lessons');
            if (lessons.length === 0) {
                await maxApi.sendMessage({
                    chatId,
                    text: '❌ Нет созданных уроков. Создайте урок через "Создать урок".',
                    parseMode: 'markdown'
                });
                return;
            }
            const buttons = lessons.map(l => [
                { type: 'callback', text: `✏️ ${l.title.substring(0, 30)}`, payload: `admin_edit_lesson_${l.id}` }
            ]);
            buttons.push([{ type: 'callback', text: '⬅️ Назад', payload: 'admin_back' }]);
            await maxApi.sendKeyboard({
                chatId,
                text: '📖 **Выберите урок для редактирования:**',
                buttons,
                parseMode: 'markdown'
            });
            return;
        }

        // Редактирование конкретного урока
        if (payload.startsWith('admin_edit_lesson_')) {
            const lessonId = payload.replace('admin_edit_lesson_', '');
            session.context = 'editing_lesson';
            session.lessonId = lessonId;
            await this.showEditLessonForm(chatId, lessonId, maxApi);
            return;
        }

        // Изменить название
        if (payload.startsWith('admin_lesson_edit_title_')) {
            const lessonId = payload.replace('admin_lesson_edit_title_', '');
            session.context = 'editing_title';
            session.lessonId = lessonId;
            await maxApi.sendMessage({
                chatId,
                text: '✏️ **Введите новое название урока:**',
                parseMode: 'markdown'
            });
            return;
        }

        // Изменить описание
        if (payload.startsWith('admin_lesson_edit_desc_')) {
            const lessonId = payload.replace('admin_lesson_edit_desc_', '');
            session.context = 'editing_desc';
            session.lessonId = lessonId;
            await maxApi.sendMessage({
                chatId,
                text: '✏️ **Введите новое описание урока:**',
                parseMode: 'markdown'
            });
            return;
        }

        // Загрузить видео
        if (payload.startsWith('admin_lesson_upload_video_')) {
            const lessonId = payload.replace('admin_lesson_upload_video_', '');
            session.context = 'uploading_video';
            session.lessonId = lessonId;
            await maxApi.sendMessage({
                chatId,
                text: '🎬 **Загрузка видео**\n\nОтправьте видео файлом в этот чат.\n\nПоддерживаются: MP4, WebM, MOV\nМаксимальный размер: 250MB',
                parseMode: 'markdown'
            });
            return;
        }

        // Загрузить файл
        if (payload.startsWith('admin_lesson_upload_file_')) {
            const lessonId = payload.replace('admin_lesson_upload_file_', '');
            session.context = 'uploading_file';
            session.lessonId = lessonId;
            await maxApi.sendMessage({
                chatId,
                text: '📎 **Загрузка файла**\n\nОтправьте файл в этот чат.\n\nПоддерживаются: PDF, DOCX, ZIP, изображения\nМаксимальный размер: 250MB',
                parseMode: 'markdown'
            });
            return;
        }

        // Переключить доступ (бесплатный/платный)
        if (payload.startsWith('admin_lesson_toggle_free_')) {
            const lessonId = payload.replace('admin_lesson_toggle_free_', '');
            const lesson = await lessonService.getLessonById(lessonId);
            if (lesson) {
                await lessonService.updateLesson(lessonId, { isFree: !lesson.is_free });
                await maxApi.sendMessage({
                    chatId,
                    text: `🔄 Доступ изменен на: ${!lesson.is_free ? '🆓 Бесплатный' : '💰 Платный'}`,
                    parseMode: 'markdown'
                });
                await this.showEditLessonForm(chatId, lessonId, maxApi);
            }
            return;
        }

        // Редактировать тест
        if (payload.startsWith('admin_lesson_edit_test_')) {
            const lessonId = payload.replace('admin_lesson_edit_test_', '');
            session.context = 'editing_test';
            session.lessonId = lessonId;
            
            const test = await lessonService.getLessonTest(lessonId);
            if (test) {
                // Если тест есть - показываем его
                let text = `📝 **Редактирование теста**\n\nВопрос: ${test.question}\n\n`;
                text += 'Варианты ответов:\n';
                test.answers.forEach((a, i) => {
                    text += `${i + 1}. ${a.answer} ${a.is_correct ? '✅' : ''}\n`;
                });
                text += '\nЧтобы изменить тест, отправьте новый вопрос и ответы в формате:\n';
                text += 'Вопрос: Текст вопроса\n';
                text += '1. Ответ 1 (правильный)\n';
                text += '2. Ответ 2\n';
                text += '3. Ответ 3\n';
                text += '4. Ответ 4\n';
                await maxApi.sendMessage({ chatId, text, parseMode: 'markdown' });
            } else {
                await maxApi.sendMessage({
                    chatId,
                    text: '📝 **Создание теста**\n\nОтправьте вопрос и ответы в формате:\n\nВопрос: Текст вопроса\n1. Ответ 1 (правильный)\n2. Ответ 2\n3. Ответ 3\n4. Ответ 4',
                    parseMode: 'markdown'
                });
            }
            return;
        }

        // Удалить урок
        if (payload.startsWith('admin_lesson_delete_')) {
            const lessonId = payload.replace('admin_lesson_delete_', '');
            const lesson = await lessonService.getLessonById(lessonId);
            if (lesson) {
                await lessonService.deleteLesson(lessonId);
                await maxApi.sendMessage({
                    chatId,
                    text: `🗑️ Урок "${lesson.title}" удален.`,
                    parseMode: 'markdown'
                });
                // Показываем список уроков
                const lessons = database.readTable('lessons');
                if (lessons.length === 0) {
                    await this.showAdminDashboard(platform, user);
                } else {
                    const buttons = lessons.map(l => [
                        { type: 'callback', text: `✏️ ${l.title.substring(0, 30)}`, payload: `admin_edit_lesson_${l.id}` }
                    ]);
                    buttons.push([{ type: 'callback', text: '⬅️ Назад', payload: 'admin_back' }]);
                    await maxApi.sendKeyboard({
                        chatId,
                        text: '📖 **Выберите урок для редактирования:**',
                        buttons,
                        parseMode: 'markdown'
                    });
                }
            }
            return;
        }

        // Обработка теста из текстового сообщения
        if (session.context === 'editing_test') {
            await this.handleTestCreation(chatId, message, maxApi);
            return;
        }

        await this.showAdminDashboard(platform, user);
    }

    // ============================================================
    // ОБРАБОТКА СОЗДАНИЯ/РЕДАКТИРОВАНИЯ ТЕСТА
    // ============================================================
    async handleTestCreation(chatId, text, maxApi) {
        try {
            const session = this.adminSessions.get(chatId);
            if (!session || !session.lessonId) {
                await maxApi.sendMessage({ chatId, text: '❌ Сессия потеряна', parseMode: 'markdown' });
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
                await maxApi.sendMessage({
                    chatId,
                    text: '❌ Неверный формат. Нужно: вопрос и минимум 2 варианта ответа.\n\nПример:\nВопрос: Что такое 2+2?\n1. 3\n2. 4 (правильный)\n3. 5\n4. 6',
                    parseMode: 'markdown'
                });
                return;
            }

            // Создаем или обновляем тест
            await lessonService.createTest(lessonId, {
                question: question,
                answers: answers
            });

            await maxApi.sendMessage({
                chatId,
                text: `✅ **Тест сохранен!**\n\nВопрос: ${question}\nКоличество ответов: ${answers.length}`,
                parseMode: 'markdown'
            });

            session.context = 'editing_lesson';
            await this.showEditLessonForm(chatId, lessonId, maxApi);
        } catch (error) {
            console.error('[TEST] Error:', error);
            await maxApi.sendMessage({
                chatId,
                text: `❌ Ошибка: ${error.message}`,
                parseMode: 'markdown'
            });
        }
    }

    // ============================================================
    // ФОРМА РЕДАКТИРОВАНИЯ УРОКА
    // ============================================================
    async showEditLessonForm(chatId, lessonId, maxApi) {
        const lesson = await lessonService.getLessonWithFiles(lessonId);
        if (!lesson) {
            await maxApi.sendMessage({ chatId, text: '❌ Урок не найден', parseMode: 'markdown' });
            return;
        }

        const files = await lessonService.getLessonFiles(lessonId);
        const videoFile = files.find(f => f.type === 'video');
        const otherFiles = files.filter(f => f.type !== 'video');

        let text = `✏️ **Редактирование урока: ${lesson.title}**

📝 Название: ${lesson.title}
📄 Описание: ${lesson.description || 'Нет'}
🎬 Видео: ${videoFile ? '✅ Загружено' : '❌ Нет'}
📎 Файлы: ${otherFiles.length}
🆓 ${lesson.is_free ? 'Бесплатный' : 'Платный'}

Выберите действие:`;

        const buttons = [
            [{ type: 'callback', text: '✏️ Изменить название', payload: `admin_lesson_edit_title_${lessonId}` }],
            [{ type: 'callback', text: '✏️ Изменить описание', payload: `admin_lesson_edit_desc_${lessonId}` }],
            [{ type: 'callback', text: '🎬 Загрузить видео', payload: `admin_lesson_upload_video_${lessonId}` }],
            [{ type: 'callback', text: '📎 Загрузить файл', payload: `admin_lesson_upload_file_${lessonId}` }],
            [{ type: 'callback', text: '🔄 Переключить доступ', payload: `admin_lesson_toggle_free_${lessonId}` }],
            [{ type: 'callback', text: '📝 Редактировать тест', payload: `admin_lesson_edit_test_${lessonId}` }],
            [{ type: 'callback', text: '🗑️ Удалить урок', payload: `admin_lesson_delete_${lessonId}` }],
            [{ type: 'callback', text: '⬅️ Назад', payload: 'admin_edit_lessons' }]
        ];
        await maxApi.sendKeyboard({ chatId, text, buttons, parseMode: 'markdown' });
    }

    // ============================================================
    // ОБРАБОТКА ВЛОЖЕНИЙ ОТ АДМИНА
    // ============================================================
    async handleAdminAttachment(chatId, attachments) {
        const maxApi = new MaxAPI();
        try {
            const session = this.adminSessions.get(chatId);
            if (!session || session.mode !== 'admin') {
                console.log('[ADMIN] Not admin session');
                return;
            }

            const lessonId = session.lessonId;
            if (!lessonId) {
                await maxApi.sendMessage({
                    chatId: chatId,
                    text: '❌ Не найден урок. Откройте урок заново через админ-панель.',
                    parseMode: 'markdown'
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
                        text: `✅ **Файл загружен!**\n\n📎 ${fileName}`,
                        parseMode: 'markdown'
                    });

                    await this.showEditLessonForm(chatId, lessonId, maxApi);
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

                        const tempDir = path.join(UPLOADS_DIR, 'temp');
                        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
                        
                        const tempPath = path.join(tempDir, `${Date.now()}-${fileName}`);
                        fs.writeFileSync(tempPath, Buffer.from(response.data));

                        const maxApi2 = new MaxAPI();
                        const token = await maxApi2.uploadFile(tempPath, 'file');
                        
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
                            text: `✅ **Файл загружен!**\n\n📎 ${fileName}`,
                            parseMode: 'markdown'
                        });

                        await this.showEditLessonForm(chatId, lessonId, maxApi);
                        return;
                    } catch (error) {
                        console.error('[ADMIN] Error downloading file:', error.message);
                        await maxApi.sendMessage({
                            chatId: chatId,
                            text: `❌ Ошибка загрузки файла: ${error.message}`,
                            parseMode: 'markdown'
                        });
                        return;
                    }
                }
            }

            await maxApi.sendMessage({
                chatId: chatId,
                text: '❌ Не удалось обработать вложение. Отправьте файл как вложение.',
                parseMode: 'markdown'
            });
        } catch (error) {
            console.error('[ADMIN] Error handling attachment:', error);
            await maxApi.sendMessage({
                chatId: chatId,
                text: `❌ Ошибка: ${error.message}`,
                parseMode: 'markdown'
            });
        }
    }

    // ============================================================
    // ПОКАЗ УРОКОВ
    // ============================================================
    async showLessons(platform, user) {
        const maxApi = new MaxAPI();
        const chatId = user.platform_user_id;

        const hasAccess = await courseService.checkUserCourseAccess(user.id, 'course_1');

        let lessons;
        if (hasAccess) {
            lessons = await courseService.getCourseLessons('course_1');
        } else {
            lessons = await courseService.getFreeLessons();
            lessons = lessons.filter(l => l.course_id === 'course_1');
        }

        if (!lessons || lessons.length === 0) {
            await maxApi.sendMessage({
                chatId,
                text: hasAccess ? '❌ В курсе пока нет уроков.' : '📚 **Бесплатные уроки**\n\nПока нет бесплатных уроков. Купите доступ, чтобы открыть все уроки!',
                parseMode: 'markdown'
            });
            return;
        }

        let text = hasAccess ? '📚 **Все уроки**' : '📚 **Бесплатные уроки**';
        const buttons = [];
        for (const lesson of lessons) {
            buttons.push([
                { type: 'callback', text: `📖 ${lesson.title}`, payload: `lesson_${lesson.id}` }
            ]);
        }
        buttons.push([{ type: 'callback', text: '⬅️ Главное меню', payload: 'main_menu' }]);

        await maxApi.sendKeyboard({ chatId, text, buttons, parseMode: 'markdown' });
    }

    // ============================================================
    // ПОКАЗ УРОКА
    // ============================================================
    async showLesson(platform, user, lessonId) {
        const maxApi = new MaxAPI();
        const chatId = user.platform_user_id;
        const lesson = await lessonService.getLessonWithFiles(lessonId);

        if (!lesson) {
            await maxApi.sendMessage({ chatId, text: '❌ Урок не найден', parseMode: 'markdown' });
            return;
        }

        await lessonService.recordLessonView(user.id, lessonId);

        // 1. Описание
        let text = `📖 **${lesson.title}**\n\n${lesson.description || 'Описание отсутствует.'}`;
        await maxApi.sendMessage({ chatId, text, parseMode: 'markdown' });

        // 2. Видео
        const videoFile = lesson.files?.find(f => f.type === 'video');
        if (videoFile) {
            try {
                if (videoFile.token) {
                    await maxApi.sendVideoByToken({ chatId, token: videoFile.token, caption: '🎬 **Видео к уроку**' });
                } else if (videoFile.path && fs.existsSync(videoFile.path)) {
                    const token = await maxApi.uploadFile(videoFile.path, 'video');
                    await maxApi.sendVideoByToken({ chatId, token, caption: '🎬 **Видео к уроку**' });
                }
            } catch (error) {
                console.error('[LESSON] Failed to send video:', error.message);
                await maxApi.sendMessage({ chatId, text: '⚠️ Видео недоступно.', parseMode: 'markdown' });
            }
        }

        // 3. Файлы
        const otherFiles = lesson.files?.filter(f => f.type !== 'video') || [];
        for (const file of otherFiles) {
            try {
                if (file.token) {
                    await maxApi.sendFileByToken({ chatId, token: file.token, caption: `📎 ${file.original_name}` });
                } else if (file.path && fs.existsSync(file.path)) {
                    const token = await maxApi.uploadFile(file.path, 'file');
                    await maxApi.sendFileByToken({ chatId, token, caption: `📎 ${file.original_name}` });
                }
            } catch (error) {
                console.error('[LESSON] Failed to send file:', error.message);
            }
        }

        // 4. Тест
        const test = await lessonService.getLessonTest(lessonId);
        const buttons = [];
        if (test && test.answers && test.answers.length > 0) {
            buttons.push([{ type: 'callback', text: '✅ Проверить себя', payload: `test_${test.id}` }]);
        }
        buttons.push([{ type: 'callback', text: '📚 Назад к урокам', payload: 'show_lessons' }]);
        await maxApi.sendKeyboard({
            chatId,
            text: '📝 **Что дальше?**',
            buttons,
            parseMode: 'markdown'
        });
    }

    // ============================================================
    // ТЕСТЫ
    // ============================================================
    async showTest(platform, user, testId) {
        const maxApi = new MaxAPI();
        const chatId = user.platform_user_id;
        const test = await lessonService.getLessonTest(testId);

        if (!test || !test.answers || test.answers.length === 0) {
            await maxApi.sendMessage({ chatId, text: '❌ Тест не найден', parseMode: 'markdown' });
            return;
        }

        const buttons = test.answers.map(a => [
            { type: 'callback', text: a.answer, payload: `test_answer_${testId}_${a.id}` }
        ]);
        buttons.push([{ type: 'callback', text: '📚 Назад к урокам', payload: 'show_lessons' }]);

        await maxApi.sendKeyboard({
            chatId,
            text: `📝 **${test.question || 'Проверьте знания'}**\n\nВыберите ответ:`,
            buttons,
            parseMode: 'markdown'
        });
    }

    async handleTestAnswer(platform, user, payload) {
        const maxApi = new MaxAPI();
        const chatId = user.platform_user_id;
        const parts = payload.split('_');
        const testId = parts[2];
        const answerId = parts[3];

        try {
            const result = await lessonService.checkTestAnswer(testId, answerId, user.id);
            const test = await lessonService.getLessonTest(testId);

            if (result.correct) {
                await maxApi.sendMessage({
                    chatId,
                    text: '✅ **Правильно!** 🎉 Отличная работа!\n\nВозвращаемся к урокам...',
                    parseMode: 'markdown'
                });
                await this.showLessons(platform, user);
            } else {
                const correctAnswer = test?.answers?.find(a => a.is_correct);
                const text = `❌ **Неправильно.**\n\nПравильный ответ: ${correctAnswer ? correctAnswer.answer : 'Неизвестно'}\n\nПопробуйте еще раз.`;
                const buttons = [[{ type: 'callback', text: '🔄 Попробовать еще раз', payload: `test_${testId}` }]];
                await maxApi.sendKeyboard({ chatId, text, buttons, parseMode: 'markdown' });
            }
        } catch (error) {
            console.error('[TEST] Error:', error);
            await maxApi.sendMessage({ chatId, text: '❌ Ошибка при проверке ответа.', parseMode: 'markdown' });
        }
    }

    // ============================================================
    // ПОКУПКА ДОСТУПА
    // ============================================================
    async buyAccess(platform, user) {
        const maxApi = new MaxAPI();
        const chatId = user.platform_user_id;

        const hasAccess = await courseService.checkUserCourseAccess(user.id, 'course_1');
        if (hasAccess) {
            await maxApi.sendMessage({
                chatId,
                text: '✅ У вас уже есть доступ ко всем урокам!',
                parseMode: 'markdown'
            });
            return await this.showLessons(platform, user);
        }

        const price = 1000;

        try {
            const payment = await paymentService.createPayment(user.id, price);
            await paymentService.confirmPayment(payment.id, 'test_gateway', { courseId: 'course_1' });
            await courseService.grantCourseAccess(user.id, 'course_1');

            await maxApi.sendMessage({
                chatId,
                text: `✅ **Поздравляю!**\n\nВы успешно приобрели доступ ко всем урокам за ${price} ₽.\n\nТеперь вам доступны все уроки.`,
                parseMode: 'markdown'
            });
            await this.showLessons(platform, user);
        } catch (error) {
            console.error('[PAYMENT] Error:', error);
            await maxApi.sendMessage({
                chatId,
                text: '❌ Ошибка при оформлении покупки. Попробуйте позже.',
                parseMode: 'markdown'
            });
        }
    }

    // ============================================================
    // ОБРАБОТКА CALLBACK
    // ============================================================
    async handleCallback(platform, user, payload) {
        const chatId = user.platform_user_id;
        const adminSession = this.adminSessions.get(chatId);

        if (adminSession && adminSession.mode === 'awaiting_password') {
            return;
        }

        if (payload === 'admin_back' || payload.startsWith('admin_')) {
            return await this.handleAdminCallback(platform, user, payload);
        }

        if (payload === 'main_menu') {
            return await this.handleStart(platform, user, '');
        }

        if (payload === 'show_lessons') {
            return await this.showLessons(platform, user);
        }

        if (payload === 'buy_access') {
            return await this.buyAccess(platform, user);
        }

        if (payload === 'show_help') {
            return await this.handleHelp(platform, user, '');
        }

        if (payload.startsWith('lesson_')) {
            const lessonId = payload.replace('lesson_', '');
            return await this.showLesson(platform, user, lessonId);
        }

        if (payload.startsWith('test_') && !payload.startsWith('test_answer_')) {
            const testId = payload.replace('test_', '');
            return await this.showTest(platform, user, testId);
        }

        if (payload.startsWith('test_answer_')) {
            return await this.handleTestAnswer(platform, user, payload);
        }

        const maxApi = new MaxAPI();
        await maxApi.sendMessage({
            chatId,
            text: '❓ Неизвестная команда. Используйте кнопки меню.',
            parseMode: 'markdown'
        });
    }

    // ============================================================
    // ОБРАБОТКА ТЕКСТОВЫХ СООБЩЕНИЙ
    // ============================================================
    async handleText(platform, user, message) {
        const maxApi = new MaxAPI();
        const chatId = user.platform_user_id;

        const adminSession = this.adminSessions.get(chatId);
        
        if (adminSession && adminSession.mode === 'awaiting_password') {
            return await this.handleAdminPassword(platform, user, message);
        }

        if (adminSession && adminSession.mode === 'admin') {
            const context = adminSession.context || '';

            if (context === 'creating_lesson') {
                adminSession.lessonTitle = message;
                adminSession.context = 'creating_lesson_desc';
                await maxApi.sendMessage({
                    chatId,
                    text: `📝 **Создание урока: "${message}"**\n\nВведите **описание** урока:`,
                    parseMode: 'markdown'
                });
                return;
            }

            if (context === 'creating_lesson_desc') {
                const title = adminSession.lessonTitle;
                const description = message;
                const lesson = await lessonService.createLesson({
                    courseId: 'course_1',
                    title: title,
                    description: description,
                    orderNumber: 0,
                    isFree: false
                });
                adminSession.context = 'editing_lesson';
                adminSession.lessonId = lesson.id;
                await maxApi.sendMessage({
                    chatId,
                    text: `✅ **Урок создан!**\n\n📖 ${lesson.title}\n\nТеперь загрузите **видео** и **файлы** (если нужно).\nИли отредактируйте урок через меню.`,
                    parseMode: 'markdown'
                });
                await this.showEditLessonForm(chatId, lesson.id, maxApi);
                return;
            }

            if (context === 'editing_title') {
                await lessonService.updateLesson(adminSession.lessonId, { title: message });
                adminSession.context = 'editing_lesson';
                await maxApi.sendMessage({ chatId, text: `✅ Название обновлено: "${message}"`, parseMode: 'markdown' });
                await this.showEditLessonForm(chatId, adminSession.lessonId, maxApi);
                return;
            }

            if (context === 'editing_desc') {
                await lessonService.updateLesson(adminSession.lessonId, { description: message });
                adminSession.context = 'editing_lesson';
                await maxApi.sendMessage({ chatId, text: '✅ Описание обновлено.', parseMode: 'markdown' });
                await this.showEditLessonForm(chatId, adminSession.lessonId, maxApi);
                return;
            }

            if (context === 'editing_test') {
                await this.handleTestCreation(chatId, message, maxApi);
                return;
            }

            if (context === 'uploading_video' || context === 'uploading_file') {
                // Сообщение с файлом должно обрабатываться через attachments
                // Это только текстовое сообщение
                await maxApi.sendMessage({
                    chatId,
                    text: '📎 Отправьте файл как вложение (видео или документ).',
                    parseMode: 'markdown'
                });
                return;
            }
        }

        await maxApi.sendKeyboard({
            chatId,
            text: '📝 Я получил ваше сообщение.\n\nЧто хотите сделать?',
            buttons: [
                [{ type: 'callback', text: '📚 Уроки', payload: 'show_lessons' }],
                [{ type: 'callback', text: '💰 Купить доступ', payload: 'buy_access' }],
                [{ type: 'callback', text: '❓ Помощь', payload: 'show_help' }]
            ],
            parseMode: 'markdown'
        });
    }

    // ============================================================
    // ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ
    // ============================================================
    async logUserAction(userId, action, data = {}) {
        try {
            const logs = database.readTable('user_actions') || [];
            logs.push({ 
                id: database.generateId(), 
                user_id: userId, 
                action: action, 
                data: JSON.stringify(data), 
                created_at: database.now() 
            });
            if (logs.length > 10000) logs.splice(0, logs.length - 10000);
            database.writeTable('user_actions', logs);
        } catch (error) {
            logger.warn({ err: error, userId, action }, 'Failed to log user action');
        }
    }
}

module.exports = new Dispatcher();
