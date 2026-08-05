// core/dispatcher.js
// ДИСПЕТЧЕР СООБЩЕНИЙ - маршрутизирует входящие сообщения с платформ

const database = require('../database');
const logger = require('../logger');
const courseService = require('./course');
const lessonService = require('./lesson');
const userService = require('./user');
const progressService = require('./progress');
const paymentService = require('./payment');
const MaxAPI = require('../platforms/max');

class Dispatcher {
    constructor() {
        this.handlers = new Map();
        this.registerHandlers();
    }

    registerHandlers() {
        // Регистрируем обработчики команд
        this.handlers.set('/start', this.handleStart.bind(this));
        this.handlers.set('/help', this.handleHelp.bind(this));
        this.handlers.set('/courses', this.handleCourses.bind(this));
        this.handlers.set('/mycourses', this.handleMyCourses.bind(this));
        this.handlers.set('/progress', this.handleProgress.bind(this));
    }

    // ГЛАВНЫЙ МЕТОД - точка входа для всех сообщений
    async handleMessage(platform, userId, message, payload = null) {
        try {
            logger.info({ platform, userId, message: message?.substring(0, 50) }, 'Dispatching message');

            // Получаем или создаем пользователя
            const user = await userService.getOrCreateUser(platform, userId, {
                firstName: message?.from?.first_name || '',
                lastName: message?.from?.last_name || '',
                username: message?.from?.username || '',
            });

            // Если это callback (нажатие кнопки)
            if (payload) {
                return await this.handleCallback(platform, user, payload);
            }

            // Если это команда
            if (message && message.startsWith('/')) {
                const command = message.split(' ')[0].toLowerCase();
                const handler = this.handlers.get(command);
                if (handler) {
                    return await handler(platform, user, message);
                }
            }

            // Обычное текстовое сообщение
            return await this.handleText(platform, user, message);

        } catch (error) {
            logger.error({ err: error, platform, userId }, 'Dispatcher error');
            throw error;
        }
    }

    // ОБРАБОТКА КОМАНД

    async handleStart(platform, user, message) {
        const maxApi = new MaxAPI();
        const chatId = user.platform_user_id;

        // Проверяем, есть ли deep link
        const parts = message.split(' ');
        const payload = parts.length > 1 ? parts[1] : null;

        let text = '👋 **Добро пожаловать в обучающий бот!**\n\n';
        text += 'Я помогу тебе освоить новые знания. Выбери действие:';

        const buttons = [
            [
                { type: 'callback', text: '📚 Мои курсы', payload: 'my_courses' },
                { type: 'callback', text: '📚 Все курсы', payload: 'all_courses' },
            ],
            [
                { type: 'callback', text: '📊 Прогресс', payload: 'show_progress' },
                { type: 'callback', text: '❓ Помощь', payload: 'show_help' },
            ]
        ];

        // Если есть deep link с курсом
        if (payload && payload.startsWith('course_')) {
            const courseId = payload.replace('course_', '');
            const course = await courseService.getCourseById(courseId);
            if (course) {
                text = `👋 **Добро пожаловать!**\n\n`;
                text += `Вы перешли по ссылке на курс:\n`;
                text += `📚 **${course.title}**\n`;
                text += `\nВыберите действие:`;
            }
        }

        await maxApi.sendKeyboard({
            chatId: chatId,
            text: text,
            buttons: buttons,
            parseMode: 'markdown',
        });

        // Логируем событие
        await this.logUserAction(user.id, 'start', { message });
    }

    async handleHelp(platform, user, message) {
        const maxApi = new MaxAPI();
        const chatId = user.platform_user_id;

        const text = `📚 **Помощь по боту**

/start - Начать работу
/help - Показать это сообщение
/courses - Список всех курсов
/mycourses - Мои курсы
/progress - Мой прогресс

**Как пользоваться:**
1. Выберите курс из списка
2. Изучайте уроки по порядку
3. Проходите тесты после каждого урока
4. Следите за своим прогрессом

**Поддержка:** @support`;

        await maxApi.sendMessage({
            chatId: chatId,
            text: text,
            parseMode: 'markdown',
        });

        await this.logUserAction(user.id, 'help');
    }

