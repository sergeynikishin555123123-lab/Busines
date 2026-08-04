const MessageSender = require('./sender');
const userService = require('./user');
const courseService = require('./course');
const lessonService = require('./lesson');
const progressService = require('./progress');
const paymentService = require('./payment');
const database = require('../database');
const logger = require('../logger');
const { AppError } = require('../middleware/errorHandler');

class MessageDispatcher {
  async handleMessage(normalizedMessage) {
    const { platform, userId: platformUserId, message, payload } = normalizedMessage;
    
    try {
      const user = await userService.getOrCreateUser(platform, platformUserId, {
        firstName: normalizedMessage.firstName || '',
        lastName: normalizedMessage.lastName || '',
        username: normalizedMessage.username || '',
      });

      const sender = new MessageSender(platform, platformUserId);
      const command = this.extractCommand(message, payload);

      logger.info(`Processing command: ${command}`, {
        platform,
        userId: user.id,
        message: message?.substring(0, 100),
      });

      switch (command) {
        case 'start':
          return this.handleStart(sender, user);
        
        case 'menu':
        case 'main_menu':
          return this.handleMainMenu(sender, user);
        
        case 'free_lessons':
          return this.handleFreeLessons(sender, user);
        
        case 'full_course':
          return this.handleFullCourse(sender, user);
        
        case 'progress':
          return this.handleProgress(sender, user);
        
        case 'support':
          return this.handleSupport(sender, user);
        
        case 'lesson':
          return this.handleLesson(sender, user, payload);
        
        case 'watch_lesson':
          return this.handleWatchLesson(sender, user, payload);
        
        case 'test_answer':
          return this.handleTestAnswer(sender, user, payload);
        
        case 'buy_course':
          return this.handleBuyCourse(sender, user, payload);
        
        default:
          return this.handleMainMenu(sender, user);
      }
    } catch (error) {
      logger.error('Dispatcher error:', error);
      const sender = new MessageSender(platform, platformUserId);
      await sender.sendText('Произошла ошибка. Пожалуйста, попробуйте позже или обратитесь в поддержку.');
    }
  }

  extractCommand(message, payload = {}) {
    if (payload && payload.command) {
      return payload.command;
    }

    if (!message) return 'menu';

    const text = message.toLowerCase().trim();

    if (text === '/start' || text === 'начать') return 'start';
    if (text.includes('бесплатные') || text.includes('📚')) return 'free_lessons';
    if (text.includes('полный курс') || text.includes('🎓')) return 'full_course';
    if (text.includes('прогресс') || text.includes('📊')) return 'progress';
    if (text.includes('поддержка') || text.includes('💬')) return 'support';
    if (text.includes('купить') || text.includes('оплатить')) return 'buy_course';
    
    return 'menu';
  }

  async handleStart(sender, user) {
    const settings = await this.getBotSettings();
    await sender.sendText(
      `👋 Здравствуйте, ${user.first_name || 'пользователь'}!\n\n` +
      `${settings.main_menu_text || 'Добро пожаловать! Выберите раздел:'}`
    );
    return this.handleMainMenu(sender, user);
  }

  async handleMainMenu(sender, user) {
    const settings = await this.getBotSettings();
    
    const buttons = [
      [{ text: settings.free_lessons_button || '📚 Бесплатные уроки', color: 'primary', payload: { command: 'free_lessons' } }],
      [{ text: settings.full_course_button || '🎓 Полный курс', color: 'primary', payload: { command: 'full_course' } }],
      [{ text: settings.progress_button || '📊 Мой прогресс', color: 'secondary', payload: { command: 'progress' } }],
      [{ text: settings.support_button || '💬 Поддержка', color: 'secondary', payload: { command: 'support' } }],
    ];

    await sender.sendButtons(
      settings.main_menu_text || 'Главное меню:',
      buttons
    );
  }

  async handleFreeLessons(sender, user) {
    const freeLessons = await courseService.getUserFreeLessonsProgress(user.id);

    if (freeLessons.length === 0) {
      await sender.sendText('Бесплатные уроки пока не добавлены.');
      return this.handleMainMenu(sender, user);
    }

    const buttons = freeLessons.map(lesson => {
      const statusIcon = lesson.status === 'completed' ? '✅' : '📝';
      return [{
        text: `${statusIcon} Урок ${lesson.order_number}: ${lesson.title}`,
        color: lesson.status === 'completed' ? 'secondary' : 'primary',
        payload: { command: 'lesson', lessonId: lesson.id },
      }];
    });

    buttons.push([{ 
      text: '🔙 Главное меню', 
      color: 'secondary', 
      payload: { command: 'menu' } 
    }]);

    await sender.sendButtons('📚 Бесплатные уроки:', buttons);

    const allCompleted = await courseService.hasUserCompletedAllFreeLessons(user.id);
    if (allCompleted) {
      const settings = await this.getBotSettings();
      await sender.sendText(settings.complete_course_offer || 'Поздравляем! Вы прошли все бесплатные уроки. Хотите открыть полный курс?');
      
      await sender.sendButtons('Выберите действие:', [
        [{ text: '🎓 Открыть полный курс', color: 'positive', payload: { command: 'full_course' } }],
        [{ text: '🔙 Главное меню', color: 'secondary', payload: { command: 'menu' } }],
      ]);
    }
  }

