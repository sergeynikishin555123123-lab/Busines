const path = require('path');
const multer = require('multer');
const config = require('../config');
const userService = require('../core/user');
const courseService = require('../core/course');
const lessonService = require('../core/lesson');
const paymentService = require('../core/payment');
const progressService = require('../core/progress');
const storageService = require('../services/storage');
const database = require('../database');
const logger = require('../logger');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.storage.maxFileSizeMb * 1024 * 1024,
  },
});

// Дашборд
async function dashboard(req, res) {
  try {
    const users = await userService.getAllUsers(1, 100);
    const courses = await courseService.getAllCourses();
    const lessons = database.readTable('lessons');
    const payments = database.readTable('payments');
    
    const stats = {
      users: users.total || 0,
      courses: courses.length || 0,
      lessons: lessons.length || 0,
      payments: payments.filter(p => p.status === 'success').length || 0,
      revenue: payments.filter(p => p.status === 'success').reduce((sum, p) => sum + parseFloat(p.amount), 0) || 0,
    };
    
    res.render('dashboard', { 
      title: 'Панель управления',
      stats,
      layout: false 
    });
  } catch (error) {
    logger.error('Dashboard error:', error);
    res.render('dashboard', { 
      title: 'Панель управления',
      stats: { users: 0, courses: 0, lessons: 0, payments: 0, revenue: 0 },
      layout: false 
    });
  }
}

// Панель управления
async function panel(req, res) {
  try {
    const section = req.query.section || 'users';
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const data = { section, page, title: 'Панель управления' };

    // Получаем настройки бота
    const settingsResult = database.readTable('bot_settings');
    const settings = {};
    settingsResult.forEach(row => {
      settings[row.key] = row.value;
    });
    data.settings = settings;

    // Получаем данные в зависимости от раздела
    switch (section) {
      case 'users': {
        const result = await userService.getAllUsers(page, limit);
        data.users = result.users || [];
        data.pages = Math.ceil((result.total || 0) / limit);
        break;
      }
      case 'courses': {
        const courses = await courseService.getAllCourses();
        data.courses = courses || [];
        break;
      }
      case 'lessons': {
        const courses = await courseService.getAllCourses();
        data.courses = courses || [];
        
        const courseId = req.query.courseId || (courses.length > 0 ? courses[0].id : null);
        if (courseId) {
          data.currentCourse = await courseService.getCourseById(courseId);
          const lessons = await courseService.getCourseLessons(courseId);
          // Добавляем файлы к каждому уроку
          for (const lesson of lessons) {
            const files = database.readTable('lesson_files').filter(f => f.lesson_id === lesson.id);
            lesson.files = files || [];
            const test = await lessonService.getLessonTest(lesson.id);
            lesson.test = test;
          }
          data.lessons = lessons || [];
        } else {
          data.lessons = [];
        }
        break;
      }
      case 'payments': {
        const result = await paymentService.getAllPayments(page, limit);
        data.payments = result.payments || [];
        data.pages = Math.ceil((result.total || 0) / limit);
        break;
      }
      case 'settings': {
        // Настройки уже загружены
        break;
      }
      default: {
        data.users = [];
        data.pages = 0;
      }
    }

    res.render('panel', data);
  } catch (error) {
    logger.error('Panel error:', error);
    res.render('panel', { 
      section: req.query.section || 'users',
      page: 1,
      title: 'Панель управления',
      users: [],
      courses: [],
      lessons: [],
      payments: [],
      settings: {},
      error: 'Ошибка загрузки данных'
    });
  }
}

// Создание курса
async function createCourse(req, res) {
  try {
    const { title, description, price } = req.body;
    await courseService.createCourse({ title, description, price });
    res.redirect('/admin/panel?section=courses&success=Курс создан');
  } catch (error) {
    logger.error('Create course error:', error);
    res.redirect('/admin/panel?section=courses&error=Ошибка создания');
  }
}

// Обновление курса
async function updateCourse(req, res) {
  try {
    const { id, title, price, isActive } = req.body;
    await courseService.updateCourse(id, {
      title,
      price,
      isActive: isActive === 'on',
    });
    res.redirect('/admin/panel?section=courses&success=Курс обновлен');
  } catch (error) {
    logger.error('Update course error:', error);
    res.redirect('/admin/panel?section=courses&error=Ошибка обновления');
  }
}

// Удаление курса
async function deleteCourse(req, res) {
  try {
    const { id } = req.params;
    await courseService.deleteCourse(id);
    res.redirect('/admin/panel?section=courses&success=Курс удален');
  } catch (error) {
    logger.error('Delete course error:', error);
    res.redirect('/admin/panel?section=courses&error=Ошибка удаления');
  }
}