    async handleCourses(platform, user, message) {
        await this.showAllCourses(platform, user);
    }

    async handleMyCourses(platform, user, message) {
        await this.showMyCourses(platform, user);
    }

    async handleProgress(platform, user, message) {
        await this.showProgress(platform, user);
    }

    // ПОКАЗ КУРСОВ

    async showAllCourses(platform, user) {
        const maxApi = new MaxAPI();
        const chatId = user.platform_user_id;

        const courses = await courseService.getAllCourses(true);

        if (courses.length === 0) {
            await maxApi.sendMessage({
                chatId: chatId,
                text: '📚 **Курсы**\n\nПока нет доступных курсов. Загляните позже!',
                parseMode: 'markdown',
            });
            return;
        }

        let text = '📚 **Все доступные курсы**\n\n';
        const buttons = [];

        for (let i = 0; i < courses.length; i++) {
            const course = courses[i];
            const lessons = await courseService.getCourseLessons(course.id);
            const freeLessons = lessons.filter(l => l.is_free).length;
            const paidLessons = lessons.length - freeLessons;

            text += `${i + 1}. **${course.title}**\n`;
            text += `   ${course.description || 'Без описания'}\n`;
            text += `   📖 ${lessons.length} уроков`;
            if (course.price > 0) {
                text += ` | 💰 ${course.price} руб.`;
            } else {
                text += ` | 🆓 Бесплатно`;
            }
            if (freeLessons > 0) {
                text += ` | 🆓 ${freeLessons} бесплатных`;
            }
            text += '\n\n';

            buttons.push([
                {
                    type: 'callback',
                    text: `📖 ${course.title.substring(0, 25)}`,
                    payload: `course_${course.id}`
                }
            ]);
        }

        buttons.push([
            { type: 'callback', text: '❓ Помощь', payload: 'show_help' }
        ]);

        await maxApi.sendKeyboard({
            chatId: chatId,
            text: text + 'Выберите курс для изучения:',
            buttons: buttons,
            parseMode: 'markdown',
        });
    }

    async showMyCourses(platform, user) {
        const maxApi = new MaxAPI();
        const chatId = user.platform_user_id;

        // Получаем курсы, к которым есть доступ
        const access = await courseService.getUserFullCourseAccess(user.id);
        const allCourses = await courseService.getAllCourses(true);

        // Бесплатные курсы доступны всем
        const freeCourses = allCourses.filter(c => c.price === 0);
        const paidAccessCourses = access.map(a => a.course_id);
        const availableCourses = allCourses.filter(c => 
            c.price === 0 || paidAccessCourses.includes(c.id)
        );

        if (availableCourses.length === 0) {
            await maxApi.sendMessage({
                chatId: chatId,
                text: '📚 **Мои курсы**\n\nУ вас пока нет доступных курсов.\nВыберите курсы из общего списка: /courses',
                parseMode: 'markdown',
            });
            return;
        }

        let text = '📚 **Мои курсы**\n\n';
        const buttons = [];

        for (const course of availableCourses) {
            const lessons = await courseService.getCourseLessons(course.id);
            const progress = await progressService.getUserProgress(user.id);
            const completedLessons = progress.filter(p => 
                p.status === 'completed' && 
                lessons.some(l => l.id === p.lesson_id)
            ).length;

            const isPaid = course.price > 0;
            const hasAccess = course.price === 0 || paidAccessCourses.includes(course.id);

            text += `**${course.title}**\n`;
            text += `   📖 ${completedLessons}/${lessons.length} уроков пройдено\n`;
            if (isPaid && !hasAccess) {
                text += `   🔒 Требуется покупка: ${course.price} руб.\n`;
            } else if (isPaid) {
                text += `   ✅ Доступ открыт\n`;
            } else {
                text += `   🆓 Бесплатный курс\n`;
            }
            text += '\n';

            if (hasAccess || course.price === 0) {
                buttons.push([
                    {
                        type: 'callback',
                        text: `📖 ${course.title.substring(0, 25)}`,
                        payload: `course_${course.id}`
                    }
                ]);
            }
        }

        buttons.push([
            { type: 'callback', text: '📚 Все курсы', payload: 'all_courses' },
            { type: 'callback', text: '❓ Помощь', payload: 'show_help' }
        ]);

        await maxApi.sendKeyboard({
            chatId: chatId,
            text: text + 'Выберите курс для продолжения:',
            buttons: buttons,
            parseMode: 'markdown',
        });
    }