  async handleFullCourse(sender, user) {
    const access = await courseService.getUserFullCourseAccess(user.id);

    if (access.length === 0) {
      const paidCourses = await courseService.getPaidCourses();
      
      if (paidCourses.length === 0) {
        await sender.sendText('Полный курс пока недоступен.');
        return this.handleMainMenu(sender, user);
      }

      const course = paidCourses[0];
      await sender.sendText(
        `🎓 ${course.title}\n\n` +
        `${course.description || ''}\n\n` +
        `💰 Стоимость: ${course.price} RUB\n\n` +
        `Доступ навсегда после оплаты.`
      );

      return sender.sendButtons('Выберите действие:', [
        [{ text: `💰 Оплатить ${course.price} RUB`, color: 'positive', payload: { command: 'buy_course', courseId: course.id } }],
        [{ text: '🔙 Главное меню', color: 'secondary', payload: { command: 'menu' } }],
      ]);
    }

    const courseAccess = access[0];
    const lessons = await courseService.getCourseLessons(courseAccess.course_id);
    const progress = await progressService.getUserProgress(user.id);

    const completedLessons = new Set(
      progress.filter(p => p.status === 'completed').map(p => p.lesson_id)
    );

    const buttons = lessons.map(lesson => {
      const statusIcon = completedLessons.has(lesson.id) ? '✅' : '📝';
      return [{
        text: `${statusIcon} Урок ${lesson.order_number}: ${lesson.title}`,
        color: completedLessons.has(lesson.id) ? 'secondary' : 'primary',
        payload: { command: 'lesson', lessonId: lesson.id },
      }];
    });

    buttons.push([{ 
      text: '🔙 Главное меню', 
      color: 'secondary', 
      payload: { command: 'menu' } 
    }]);

    await sender.sendButtons(`🎓 ${courseAccess.title}:`, buttons);
  }

  async handleProgress(sender, user) {
    const summary = await progressService.getUserProgress(user.id);
    const stats = await progressService.getProgressSummary(user.id);
    const lastActivity = await progressService.getLastActivity(user.id);

    let message = '📊 Ваш прогресс:\n\n';
    message += `✅ Пройдено уроков: ${stats.completedLessons}/${stats.totalLessons}\n`;
    message += `📚 Бесплатных уроков пройдено: ${stats.completedFreeLessons}/${stats.totalFreeLessons}\n`;

    if (lastActivity) {
      message += `🕐 Последняя активность: ${new Date(lastActivity).toLocaleDateString('ru-RU')}\n`;
    }

    if (summary.length > 0) {
      message += '\n📋 Пройденные уроки:\n';
      summary
        .filter(p => p.status === 'completed')
        .slice(0, 10)
        .forEach(p => {
          message += `✅ ${p.lesson_title} - ${new Date(p.completed_at).toLocaleDateString('ru-RU')}\n`;
        });
    }

    await sender.sendText(message);
    return this.handleMainMenu(sender, user);
  }

  async handleSupport(sender, user) {
    const settings = await this.getBotSettings();
    await sender.sendText(
      `💬 Поддержка\n\n` +
      `Если у вас возникли вопросы или проблемы, свяжитесь с нами:\n\n` +
      `${settings.support_contact || '@support'}\n\n` +
      `Мы ответим в ближайшее время.`
    );
    return this.handleMainMenu(sender, user);
  }

  async handleLesson(sender, user, payload) {
    const lessonId = payload?.lessonId;
    if (!lessonId) {
      await sender.sendText('Урок не найден.');
      return this.handleMainMenu(sender, user);
    }

    const lesson = await lessonService.getLessonWithFiles(lessonId);
    if (!lesson) {
      await sender.sendText('Урок не найден.');
      return this.handleMainMenu(sender, user);
    }

    const access = await courseService.getUserFullCourseAccess(user.id);
    const hasAccess = lesson.is_free || access.length > 0;

    if (!hasAccess) {
      await sender.sendText('Этот урок доступен только в полном курсе.');
      return this.handleFullCourse(sender, user);
    }

    await lessonService.recordLessonView(user.id, lessonId);

    let message = `📖 ${lesson.title}\n\n`;
    if (lesson.description) {
      message += `${lesson.description}\n\n`;
    }

    await sender.sendText(message);

    if (lesson.video_url) {
      await sender.sendVideo(lesson.video_url);
    }

    for (const file of lesson.files) {
      await sender.sendFile(file.url, file.filename);
    }

    const settings = await this.getBotSettings();

    const progress = await database.query(
      'SELECT * FROM progress WHERE user_id = $1 AND lesson_id = $2',
      [user.id, lessonId]
    );

    const isCompleted = progress.rows[0]?.status === 'completed';

    if (isCompleted) {
      await sender.sendText('✅ Вы уже прошли этот урок.');
      return sender.sendButtons('Выберите действие:', [
        [{ text: '📊 Прогресс', color: 'primary', payload: { command: 'progress' } }],
        [{ text: '🔙 К урокам', color: 'secondary', payload: { command: lesson.is_free ? 'free_lessons' : 'full_course' } }],
      ]);
    }

    if (lesson.test) {
      await sender.sendButtons(settings.watched_button || '✅ Я просмотрел', [
        [{ 
          text: settings.watched_button || '✅ Я просмотрел', 
          color: 'positive', 
          payload: { command: 'watch_lesson', lessonId: lesson.id } 
        }],
        [{ text: '🔙 Назад', color: 'secondary', payload: { command: lesson.is_free ? 'free_lessons' : 'full_course' } }],
      ]);
    }
  }

