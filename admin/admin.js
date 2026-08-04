const express = require('express');
const multer = require('multer');
const path = require('path');
const router = express.Router();
const config = require('../config');
const { checkAuth, login, logout } = require('./auth');
const controller = require('./controller');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.storage.maxFileSizeMb * 1024 * 1024,
  },
});

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
router.get('/', controller.dashboard);

// Панель управления (все разделы)
router.get('/panel', controller.panel);

// Курсы
router.post('/courses/create', controller.createCourse);
router.post('/courses/update', controller.updateCourse);
router.get('/courses/delete/:id', controller.deleteCourse);

// Уроки
router.post('/lessons/create', controller.createLesson);
router.post('/lessons/update', controller.updateLesson);
router.get('/lessons/delete/:id', controller.deleteLesson);

// Файлы уроков
router.post('/lessons/upload-file', upload.single('file'), controller.uploadLessonFile);
router.get('/lessons/delete-file/:fileId', controller.deleteLessonFile);

// Тесты
router.post('/lessons/create-test', controller.createTest);

// Статистика пользователя (API)
router.get('/api/users/:userId/stats', controller.getUserStats);

// Настройки
router.post('/settings/update', controller.updateSettings);

module.exports = router;