    async showProgress(platform, user) {
        const maxApi = new MaxAPI();
        const chatId = user.platform_user_id;

        const summary = await progressService.getProgressSummary(user.id);
        const recentActivity = await progressService.getLastActivity(user.id);

        let text = '📊 **Мой прогресс**\n\n';
        text += `📚 Всего уроков: ${summary.totalLessons}\n`;
        text += `✅ Пройдено: ${summary.completedLessons}\n`;
        text += `📈 Прогресс: ${summary.totalLessons > 0 ? Math.round(summary.completedLessons / summary.totalLessons * 100) : 0}%\n\n`;

        if (summary.totalFreeLessons > 0) {
            text += `🆓 Бесплатных уроков: ${summary.totalFreeLessons}\n`;
            text += `✅ Пройдено бесплатных: ${summary.completedFreeLessons}\n\n`;
        }

        if (recentActivity) {
            text += `🕐 Последняя активность: ${new Date(recentActivity).toLocaleDateString('ru-RU')}\n`;
        }

        // Получаем последние просмотренные уроки
        const progress = await progressService.getUserProgress(user.id);
        const recent = progress.slice(0, 5);

        if (recent.length > 0) {
            text += '\n**Последние уроки:**\n';
            for (const p of recent) {
                const status = p.status === 'completed' ? '✅' : '📖';
                text += `${status} ${p.lesson_title}\n`;
            }
        }

        const buttons = [
            [
                { type: 'callback', text: '📚 Мои курсы', payload: 'my_courses' },
                { type: 'callback', text: '📚 Все курсы', payload: 'all_courses' },
            ],
            [
                { type: 'callback', text: '❓ Помощь', payload: 'show_help' }
            ]
        ];

        await maxApi.sendKeyboard({
            chatId: chatId,
            text: text,
            buttons: buttons,
            parseMode: 'markdown',
        });
    }

    // ОБРАБОТКА CALLBACK (нажатий кнопок)

    async handleCallback(platform, user, payload) {
        const maxApi = new MaxAPI();
        const chatId = user.platform_user_id;

        logger.info({ userId: user.id, payload }, 'Handling callback');

        // Разбираем payload
        if (payload === 'all_courses') {
            return await this.showAllCourses(platform, user);
        }

        if (payload === 'my_courses') {
            return await this.showMyCourses(platform, user);
        }

        if (payload === 'show_progress') {
            return await this.showProgress(platform, user);
        }

        if (payload === 'show_help') {
            return await this.handleHelp(platform, user, '');
        }

        if (payload === 'back_to_course') {
            // Возврат к курсу - нужно сохранить последний курс в сессии пользователя
            // Пока просто показываем все курсы
            return await this.showAllCourses(platform, user);
        }

        if (payload === 'back_to_lessons') {
            // Возврат к списку уроков
            // Нужно сохранять контекст - пока просто показываем курсы
            return await this.showAllCourses(platform, user);
        }

        // Проверка ответа на тест
        if (payload.startsWith('test_')) {
            return await this.handleTestAnswer(platform, user, payload);
        }

        // Показ курса
        if (payload.startsWith('course_')) {
            const courseId = payload.replace('course_', '');
            return await this.showCourse(platform, user, courseId);
        }

        // Показ урока
        if (payload.startsWith('lesson_')) {
            const lessonId = payload.replace('lesson_', '');
            return await this.showLesson(platform, user, lessonId);
        }

        // Покупка курса
        if (payload.startsWith('buy_')) {
            const courseId = payload.replace('buy_', '');
            return await this.buyCourse(platform, user, courseId);
        }

        // Если ничего не подошло
        await maxApi.sendMessage({
            chatId: chatId,
            text: `❓ Неизвестная команда: ${payload}\n\nПожалуйста, используйте кнопки меню.`,
            parseMode: 'markdown',
        });
    }

    // ПОКАЗ КУРСА

