const database = require('../database');
const userService = require('../core/user');
const courseService = require('../core/course');
const lessonService = require('../core/lesson');
const paymentService = require('../core/payment');
const storageService = require('../services/storage');
const logger = require('../logger');

async function dashboard(req, res) {
  try {
    const stats = await Promise.all([
      database.query('SELECT COUNT(*) as count FROM users'),
      database.query('SELECT COUNT(*) as count FROM courses'),
      database.query('SELECT COUNT(*) as count FROM lessons'),
      database.query('SELECT COUNT(*) as count FROM payments WHERE status = $1', ['success']),
      database.query('SELECT COUNT(*) as count FROM progress WHERE status = $1', ['completed']),
      database.query('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = $1', ['success']),
    ]);

    res.render('dashboard', {
      title: 'Панель управления',
      stats: {
        users: parseInt(stats[0].rows[0].count),
        courses: parseInt(stats[1].rows[0].count),
        lessons: parseInt(stats[2].rows[0].count),
        payments: parseInt(stats[3].rows[0].count),
        completedLessons: parseInt(stats[4].rows[0].count),
        revenue: parseFloat(stats[5].rows[0].total),
      },
    });
  } catch (error) {
    logger.error('Dashboard error:', error);
    res.status(500).send('Ошибка загрузки панели управления');
  }
}

async function panel(req, res) {
  try {
    const section = req.query.section || 'users';
    const page = parseInt(req.query.page) || 1;
    const limit = 50;
    const offset = (page - 1) * limit;
    
    let data = {};
    let total = 0;

    switch (section) {
      case 'users':
        const usersResult = await database.query(
          'SELECT * FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2',
          [limit, offset]
        );
        const usersCount = await database.query('SELECT COUNT(*) as total FROM users');
        data.users = usersResult.rows;
        total = parseInt(usersCount.rows[0].total);
        break;

      case 'courses':
        data.courses = await courseService.getAllCourses();
        break;

      case 'lessons':
        const courseId = req.query.courseId;
        if (courseId) {
          data.currentCourse = await courseService.getCourseById(courseId);
          data.lessons = await courseService.getCourseLessons(courseId);
        } else {
          data.courses = await courseService.getAllCourses();
          if (data.courses.length > 0) {
            data.lessons = await courseService.getCourseLessons(data.courses[0].id);
            data.currentCourse = data.courses[0];
          } else {
            data.lessons = [];
          }
        }
        break;

      case 'payments':
        const paymentsResult = await database.query(
          `SELECT p.*, u.first_name, u.last_name 
           FROM payments p 
           LEFT JOIN users u ON p.user_id = u.id 
           ORDER BY p.created_at DESC 
           LIMIT $1 OFFSET $2`,
          [limit, offset]
        );
        const paymentsCount = await database.query('SELECT COUNT(*) as total FROM payments');
        data.payments = paymentsResult.rows;
        total = parseInt(paymentsCount.rows[0].total);
        break;

      case 'settings':
        const settingsResult = await database.query('SELECT * FROM bot_settings ORDER BY key ASC');
        data.settings = {};
        settingsResult.rows.forEach(row => {
          data.settings[row.key] = row.value;
        });
        break;

      default:
        data.users = (await database.query('SELECT * FROM users ORDER BY created_at DESC LIMIT $1', [limit])).rows;
    }

    data.section = section;
    data.page = page;
    data.limit = limit;
    data.total = total;
    data.pages = Math.ceil(total / limit);

    res.render('panel', {
      title: 'Управление',
      data,
      error: req.query.error || null,
      success: req.query.success || null,
    });
  } catch (error) {
    logger.error('Panel error:', error);
    res.status(500).send('Ошибка загрузки панели управления');
  }
}

async function createCourse(req, res) {
  try {
    const { title, description, price } = req.body;
    if (!title) {
      return res.redirect('/admin/panel?section=courses&error=Название+курса+обязательно');
    }
    
    await courseService.createCourse({ title, description, price: parseFloat(price) || 0 });
    logger.info(`Course created by admin ${req.session.admin.login}`);
    res.redirect('/admin/panel?section=courses&success=Курс+создан');
  } catch (error) {
    logger.error('Create course error:', error);
    res.redirect('/admin/panel?section=courses&error=Ошибка+создания+курса');
  }
}

async function updateCourse(req, res) {
  try {
    const { id, title, description, price, isActive } = req.body;
    await courseService.updateCourse(id, {
      title,
      description,
      price: parseFloat(price),
      isActive: isActive === 'on',
    });
    logger.info(`Course updated: ${id}`);
    res.redirect('/admin/panel?section=courses&success=Курс+обновлен');
  } catch (error) {
    logger.error('Update course error:', error);
    res.redirect('/admin/panel?section=courses&error=Ошибка+обновления+курса');
  }
}

async function deleteCourse(req, res) {
  try {
    const { id } = req.params;
    await courseService.deleteCourse(id);
    logger.info(`Course deleted: ${id}`);
    res.redirect('/admin/panel?section=courses&success=Курс+удален');
  } catch (error) {
    logger.error('Delete course error:', error);
    res.redirect('/admin/panel?section=courses&error=Ошибка+удаления+курса');
  }
}