// Создание урока
async function createLesson(req, res) {
  try {
    const { courseId, title, description, videoUrl, orderNumber, isFree } = req.body;
    await lessonService.createLesson({
      courseId,
      title,
      description,
      videoUrl,
      orderNumber,
      isFree: isFree === 'on',
    });
    res.redirect(`/admin/panel?section=lessons&courseId=${courseId}&success=Урок создан`);
  } catch (error) {
    logger.error('Create lesson error:', error);
    res.redirect(`/admin/panel?section=lessons&courseId=${req.body.courseId}&error=Ошибка создания`);
  }
}

// Обновление урока
async function updateLesson(req, res) {
  try {
    const { id, courseId, title, orderNumber, isFree } = req.body;
    await lessonService.updateLesson(id, {
      title,
      orderNumber,
      isFree: isFree === 'on',
    });
    res.redirect(`/admin/panel?section=lessons&courseId=${courseId}&success=Урок обновлен`);
  } catch (error) {
    logger.error('Update lesson error:', error);
    res.redirect(`/admin/panel?section=lessons&courseId=${req.body.courseId}&error=Ошибка обновления`);
  }
}

// Удаление урока
async function deleteLesson(req, res) {
  try {
    const { id } = req.params;
    const courseId = req.query.courseId;
    await lessonService.deleteLesson(id);
    res.redirect(`/admin/panel?section=lessons&courseId=${courseId}&success=Урок удален`);
  } catch (error) {
    logger.error('Delete lesson error:', error);
    res.redirect(`/admin/panel?section=lessons&courseId=${req.query.courseId}&error=Ошибка удаления`);
  }
}

// Загрузка файла урока
async function uploadLessonFile(req, res) {
  try {
    const { lessonId, courseId } = req.body;
    if (!req.file) {
      return res.redirect(`/admin/panel?section=lessons&courseId=${courseId}&error=Файл не загружен`);
    }

    const filename = req.file.originalname;
    const url = await storageService.saveFile(req.file.buffer, filename, 'lessons');
    
    await lessonService.addLessonFile(lessonId, {
      filename,
      url,
      type: req.file.mimetype,
    });

    res.redirect(`/admin/panel?section=lessons&courseId=${courseId}&success=Файл загружен`);
  } catch (error) {
    logger.error('Upload file error:', error);
    res.redirect(`/admin/panel?section=lessons&courseId=${req.body.courseId}&error=Ошибка загрузки`);
  }
}

// Удаление файла урока
async function deleteLessonFile(req, res) {
  try {
    const { fileId } = req.params;
    const courseId = req.query.courseId;
    await lessonService.deleteLessonFile(fileId);
    res.redirect(`/admin/panel?section=lessons&courseId=${courseId}&success=Файл удален`);
  } catch (error) {
    logger.error('Delete file error:', error);
    res.redirect(`/admin/panel?section=lessons&courseId=${req.query.courseId}&error=Ошибка удаления`);
  }
}

// Создание теста
async function createTest(req, res) {
  try {
    const { lessonId, courseId, question } = req.body;
    const answers = [];
    for (let i = 0; i < 4; i++) {
      const answerText = req.body[`answer_${i}`];
      if (answerText && answerText.trim()) {
        answers.push({
          text: answerText.trim(),
          isCorrect: req.body.correct_answer === String(i),
        });
      }
    }

    await lessonService.createTest(lessonId, { question, answers });
    res.redirect(`/admin/panel?section=lessons&courseId=${courseId}&success=Тест сохранен`);
  } catch (error) {
    logger.error('Create test error:', error);
    res.redirect(`/admin/panel?section=lessons&courseId=${req.body.courseId}&error=Ошибка сохранения теста`);
  }
}

// Статистика пользователя
async function getUserStats(req, res) {
  try {
    const { userId } = req.params;
    const stats = await userService.getUserStats(userId);
    res.json(stats);
  } catch (error) {
    logger.error('Get user stats error:', error);
    res.status(500).json({ error: 'Ошибка загрузки статистики' });
  }
}

// Обновление настроек
async function updateSettings(req, res) {
  try {
    const settings = req.body;
    const currentSettings = database.readTable('bot_settings');
    
    for (const [key, value] of Object.entries(settings)) {
      const existing = currentSettings.find(s => s.key === key);
      if (existing) {
        existing.value = value;
      } else {
        currentSettings.push({ key, value });
      }
    }
    
    database.writeTable('bot_settings', currentSettings);
    res.redirect('/admin/panel?section=settings&success=Настройки сохранены');
  } catch (error) {
    logger.error('Update settings error:', error);
    res.redirect('/admin/panel?section=settings&error=Ошибка сохранения');
  }
}

module.exports = {
  dashboard,
  panel,
  createCourse,
  updateCourse,
  deleteCourse,
  createLesson,
  updateLesson,
  deleteLesson,
  uploadLessonFile,
  deleteLessonFile,
  createTest,
  getUserStats,
  updateSettings,
};