    async showCourse(platform, user, courseId) {
        const maxApi = new MaxAPI();
        const chatId = user.platform_user_id;

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
        const hasAccess = await this.checkCourseAccess(user.id, courseId);

        let text = `📚 **${course.title}**\n\n`;
        text += `${course.description || 'Без описания'}\n\n`;
        text += `📖 Всего уроков: ${lessons.length}\n`;

        if (course.price > 0) {
            text += `💰 Стоимость: ${course.price} руб.\n`;
            text += hasAccess ? '✅ Доступ открыт\n' : '🔒 Требуется покупка\n';
        } else {
            text += '🆓 Бесплатный курс\n';
        }
        text += '\n';

        // Показываем уроки
        if (hasAccess || course.price === 0) {
            text += '**Уроки:**\n';
            const buttons = [];

            for (const lesson of lessons) {
                // Проверяем, пройден ли урок
                const progress = await progressService.getUserProgress(user.id);
                const lessonProgress = progress.find(p => p.lesson_id === lesson.id);
                const status = lessonProgress?.status === 'completed' ? '✅' : 
                              lessonProgress?.status === 'started' ? '📖' : '⬜';

                text += `${status} ${lesson.title}`;
                if (lesson.is_free) {
                    text += ' 🆓';
                }
                text += '\n';

                // Добавляем кнопку для каждого урока, если есть доступ
                if (hasAccess || lesson.is_free || course.price === 0) {
                    buttons.push([
                        {
                            type: 'callback',
                            text: `${status} ${lesson.title.substring(0, 30)}`,
                            payload: `lesson_${lesson.id}`
                        }
                    ]);
                }
            }
            text += '\n';

            // Кнопки управления
            const navButtons = [
                [
                    { type: 'callback', text: '📚 Мои курсы', payload: 'my_courses' },
                    { type: 'callback', text: '📊 Прогресс', payload: 'show_progress' },
                ],
                [
                    { type: 'callback', text: '❓ Помощь', payload: 'show_help' }
                ]
            ];

            buttons.push(...navButtons);

            await maxApi.sendKeyboard({
                chatId: chatId,
                text: text,
                buttons: buttons,
                parseMode: 'markdown',
            });

        } else {
            // Курс платный и доступа нет
            text += '🔒 **Для доступа к урокам необходимо приобрести курс**\n\n';
            
            const buttons = [
                [
                    { type: 'callback', text: `💳 Купить за ${course.price} руб.`, payload: `buy_${course.id}` },
                ],
                [
                    { type: 'callback', text: '📚 Все курсы', payload: 'all_courses' },
                    { type: 'callback', text: '❓ Помощь', payload: 'show_help' },
                ]
            ];

            await maxApi.sendKeyboard({
                chatId: chatId,
                text: text,
                buttons: buttons,
                parseMode: 'markdown',
            });
        }

        await this.logUserAction(user.id, 'view_course', { courseId });
    }

    // ПОКАЗ УРОКА