async function createLesson(req, res) {
  try {
    const { courseId, title, description, videoUrl, orderNumber, isFree } = req.body;
    if (!title || !courseId) {
      return res.redirect(`/admin/panel?section=lessons&courseId=${courseId}&error=Название+урока+обязательно`);
    }
    
    await lessonService.createLesson({
      courseId,
      title,
      description,
      videoUrl,
      orderNumber: parseInt(orderNumber) || 0,
      isFree: isFree === 'on',
    });
    
    res.redirect(`/admin/panel?section=lessons&courseId=${courseId}&success=Урок+создан`);
  } catch (error) {
    logger.error('Create lesson error:', error);
    res.redirect(`/admin/panel?section=lessons&error=Ошибка+создания+урока`);
  }
}

async function updateLesson(req, res) {
  try {
    const { id, courseId, title, description, videoUrl, orderNumber, isFree } = req.body;
    await lessonService.updateLesson(id, {
      title,
      description,
      videoUrl,
      orderNumber: parseInt(orderNumber),
      isFree: isFree === 'on',
    });
    
    res.redirect(`/admin/panel?section=lessons&courseId=${courseId}&success=Урок+обновлен`);
  } catch (error) {
    logger.error('Update lesson error:', error);
    res.redirect(`/admin/panel?section=lessons&error=Ошибка+обновления+урока`);
  }
}

async function deleteLesson(req, res) {
  try {
    const { id } = req.params;
    const courseId = req.query.courseId || '';
    await lessonService.deleteLesson(id);
    res.redirect(`/admin/panel?section=lessons&courseId=${courseId}&success=Урок+удален`);
  } catch (error) {
    logger.error('Delete lesson error:', error);
    res.redirect('/admin/panel?section=lessons&error=Ошибка+удаления+урока');
  }
}

async function uploadLessonFile(req, res) {
  try {
    const { lessonId, courseId } = req.body;
    
    if (!req.file) {
      return res.redirect(`/admin/panel?section=lessons&courseId=${courseId}&error=Файл+не+выбран`);
    }

    const fileData = await storageService.uploadFile(req.file, 'lessons');
    await lessonService.addLessonFile(lessonId, {
      filename: fileData.originalname,
      url: fileData.url,
      type: req.file.mimetype,
    });

    res.redirect(`/admin/panel?section=lessons&courseId=${courseId}&success=Файл+загружен`);
  } catch (error) {
    logger.error('Upload file error:', error);
    res.redirect(`/admin/panel?section=lessons&courseId=${req.body.courseId}&error=${encodeURIComponent(error.message)}`);
  }
}

async function deleteLessonFile(req, res) {
  try {
    const { fileId } = req.params;
    const courseId = req.query.courseId || '';
    await lessonService.deleteLessonFile(fileId);
    res.redirect(`/admin/panel?section=lessons&courseId=${courseId}&success=Файл+удален`);
  } catch (error) {
    logger.error('Delete file error:', error);
    res.redirect(`/admin/panel?section=lessons&error=Ошибка+удаления+файла`);
  }
}

async function createTest(req, res) {
  try {
    const { lessonId, courseId, question } = req.body;
    const answers = [];

    for (let i = 0; i < 4; i++) {
      const answerText = req.body[`answer_${i}`];
      if (answerText) {
        answers.push({
          text: answerText,
          isCorrect: req.body.correct_answer === String(i),
        });
      }
    }

    if (!question || answers.length < 2) {
      return res.redirect(`/admin/panel?section=lessons&courseId=${courseId}&error=Вопрос+и+минимум+2+ответа+обязательны`);
    }

    await lessonService.createTest(lessonId, { question, answers });
    res.redirect(`/admin/panel?section=lessons&courseId=${courseId}&success=Тест+сохранен`);
  } catch (error) {
    logger.error('Create test error:', error);
    res.redirect(`/admin/panel?section=lessons&error=Ошибка+сохранения+теста`);
  }
}

async function getUserStats(req, res) {
  try {
    const { userId } = req.params;
    const stats = await userService.getUserStats(userId);
    res.json(stats);
  } catch (error) {
    logger.error('User stats error:', error);
    res.status(500).json({ error: 'Ошибка загрузки статистики' });
  }
}

async function updateSettings(req, res) {
  try {
    const client = await database.getClient();
    
    try {
      await client.query('BEGIN');
      
      for (const [key, value] of Object.entries(req.body)) {
        if (key !== 'section') {
          await client.query(
            `INSERT INTO bot_settings (key, value) VALUES ($1, $2) 
             ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
            [key, value]
          );
        }
      }
      
      await client.query('COMMIT');
      logger.info(`Settings updated by admin ${req.session.admin.login}`);
      res.redirect('/admin/panel?section=settings&success=Настройки+сохранены');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('Update settings error:', error);
    res.redirect('/admin/panel?section=settings&error=Ошибка+сохранения+настроек');
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
