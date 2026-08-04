const express = require('express');
const router = express.Router();
const { checkAuth, login, logout } = require('./auth');
const adminController = require('./controller');

// Страница входа
router.get('/login', (req, res) => {
  if (req.session && req.session.admin) {
    return res.redirect('/admin');
  }
  res.render('login', { title: 'Вход', error: null, layout: false });
});

// API входа
router.post('/api/login', login);

// Выход
router.get('/logout', logout);

// Проверка авторизации для всех остальных роутов
router.use(checkAuth);

// Дашборд
router.get('/', adminController.dashboard);

// Панель управления (все разделы)
router.get('/panel', adminController.panel);

// Курсы
router.post('/courses/create', adminController.createCourse);
router.post('/courses/update', adminController.updateCourse);
router.get('/courses/delete/:id', adminController.deleteCourse);

// Уроки
router.post('/lessons/create', adminController.createLesson);
router.post('/lessons/update', adminController.updateLesson);
router.get('/lessons/delete/:id', adminController.deleteLesson);

// Файлы уроков
router.post('/lessons/upload-file', adminController.uploadLessonFile);
router.get('/lessons/delete-file/:fileId', adminController.deleteLessonFile);

// Тесты
router.post('/lessons/create-test', adminController.createTest);

// Статистика пользователя (API)
router.get('/api/users/:userId/stats', adminController.getUserStats);

// Настройки
router.post('/settings/update', adminController.updateSettings);

module.exports = router;