    async showLesson(platform, user, lessonId) {
        const maxApi = new MaxAPI();
        const chatId = user.platform_user_id;

        const lesson = await lessonService.getLessonById(lessonId);
        if (!lesson) {
            await maxApi.sendMessage({
                chatId: chatId,
                text: '❌ Урок не найден',
                parseMode: 'markdown',
            });
            return;
        }

        // Проверяем доступ к уроку
        const hasAccess = await this.checkLessonAccess(user.id, lessonId);
        if (!hasAccess) {
            await maxApi.sendMessage({
                chatId: chatId,
                text: '🔒 Урок недоступен. Приобретите курс для доступа ко всем урокам.',
                parseMode: 'markdown',
            });
            return;
        }

        // Записываем просмотр
        await lessonService.recordLessonView(user.id, lessonId);

        // Получаем полную информацию об уроке
        const lessonWithFiles = await lessonService.getLessonWithFiles(lessonId);
        const test = await lessonService.getLessonTest(lessonId);

        let text = `📖 **${lesson.title}**\n\n`;
        text += `${lesson.description || ''}\n\n`;

        // Отправляем видео, если есть
        if (lesson.video_url) {
            try {
                // Пытаемся отправить как видео через MAX
                // Если это ссылка, пробуем загрузить и отправить
                await maxApi.sendMessage({
                    chatId: chatId,
                    text: `🎬 **Видео к уроку**\n\nСсылка: ${lesson.video_url}`,
                    parseMode: 'markdown',
                });
            } catch (error) {
                logger.error({ err: error, lessonId }, 'Failed to send video');
                // Отправляем ссылку как запасной вариант
                await maxApi.sendMessage({
                    chatId: chatId,
                    text: `🎬 **Видео к уроку**\n\n${lesson.video_url}`,
                    parseMode: 'markdown',
                });
            }
        }

        // Отправляем файлы, если есть
        if (lessonWithFiles.files && lessonWithFiles.files.length > 0) {
            for (const file of lessonWithFiles.files) {
                try {
                    await maxApi.sendMessage({
                        chatId: chatId,
                        text: `📎 **Файл:** ${file.filename}\n\nСсылка: ${file.url}`,
                        parseMode: 'markdown',
                    });
                } catch (error) {
                    logger.error({ err: error, fileId: file.id }, 'Failed to send file');
                }
            }
        }

        // Кнопки навигации
        const buttons = [];

        // Если есть тест, добавляем кнопку "Проверить себя"
        if (test) {
            buttons.push([
                { type: 'callback', text: '✅ Проверить себя', payload: `test_${test.id}` }
            ]);
        }

        // Навигация
        buttons.push([
            { type: 'callback', text: '📚 Вернуться к курсу', payload: `course_${lesson.course_id}` },
        ]);
        buttons.push([
            { type: 'callback', text: '📚 Мои курсы', payload: 'my_courses' },
            { type: 'callback', text: '❓ Помощь', payload: 'show_help' },
        ]);

        await maxApi.sendKeyboard({
            chatId: chatId,
            text: text + 'Выберите действие:',
            buttons: buttons,
            parseMode: 'markdown',
        });

        await this.logUserAction(user.id, 'view_lesson', { lessonId });
    }

    // ТЕСТЫ

    async handleTestAnswer(platform, user, payload) {
        const maxApi = new MaxAPI();
        const chatId = user.platform_user_id;

        const parts = payload.split('_');
        const testId = parts[1];
        const answerId = parts.length > 2 ? parts[2] : null;

        if (!answerId) {
            // Показываем тест
            return await this.showTest(platform, user, testId);
        }

        // Проверяем ответ
        try {
            const test = await lessonService.getLessonTest(null, testId); // Нужно доработать
            const result = await lessonService.checkTestAnswer(testId, answerId, user.id);

            if (result.correct) {
                await maxApi.sendMessage({
                    chatId: chatId,
                    text: '✅ **Правильно!** Отличная работа!\n\nВы успешно прошли тест.',
                    parseMode: 'markdown',
                });
            } else {
                await maxApi.sendMessage({
                    chatId: chatId,
                    text: '❌ **Неправильно.** Попробуйте еще раз или перечитайте материал урока.',
                    parseMode: 'markdown',
                });
            }

            // Возвращаемся к уроку
            const lesson = await lessonService.getLessonById(testId);
            if (lesson) {
                await this.showLesson(platform, user, lesson.id);
            }

        } catch (error) {
            logger.error({ err: error, userId: user.id, testId }, 'Test error');
            await maxApi.sendMessage({
                chatId: chatId,
                text: '❌ Ошибка при проверке теста. Попробуйте позже.',
                parseMode: 'markdown',
            });
        }
    }

    async showTest(platform, user, testId) {
        const maxApi = new MaxAPI();
        const chatId = user.platform_user_id;

        const test = await lessonService.getLessonTest(testId);
        if (!test) {
            await maxApi.sendMessage({
                chatId: chatId,
                text: '❌ Тест не найден',
                parseMode: 'markdown',
            });
            return;
        }

        const text = `📝 **${test.question || 'Проверьте свои знания'}**\n\nВыберите правильный ответ:`;

        const buttons = [];
        for (const answer of test.answers || []) {
            buttons.push([
                {
                    type: 'callback',
                    text: answer.answer || 'Вариант ответа',
                    payload: `test_${testId}_${answer.id}`
                }
            ]);
        }

        buttons.push([
            { type: 'callback', text: '⬅️ Вернуться к уроку', payload: `lesson_${test.lesson_id}` }
        ]);

        await maxApi.sendKeyboard({
            chatId: chatId,
            text: text,
            buttons: buttons,
            parseMode: 'markdown',
        });
    }