  async handleWatchLesson(sender, user, payload) {
    const lessonId = payload?.lessonId;
    if (!lessonId) {
      await sender.sendText('Урок не найден.');
      return this.handleMainMenu(sender, user);
    }

    const test = await lessonService.getLessonTest(lessonId);
    if (!test) {
      await sender.sendText('Тест для этого урока не найден.');
      return this.handleMainMenu(sender, user);
    }

    const buttons = test.answers.map(answer => [{
      text: answer.answer,
      color: 'primary',
      payload: { command: 'test_answer', lessonId, answerId: answer.id },
    }]);

    buttons.push([{ 
      text: '🔙 Назад', 
      color: 'secondary', 
      payload: { command: 'lesson', lessonId } 
    }]);

    await sender.sendButtons(`📝 ${test.question}`, buttons);
  }

  async handleTestAnswer(sender, user, payload) {
    const { lessonId, answerId } = payload || {};
    if (!lessonId || !answerId) {
      await sender.sendText('Ошибка теста.');
      return this.handleMainMenu(sender, user);
    }

    try {
      const result = await lessonService.checkTestAnswer(lessonId, answerId, user.id);
      const settings = await this.getBotSettings();

      if (result.correct) {
        await sender.sendText(settings.correct_answer_text || '✅ Правильно! Урок завершен.');
        
        const lesson = await lessonService.getLessonById(lessonId);
        if (lesson) {
          return sender.sendButtons('Что дальше?', [
            [{ text: '📊 Мой прогресс', color: 'primary', payload: { command: 'progress' } }],
            [{ text: '🔙 К урокам', color: 'secondary', payload: { command: lesson.is_free ? 'free_lessons' : 'full_course' } }],
            [{ text: '🏠 Главное меню', color: 'secondary', payload: { command: 'menu' } }],
          ]);
        }
      } else {
        await sender.sendText(settings.wrong_answer_text || '❌ Неправильный ответ. Попробуйте еще раз.');
        
        const test = await lessonService.getLessonTest(lessonId);
        if (test) {
          const buttons = test.answers.map(answer => [{
            text: answer.answer,
            color: 'primary',
            payload: { command: 'test_answer', lessonId, answerId: answer.id },
          }]);
          
          buttons.push([{ 
            text: '🔙 Назад', 
            color: 'secondary', 
            payload: { command: 'lesson', lessonId } 
          }]);

          await sender.sendButtons(`📝 ${test.question}`, buttons);
        }
      }
    } catch (error) {
      logger.error('Test answer error:', error);
      await sender.sendText('Произошла ошибка при проверке ответа.');
      return this.handleMainMenu(sender, user);
    }
  }

  async handleBuyCourse(sender, user, payload) {
    const courseId = payload?.courseId;
    if (!courseId) {
      const paidCourses = await courseService.getPaidCourses();
      if (paidCourses.length === 0) {
        await sender.sendText('Курсы недоступны для покупки.');
        return this.handleMainMenu(sender, user);
      }
      const course = paidCourses[0];
      
      const payment = await paymentService.createPayment(user.id, parseFloat(course.price));
      
      await sender.sendText(
        `💳 Оплата курса "${course.title}"\n\n` +
        `Сумма: ${course.price} RUB\n\n` +
        `ID платежа: ${payment.id}\n\n` +
        `Для оплаты перейдите по ссылке или используйте реквизиты.`
      );

      return sender.sendButtons('Способы оплаты:', [
        [{ text: '💳 VK Pay', color: 'positive', payload: { command: 'pay_vk', paymentId: payment.id } }],
        [{ text: '🔙 Главное меню', color: 'secondary', payload: { command: 'menu' } }],
      ]);
    }
  }

  async getBotSettings() {
    const result = await database.query('SELECT * FROM bot_settings');
    const settings = {};
    result.rows.forEach(row => {
      settings[row.key] = row.value;
    });
    return settings;
  }
}

module.exports = new MessageDispatcher();