    // ОБРАБОТКА ТЕКСТОВЫХ СООБЩЕНИЙ

    async handleText(platform, user, message) {
        const maxApi = new MaxAPI();
        const chatId = user.platform_user_id;

        // Просто отвечаем с меню
        const text = `📝 Я получил ваше сообщение:\n\n"${message}"\n\nЧто хотите сделать дальше?`;

        const buttons = [
            [
                { type: 'callback', text: '📚 Мои курсы', payload: 'my_courses' },
                { type: 'callback', text: '📚 Все курсы', payload: 'all_courses' },
            ],
            [
                { type: 'callback', text: '📊 Прогресс', payload: 'show_progress' },
                { type: 'callback', text: '❓ Помощь', payload: 'show_help' },
            ]
        ];

        await maxApi.sendKeyboard({
            chatId: chatId,
            text: text,
            buttons: buttons,
            parseMode: 'markdown',
        });

        await this.logUserAction(user.id, 'text_message', { message: message.substring(0, 100) });
    }

    // ПОКУПКА КУРСА

    async buyCourse(platform, user, courseId) {
        const maxApi = new MaxAPI();
        const chatId = user.platform_user_id;

        const course = await courseService.getCourseById(courseId);
        if (!course) {
            await maxApi.sendMessage({
                chatId: chatId,
                text: '❌ Курс не найден',
                parseMode: 'markdown',
            });
            return;
        }

        // Проверяем, есть ли уже доступ
        const hasAccess = await this.checkCourseAccess(user.id, courseId);
        if (hasAccess) {
            await maxApi.sendMessage({
                chatId: chatId,
                text: '✅ У вас уже есть доступ к этому курсу.',
                parseMode: 'markdown',
            });
            return await this.showCourse(platform, user, courseId);
        }

        // Создаем платеж
        try {
            const payment = await paymentService.createPayment(user.id, course.price);

            // В реальном проекте здесь был бы redirect на платежную систему
            // Пока просто имитируем успешную оплату
            await paymentService.confirmPayment(payment.id, 'test_gateway', { courseId });

            // Открываем доступ
            await courseService.grantCourseAccess(user.id, courseId);

            await maxApi.sendMessage({
                chatId: chatId,
                text: `✅ **Поздравляю!**\n\nВы успешно приобрели курс **${course.title}** за ${course.price} руб.\n\nТеперь вам доступны все уроки.`,
                parseMode: 'markdown',
            });

            // Показываем курс
            await this.showCourse(platform, user, courseId);

        } catch (error) {
            logger.error({ err: error, userId: user.id, courseId }, 'Payment error');
            await maxApi.sendMessage({
                chatId: chatId,
                text: '❌ Ошибка при оформлении покупки. Попробуйте позже.',
                parseMode: 'markdown',
            });
        }
    }

    // ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ

    async checkCourseAccess(userId, courseId) {
        const course = await courseService.getCourseById(courseId);
        if (!course) return false;

        // Бесплатные курсы доступны всем
        if (course.price === 0) return true;

        // Проверяем доступ
        const access = await courseService.getUserFullCourseAccess(userId);
        return access.some(a => a.course_id === courseId);
    }

    async checkLessonAccess(userId, lessonId) {
        const lesson = await lessonService.getLessonById(lessonId);
        if (!lesson) return false;

        // Бесплатные уроки доступны всем
        if (lesson.is_free) return true;

        // Проверяем доступ к курсу
        return await this.checkCourseAccess(userId, lesson.course_id);
    }

    async logUserAction(userId, action, data = {}) {
        try {
            const logs = database.readTable('user_actions') || [];
            logs.push({
                id: database.generateId(),
                user_id: userId,
                action: action,
                data: JSON.stringify(data),
                created_at: database.now(),
            });
            // Ограничиваем размер логов
            if (logs.length > 10000) {
                logs.splice(0, logs.length - 10000);
            }
            database.writeTable('user_actions', logs);
        } catch (error) {
            // Не критично, просто логируем ошибку
            logger.warn({ err: error, userId, action }, 'Failed to log user action');
        }
    }
}

module.exports = new Dispatcher();
