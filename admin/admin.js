// admin/admin.js
// ПОЛНАЯ АДМИН-ПАНЕЛЬ

const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');    
const multer = require('multer');

const database = require('../database');
const logger = require('../logger');
const courseService = require('../core/course'); 
const lessonService = require('../core/lesson');
const userService = require('../core/user');
const progressService = require('../core/progress');
const paymentService = require('../core/payment');

// ============================================================
// МУЛЬТЕР ДЛЯ ЗАГРУЗКИ ФАЙЛОВ
// ============================================================

// admin/admin.js - ИСПРАВЛЕННОЕ СОЗДАНИЕ УРОКА

const UPLOADS_DIR = process.env.UPLOADS_DIR || '/tmp/uploads';

// Настройка multer для загрузки файлов
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        let subDir = 'files';
        if (file.mimetype && file.mimetype.startsWith('video/')) {
            subDir = 'videos';
        } else if (file.mimetype && file.mimetype.startsWith('image/')) {
            subDir = 'images';
        }
        
        const dir = path.join(UPLOADS_DIR, subDir);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const timestamp = Date.now();
        const random = Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname);
        const name = path.basename(file.originalname, ext);
        cb(null, `${name}-${timestamp}-${random}${ext}`);
    }
});

const upload = multer({
    storage: storage,
    limits: {
        fileSize: 250 * 1024 * 1024, // 250MB
    },
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'video/mp4', 'video/webm', 'video/quicktime', 'video/x-msvideo',
            'application/pdf', 'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/zip', 'application/x-zip-compressed',
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'text/plain', 'text/markdown',
        ];

        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`Неподдерживаемый тип файла: ${file.mimetype}`));
        }
    }
});

// ============================================================
// СОЗДАНИЕ УРОКА С ЗАГРУЗКОЙ ФАЙЛОВ
// ============================================================

router.post('/lessons/create', upload.fields([
    { name: 'videoFile', maxCount: 1 },
    { name: 'lessonFile', maxCount: 1 }
]), async (req, res) => {
    try {
        console.log('[ADMIN] Creating lesson...');
        console.log('[ADMIN] Body:', req.body);
        console.log('[ADMIN] Files:', req.files);

        const { courseId, title, description, orderNumber, isFree } = req.body;

        if (!courseId) {
            throw new Error('courseId is required');
        }

        // 1. Создаем урок
        const lesson = await lessonService.createLesson({
            courseId: courseId,
            title: title || 'Без названия',
            description: description || '',
            orderNumber: parseInt(orderNumber) || 0,
            isFree: isFree === 'on',
        });

        console.log(`[ADMIN] Lesson created: ${lesson.id}`);

        // 2. Обработка загруженного видео
        if (req.files && req.files.videoFile && req.files.videoFile[0]) {
            const file = req.files.videoFile[0];
            console.log(`[ADMIN] Processing video: ${file.originalname} (${file.size} bytes)`);
            
            const fileData = {
                filename: file.filename,
                originalname: file.originalname,
                size: file.size,
                mimetype: file.mimetype,
                path: file.path,
                url: `/uploads/videos/${file.filename}`,
            };
            
            const savedFile = await lessonService.addLessonFile(lesson.id, fileData);
            console.log(`[ADMIN] ✅ Video saved to DB: ${savedFile.id}`);
        }

        // 3. Обработка файла урока
        if (req.files && req.files.lessonFile && req.files.lessonFile[0]) {
            const file = req.files.lessonFile[0];
            console.log(`[ADMIN] Processing file: ${file.originalname} (${file.size} bytes)`);
            
            const fileData = {
                filename: file.filename,
                originalname: file.originalname,
                size: file.size,
                mimetype: file.mimetype,
                path: file.path,
                url: `/uploads/files/${file.filename}`,
            };
            
            const savedFile = await lessonService.addLessonFile(lesson.id, fileData);
            console.log(`[ADMIN] ✅ File saved to DB: ${savedFile.id}`);
        }

        console.log(`[ADMIN] ✅ Lesson created successfully: ${lesson.id}`);
        res.redirect('/admin/lessons?courseId=' + courseId);

    } catch (error) {
        console.error('[ADMIN] Create lesson error:', error);
        logger.error({ err: error }, 'Create lesson error');
        res.redirect('/admin/lessons?error=' + encodeURIComponent(error.message));
    }
});

// admin/admin.js - ОБНОВЛЕНИЕ УРОКА

router.post('/lessons/update', upload.fields([
    { name: 'videoFile', maxCount: 1 },
    { name: 'lessonFile', maxCount: 1 }
]), async (req, res) => {
    try {
        console.log('[ADMIN] Updating lesson...');
        console.log('[ADMIN] Body:', req.body);
        console.log('[ADMIN] Files:', req.files);

        const { id, courseId, title, description, orderNumber, isFree } = req.body;

        if (!id) {
            throw new Error('Lesson ID is required');
        }

        // 1. Обновляем данные урока
        await lessonService.updateLesson(id, {
            title: title || 'Без названия',
            description: description || '',
            orderNumber: parseInt(orderNumber) || 0,
            isFree: isFree === 'on',
        });

        console.log(`[ADMIN] Lesson updated: ${id}`);

        // 2. Обработка загруженного видео
        if (req.files && req.files.videoFile && req.files.videoFile[0]) {
            const file = req.files.videoFile[0];
            console.log(`[ADMIN] Processing video: ${file.originalname} (${file.size} bytes)`);
            
            // Удаляем старое видео, если есть
            const existingFiles = await lessonService.getLessonFiles(id);
            const oldVideo = existingFiles.find(f => f.type === 'video');
            if (oldVideo) {
                await lessonService.deleteLessonFile(oldVideo.id);
                console.log(`[ADMIN] Old video deleted: ${oldVideo.id}`);
            }
            
            const fileData = {
                filename: file.filename,
                originalname: file.originalname,
                size: file.size,
                mimetype: file.mimetype,
                path: file.path,
                url: `/uploads/videos/${file.filename}`,
            };
            
            const savedFile = await lessonService.addLessonFile(id, fileData);
            console.log(`[ADMIN] ✅ Video saved to DB: ${savedFile.id}`);
        }

        // 3. Обработка файла урока
        if (req.files && req.files.lessonFile && req.files.lessonFile[0]) {
            const file = req.files.lessonFile[0];
            console.log(`[ADMIN] Processing file: ${file.originalname} (${file.size} bytes)`);
            
            const fileData = {
                filename: file.filename,
                originalname: file.originalname,
                size: file.size,
                mimetype: file.mimetype,
                path: file.path,
                url: `/uploads/files/${file.filename}`,
            };
            
            const savedFile = await lessonService.addLessonFile(id, fileData);
            console.log(`[ADMIN] ✅ File saved to DB: ${savedFile.id}`);
        }

        console.log(`[ADMIN] ✅ Lesson updated successfully: ${id}`);
        res.redirect('/admin/lessons?courseId=' + courseId);

    } catch (error) {
        console.error('[ADMIN] Update lesson error:', error);
        logger.error({ err: error }, 'Update lesson error');
        res.redirect('/admin/lessons?error=' + encodeURIComponent(error.message));
    }
});

// ============================================================
// МИДЛВЭР АУТЕНТИФИКАЦИИ
// ============================================================

function checkAuth(req, res, next) {
    console.log('[ADMIN] checkAuth, session:', req.session);
    console.log('[ADMIN] adminId:', req.session?.adminId);
    
    if (req.session && req.session.adminId) {
        console.log('[ADMIN] Auth OK, user:', req.session.adminLogin);
        return next();
    }
    res.redirect('/admin/login');
}

async function getAdmin(req) {
    if (!req.session || !req.session.adminId) return null;
    const admins = database.readTable('admins');
    return admins.find(a => a.id === req.session.adminId) || null;
}

// ============================================================
// СТРАНИЦА ВХОДА
// ============================================================

router.get('/login', (req, res) => {
    if (req.session && req.session.adminId) {
        return res.redirect('/admin/');
    }
    res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Вход в админ-панель</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f0f2f5;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
        }
        .login-container {
            background: white;
            padding: 40px;
            border-radius: 16px;
            box-shadow: 0 8px 24px rgba(0,0,0,0.1);
            width: 100%;
            max-width: 400px;
        }
        .login-container h1 {
            font-size: 24px;
            color: #1a1a2e;
            margin-bottom: 8px;
            text-align: center;
        }
        .login-container .subtitle {
            color: #6c757d;
            text-align: center;
            margin-bottom: 30px;
            font-size: 14px;
        }
        .form-group {
            margin-bottom: 20px;
        }
        .form-group label {
            display: block;
            font-weight: 500;
            margin-bottom: 6px;
            color: #333;
            font-size: 14px;
        }
        .form-group input {
            width: 100%;
            padding: 12px 16px;
            border: 2px solid #e9ecef;
            border-radius: 10px;
            font-size: 14px;
            transition: border-color 0.2s;
        }
        .form-group input:focus {
            outline: none;
            border-color: #4361ee;
        }
        .btn {
            width: 100%;
            padding: 14px;
            background: #4361ee;
            color: white;
            border: none;
            border-radius: 10px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.2s;
        }
        .btn:hover {
            background: #3651d4;
        }
        .error {
            background: #fee2e2;
            color: #dc2626;
            padding: 12px;
            border-radius: 10px;
            margin-bottom: 20px;
            font-size: 14px;
            text-align: center;
        }
        .footer {
            margin-top: 20px;
            text-align: center;
            font-size: 13px;
            color: #6c757d;
        }
    </style>
</head>
<body>
    <div class="login-container">
        <h1>🔐 Админ-панель</h1>
        <p class="subtitle">Войдите для управления платформой</p>
        ${req.query.error ? `<div class="error">${req.query.error}</div>` : ''}
        <form method="POST" action="/admin/login">
            <div class="form-group">
                <label>Логин</label>
                <input type="text" name="login" placeholder="Введите логин" required>
            </div>
            <div class="form-group">
                <label>Пароль</label>
                <input type="password" name="password" placeholder="Введите пароль" required>
            </div>
            <button type="submit" class="btn">Войти</button>
        </form>
        <div class="footer">Обучающий бот платформа v1.0</div>
    </div>
</body>
</html>
    `);
});

router.post('/login', async (req, res) => {
    try {
        const { login, password } = req.body;

        if (!login || !password) {
            return res.redirect('/admin/login?error=' + encodeURIComponent('Введите логин и пароль'));
        }

        const admins = database.readTable('admins');
        const admin = admins.find(a => a.login === login);

        if (!admin) {
            return res.redirect('/admin/login?error=' + encodeURIComponent('Неверный логин или пароль'));
        }

        const isValid = await bcrypt.compare(password, admin.password_hash);

        if (!isValid) {
            return res.redirect('/admin/login?error=' + encodeURIComponent('Неверный логин или пароль'));
        }

        req.session.adminId = admin.id;
        req.session.adminLogin = admin.login;
        req.session.adminRole = admin.role;

        logger.info({ login, role: admin.role }, 'Admin logged in');

        // СОХРАНЯЕМ СЕССИЮ ЯВНО ПЕРЕД РЕДИРЕКТОМ
        req.session.save((err) => {
            if (err) {
                console.error('[ADMIN] Session save error:', err);
                return res.redirect('/admin/login?error=' + encodeURIComponent('Ошибка сессии'));
            }
            console.log('[ADMIN] Session saved, redirecting to /admin/');
            res.redirect('/admin/');
        });

    } catch (error) {
        logger.error({ err: error }, 'Login error');
        res.redirect('/admin/login?error=' + encodeURIComponent('Внутренняя ошибка сервера'));
    }
});

router.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/admin/login');
    });
});

// ============================================================
// ВСЕ РОУТЫ НИЖЕ ТРЕБУЮТ АУТЕНТИФИКАЦИЮ
// ============================================================

router.use(checkAuth);

// ============================================================
// ГЛАВНАЯ (ДАШБОРД)
// ============================================================

router.get('/', async (req, res) => {
    try {
        const admin = await getAdmin(req);
        const users = database.readTable('users');
        const courses = await courseService.getAllCourses();
        const lessons = database.readTable('lessons');
        const payments = database.readTable('payments');
        const progress = database.readTable('progress');

        const totalUsers = users.length;
        const totalCourses = courses.length;
        const totalLessons = lessons.length;
        const totalPayments = payments.filter(p => p.status === 'success').length;
        const totalRevenue = payments
            .filter(p => p.status === 'success')
            .reduce((sum, p) => sum + (p.amount || 0), 0);

        // Последние пользователи
        const recentUsers = users
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, 10);

        // Последние платежи
        const recentPayments = payments
            .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
            .slice(0, 10)
            .map(p => {
                const user = users.find(u => u.id === p.user_id);
                return { ...p, user_name: user ? `${user.first_name} ${user.last_name}` : 'Неизвестно' };
            });

        // Активность за последние 7 дней
        const now = new Date();
        const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const weeklyUsers = users.filter(u => new Date(u.created_at) > weekAgo).length;
        const weeklyPayments = payments.filter(p => 
            p.status === 'success' && new Date(p.created_at) > weekAgo
        ).length;

        res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Админ-панель</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f0f2f5;
        }
        .header {
            background: #1a1a2e;
            color: white;
            padding: 16px 30px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            position: sticky;
            top: 0;
            z-index: 100;
        }
        .header h1 { font-size: 20px; font-weight: 600; }
        .header .user-info {
            display: flex;
            align-items: center;
            gap: 16px;
        }
        .header .user-info span {
            color: #a0a0b8;
            font-size: 14px;
        }
        .header .user-info a {
            color: #f0f2f5;
            text-decoration: none;
            padding: 6px 14px;
            border-radius: 6px;
            background: #2d2d44;
            font-size: 14px;
            transition: background 0.2s;
        }
        .header .user-info a:hover {
            background: #3d3d5c;
        }
        .container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 24px 30px;
        }
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
        }
        .stat-card {
            background: white;
            border-radius: 12px;
            padding: 20px 24px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.06);
        }
        .stat-card .number {
            font-size: 32px;
            font-weight: 700;
            color: #1a1a2e;
        }
        .stat-card .label {
            color: #6c757d;
            font-size: 14px;
            margin-top: 4px;
        }
        .stat-card .change {
            font-size: 13px;
            margin-top: 8px;
            display: inline-block;
            padding: 2px 10px;
            border-radius: 12px;
        }
        .stat-card .change.up { background: #d4edda; color: #155724; }
        .stat-card .change.down { background: #f8d7da; color: #721c24; }
        .section {
            background: white;
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 24px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.06);
        }
        .section h2 {
            font-size: 18px;
            color: #1a1a2e;
            margin-bottom: 16px;
        }
        .section .empty {
            color: #6c757d;
            text-align: center;
            padding: 20px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
        }
        table th {
            text-align: left;
            padding: 10px 12px;
            border-bottom: 2px solid #e9ecef;
            font-weight: 600;
            color: #495057;
            font-size: 13px;
        }
        table td {
            padding: 10px 12px;
            border-bottom: 1px solid #f1f3f5;
            font-size: 14px;
        }
        table tr:hover td {
            background: #f8f9fa;
        }
        .badge {
            display: inline-block;
            padding: 2px 10px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 500;
        }
        .badge-success { background: #d4edda; color: #155724; }
        .badge-danger { background: #f8d7da; color: #721c24; }
        .badge-warning { background: #fff3cd; color: #856404; }
        .badge-info { background: #d1ecf1; color: #0c5460; }
        .nav-links {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
            margin-bottom: 24px;
        }
        .nav-links a {
            padding: 8px 18px;
            border-radius: 8px;
            text-decoration: none;
            color: #495057;
            background: white;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.2s;
            box-shadow: 0 2px 8px rgba(0,0,0,0.06);
        }
        .nav-links a:hover {
            background: #4361ee;
            color: white;
            transform: translateY(-1px);
        }
        .nav-links a.active {
            background: #4361ee;
            color: white;
        }
        @media (max-width: 768px) {
            .header { padding: 12px 16px; flex-wrap: wrap; gap: 8px; }
            .header h1 { font-size: 16px; }
            .container { padding: 16px; }
            .stats-grid { grid-template-columns: repeat(2, 1fr); gap: 12px; }
            .stat-card .number { font-size: 24px; }
        }
    </style>
</head>
<body>
    <header class="header">
        <h1>📚 Обучающий бот</h1>
        <div class="user-info">
            <span>👤 ${admin ? admin.login : 'Admin'}</span>
            <a href="/admin/logout">Выйти</a>
        </div>
    </header>

    <div class="container">
        <div class="nav-links">
            <a href="/admin" class="active">📊 Главная</a>
            <a href="/admin/courses">📚 Курсы</a>
            <a href="/admin/lessons">📖 Уроки</a>
            <a href="/admin/users">👤 Пользователи</a>
            <a href="/admin/payments">💳 Оплаты</a>
            <a href="/admin/settings">⚙️ Настройки</a>
            <a href="/admin/admins">👥 Администраторы</a>
            <a href="/admin/logs">📋 Логи</a>
            <a href="/admin/webhook">🔗 Webhook</a>
        </div>

        <div class="stats-grid">
            <div class="stat-card">
                <div class="number">${totalUsers}</div>
                <div class="label">👤 Пользователей</div>
                <div class="change up">+${weeklyUsers} за неделю</div>
            </div>
            <div class="stat-card">
                <div class="number">${totalCourses}</div>
                <div class="label">📚 Курсов</div>
            </div>
            <div class="stat-card">
                <div class="number">${totalLessons}</div>
                <div class="label">📖 Уроков</div>
            </div>
            <div class="stat-card">
                <div class="number">${totalPayments}</div>
                <div class="label">💳 Оплат</div>
                <div class="change up">+${weeklyPayments} за неделю</div>
            </div>
            <div class="stat-card">
                <div class="number">${totalRevenue} ₽</div>
                <div class="label">💰 Выручка</div>
            </div>
            <div class="stat-card">
                <div class="number">${progress.filter(p => p.status === 'completed').length}</div>
                <div class="label">✅ Пройдено уроков</div>
            </div>
        </div>

        <div class="section">
            <h2>👤 Последние пользователи</h2>
            ${recentUsers.length === 0 ? '<div class="empty">Нет пользователей</div>' : `
            <table>
                <tr>
                    <th>Имя</th>
                    <th>Платформа</th>
                    <th>Дата регистрации</th>
                </tr>
                ${recentUsers.map(u => `
                <tr>
                    <td>${u.first_name} ${u.last_name}</td>
                    <td><span class="badge badge-info">${u.platform}</span></td>
                    <td>${new Date(u.created_at).toLocaleDateString('ru-RU')}</td>
                </tr>
                `).join('')}
            </table>
            `}
        </div>

        <div class="section">
            <h2>💳 Последние платежи</h2>
            ${recentPayments.length === 0 ? '<div class="empty">Нет платежей</div>' : `
            <table>
                <tr>
                    <th>Пользователь</th>
                    <th>Сумма</th>
                    <th>Статус</th>
                    <th>Дата</th>
                </tr>
                ${recentPayments.map(p => `
                <tr>
                    <td>${p.user_name}</td>
                    <td>${p.amount} ₽</td>
                    <td><span class="badge ${p.status === 'success' ? 'badge-success' : 'badge-danger'}">${p.status === 'success' ? '✅ Успешно' : '❌ Ошибка'}</span></td>
                    <td>${new Date(p.created_at).toLocaleDateString('ru-RU')}</td>
                </tr>
                `).join('')}
            </table>
            `}
        </div>
    </div>
</body>
</html>
        `);
    } catch (error) {
        logger.error({ err: error }, 'Dashboard error');
        res.send('<h1>Ошибка</h1><p>' + error.message + '</p>');
    }
});

// ============================================================
// УПРАВЛЕНИЕ КУРСАМИ
// ============================================================

router.get('/courses', async (req, res) => {
    try {
        const courses = await courseService.getAllCourses(false);

        res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Курсы - Админ-панель</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f0f2f5;
        }
        .header {
            background: #1a1a2e;
            color: white;
            padding: 16px 30px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            position: sticky;
            top: 0;
            z-index: 100;
        }
        .header h1 { font-size: 20px; font-weight: 600; }
        .header .user-info {
            display: flex;
            align-items: center;
            gap: 16px;
        }
        .header .user-info a {
            color: #f0f2f5;
            text-decoration: none;
            padding: 6px 14px;
            border-radius: 6px;
            background: #2d2d44;
            font-size: 14px;
            transition: background 0.2s;
        }
        .header .user-info a:hover { background: #3d3d5c; }
        .container {
            max-width: 1400px;
            margin: 0 auto;
            padding: 24px 30px;
        }
        .nav-links {
            display: flex;
            gap: 8px;
            flex-wrap: wrap;
            margin-bottom: 24px;
        }
        .nav-links a {
            padding: 8px 18px;
            border-radius: 8px;
            text-decoration: none;
            color: #495057;
            background: white;
            font-size: 14px;
            font-weight: 500;
            transition: all 0.2s;
            box-shadow: 0 2px 8px rgba(0,0,0,0.06);
        }
        .nav-links a:hover { background: #4361ee; color: white; }
        .nav-links a.active { background: #4361ee; color: white; }
        .section {
            background: white;
            border-radius: 12px;
            padding: 24px;
            margin-bottom: 24px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.06);
        }
        .section h2 {
            font-size: 18px;
            color: #1a1a2e;
            margin-bottom: 16px;
        }
        .btn {
            padding: 8px 20px;
            border: none;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
        }
        .btn-primary { background: #4361ee; color: white; }
        .btn-primary:hover { background: #3651d4; }
        .btn-danger { background: #dc3545; color: white; }
        .btn-danger:hover { background: #c82333; }
        .btn-success { background: #28a745; color: white; }
        .btn-success:hover { background: #218838; }
        .btn-warning { background: #ffc107; color: #212529; }
        .btn-warning:hover { background: #e0a800; }
        .btn-sm { padding: 4px 12px; font-size: 12px; }
        table {
            width: 100%;
            border-collapse: collapse;
        }
        table th {
            text-align: left;
            padding: 10px 12px;
            border-bottom: 2px solid #e9ecef;
            font-weight: 600;
            color: #495057;
            font-size: 13px;
        }
        table td {
            padding: 10px 12px;
            border-bottom: 1px solid #f1f3f5;
            font-size: 14px;
        }
        table tr:hover td { background: #f8f9fa; }
        .badge {
            display: inline-block;
            padding: 2px 10px;
            border-radius: 12px;
            font-size: 12px;
            font-weight: 500;
        }
        .badge-success { background: #d4edda; color: #155724; }
        .badge-danger { background: #f8d7da; color: #721c24; }
        .badge-warning { background: #fff3cd; color: #856404; }
        .form-group {
            margin-bottom: 16px;
        }
        .form-group label {
            display: block;
            font-weight: 500;
            margin-bottom: 4px;
            color: #333;
            font-size: 14px;
        }
        .form-group input, .form-group textarea, .form-group select {
            width: 100%;
            padding: 10px 14px;
            border: 2px solid #e9ecef;
            border-radius: 8px;
            font-size: 14px;
            transition: border-color 0.2s;
        }
        .form-group input:focus, .form-group textarea:focus, .form-group select:focus {
            outline: none;
            border-color: #4361ee;
        }
        .form-group textarea { min-height: 80px; resize: vertical; }
        .form-row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 16px;
        }
        .modal-overlay {
            display: none;
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0,0,0,0.5);
            z-index: 1000;
            align-items: center;
            justify-content: center;
        }
        .modal-overlay.active { display: flex; }
        .modal {
            background: white;
            border-radius: 16px;
            padding: 32px;
            width: 100%;
            max-width: 600px;
            max-height: 90vh;
            overflow-y: auto;
        }
        .modal h2 {
            font-size: 20px;
            margin-bottom: 20px;
        }
        .modal .actions {
            display: flex;
            gap: 12px;
            margin-top: 20px;
        }
        .actions-right {
            display: flex;
            gap: 8px;
            justify-content: flex-end;
        }
        .empty {
            color: #6c757d;
            text-align: center;
            padding: 30px;
        }
        .toolbar {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 16px;
            flex-wrap: wrap;
            gap: 12px;
        }
        @media (max-width: 768px) {
            .header { padding: 12px 16px; }
            .container { padding: 16px; }
            .form-row { grid-template-columns: 1fr; }
            .modal { padding: 20px; margin: 16px; }
        }
    </style>
</head>
<body>
    <header class="header">
        <h1>📚 Обучающий бот</h1>
        <div class="user-info">
            <a href="/admin/logout">Выйти</a>
        </div>
    </header>

    <div class="container">
        <div class="nav-links">
            <a href="/admin">📊 Главная</a>
            <a href="/admin/courses" class="active">📚 Курсы</a>
            <a href="/admin/lessons">📖 Уроки</a>
            <a href="/admin/users">👤 Пользователи</a>
            <a href="/admin/payments">💳 Оплаты</a>
            <a href="/admin/settings">⚙️ Настройки</a>
            <a href="/admin/admins">👥 Администраторы</a>
            <a href="/admin/logs">📋 Логи</a>
            <a href="/admin/webhook">🔗 Webhook</a>
        </div>

        <div class="section">
            <div class="toolbar">
                <h2>📚 Все курсы</h2>
                <button class="btn btn-primary" onclick="openModal('createCourseModal')">+ Создать курс</button>
            </div>

            ${courses.length === 0 ? '<div class="empty">Нет созданных курсов</div>' : `
            <table>
                <tr>
                    <th>Название</th>
                    <th>Уроков</th>
                    <th>Цена</th>
                    <th>Статус</th>
                    <th>Действия</th>
                </tr>
                ${courses.map(c => `
                <tr>
                    <td><strong>${c.title}</strong><br><small style="color:#6c757d">${c.description ? c.description.substring(0, 50) + '...' : ''}</small></td>
                    <td>${c.lessonCount || 0}</td>
                    <td>${c.price > 0 ? c.price + ' ₽' : '🆓 Бесплатно'}</td>
                    <td><span class="badge ${c.is_active !== false ? 'badge-success' : 'badge-danger'}">${c.is_active !== false ? 'Активен' : 'Неактивен'}</span></td>
                    <td>
                        <button class="btn btn-primary btn-sm" onclick="editCourse('${c.id}')">✏️</button>
                        <button class="btn btn-danger btn-sm" onclick="deleteCourse('${c.id}')">🗑️</button>
                        <button class="btn btn-warning btn-sm" onclick="toggleCourse('${c.id}')">${c.is_active !== false ? '🔒' : '🔓'}</button>
                    </td>
                </tr>
                `).join('')}
            </table>
            `}
        </div>
    </div>

    <!-- Модалка создания курса -->
    <div class="modal-overlay" id="createCourseModal">
        <div class="modal">
            <h2>📚 Создать курс</h2>
            <form id="createCourseForm" method="POST" action="/admin/courses/create">
                <div class="form-group">
                    <label>Название *</label>
                    <input type="text" name="title" required>
                </div>
                <div class="form-group">
                    <label>Описание</label>
                    <textarea name="description"></textarea>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Цена (₽)</label>
                        <input type="number" name="price" value="0" min="0">
                    </div>
                    <div class="form-group">
                        <label>Порядок</label>
                        <input type="number" name="orderNumber" value="0">
                    </div>
                </div>
                <div class="form-group">
                    <label>
                        <input type="checkbox" name="isActive" checked>
                        Активен
                    </label>
                </div>
                <div class="actions">
                    <button type="submit" class="btn btn-success">✅ Создать</button>
                    <button type="button" class="btn" onclick="closeModal('createCourseModal')">Отмена</button>
                </div>
            </form>
        </div>
    </div>

    <script>
        function openModal(id) {
            document.getElementById(id).classList.add('active');
        }
        function closeModal(id) {
            document.getElementById(id).classList.remove('active');
        }
        function editCourse(id) {
            window.location.href = '/admin/courses/edit/' + id;
        }
        function deleteCourse(id) {
            if (confirm('Удалить курс?')) {
                window.location.href = '/admin/courses/delete/' + id;
            }
        }
        function toggleCourse(id) {
            window.location.href = '/admin/courses/toggle/' + id;
        }
        // Закрытие по клику вне модалки
        document.querySelectorAll('.modal-overlay').forEach(el => {
            el.addEventListener('click', function(e) {
                if (e.target === this) this.classList.remove('active');
            });
        });
    </script>
</body>
</html>
        `);
    } catch (error) {
        logger.error({ err: error }, 'Courses error');
        res.send('<h1>Ошибка</h1><p>' + error.message + '</p>');
    }
});

// Создание курса
router.post('/courses/create', async (req, res) => {
    try {
        const { title, description, price, orderNumber, isActive } = req.body;

        await courseService.createCourse({
            title,
            description,
            price: parseFloat(price) || 0,
            orderNumber: parseInt(orderNumber) || 0,
            isActive: isActive === 'on',
        });

        res.redirect('/admin/courses');
    } catch (error) {
        logger.error({ err: error }, 'Create course error');
        res.redirect('/admin/courses?error=' + encodeURIComponent(error.message));
    }
});

// Редактирование курса
router.get('/courses/edit/:id', async (req, res) => {
    try {
        const course = await courseService.getCourseById(req.params.id);
        if (!course) {
            return res.redirect('/admin/courses');
        }

        res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Редактирование курса</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f0f2f5;
        }
        .header {
            background: #1a1a2e;
            color: white;
            padding: 16px 30px;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .header h1 { font-size: 20px; }
        .header a { color: white; text-decoration: none; padding: 6px 14px; background: #2d2d44; border-radius: 6px; }
        .container { max-width: 800px; margin: 30px auto; padding: 0 20px; }
        .section {
            background: white;
            border-radius: 12px;
            padding: 30px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.06);
        }
        .section h2 { margin-bottom: 20px; }
        .form-group { margin-bottom: 16px; }
        .form-group label { display: block; font-weight: 500; margin-bottom: 4px; }
        .form-group input, .form-group textarea, .form-group select {
            width: 100%;
            padding: 10px 14px;
            border: 2px solid #e9ecef;
            border-radius: 8px;
            font-size: 14px;
        }
        .form-group input:focus, .form-group textarea:focus {
            outline: none;
            border-color: #4361ee;
        }
        .form-group textarea { min-height: 80px; resize: vertical; }
        .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .btn { padding: 10px 24px; border: none; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; }
        .btn-success { background: #28a745; color: white; }
        .btn-secondary { background: #6c757d; color: white; }
        .actions { display: flex; gap: 12px; margin-top: 20px; }
        .back-link { display: inline-block; margin-bottom: 16px; color: #4361ee; text-decoration: none; }
        .back-link:hover { text-decoration: underline; }
        @media (max-width: 768px) {
            .form-row { grid-template-columns: 1fr; }
            .header { padding: 12px 16px; }
            .container { padding: 0 12px; }
            .section { padding: 20px; }
        }
    </style>
</head>
<body>
    <header class="header">
        <h1>📚 Редактирование курса</h1>
        <a href="/admin/courses">← Назад</a>
    </header>

    <div class="container">
        <a href="/admin/courses" class="back-link">← Все курсы</a>

        <div class="section">
            <h2>${course.title}</h2>
            <form method="POST" action="/admin/courses/update">
                <input type="hidden" name="id" value="${course.id}">
                <div class="form-group">
                    <label>Название *</label>
                    <input type="text" name="title" value="${course.title}" required>
                </div>
                <div class="form-group">
                    <label>Описание</label>
                    <textarea name="description">${course.description || ''}</textarea>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Цена (₽)</label>
                        <input type="number" name="price" value="${course.price || 0}" min="0">
                    </div>
                    <div class="form-group">
                        <label>Порядок</label>
                        <input type="number" name="orderNumber" value="${course.order_number || 0}">
                    </div>
                </div>
                <div class="form-group">
                    <label>
                        <input type="checkbox" name="isActive" ${course.is_active !== false ? 'checked' : ''}>
                        Активен
                    </label>
                </div>
                <div class="actions">
                    <button type="submit" class="btn btn-success">💾 Сохранить</button>
                    <a href="/admin/courses" class="btn btn-secondary">Отмена</a>
                </div>
            </form>
        </div>
    </div>
</body>
</html>
        `);
    } catch (error) {
        logger.error({ err: error }, 'Edit course error');
        res.redirect('/admin/courses');
    }
});

router.post('/courses/update', async (req, res) => {
    try {
        const { id, title, description, price, orderNumber, isActive } = req.body;

        await courseService.updateCourse(id, {
            title,
            description,
            price: parseFloat(price) || 0,
            orderNumber: parseInt(orderNumber) || 0,
            isActive: isActive === 'on',
        });

        res.redirect('/admin/courses');
    } catch (error) {
        logger.error({ err: error }, 'Update course error');
        res.redirect('/admin/courses?error=' + encodeURIComponent(error.message));
    }
});

router.get('/courses/delete/:id', async (req, res) => {
    try {
        await courseService.deleteCourse(req.params.id);
        res.redirect('/admin/courses');
    } catch (error) {
        logger.error({ err: error }, 'Delete course error');
        res.redirect('/admin/courses?error=' + encodeURIComponent(error.message));
    }
});

router.get('/courses/toggle/:id', async (req, res) => {
    try {
        const course = await courseService.getCourseById(req.params.id);
        if (course) {
            await courseService.updateCourse(req.params.id, {
                isActive: course.is_active === false,
            });
        }
        res.redirect('/admin/courses');
    } catch (error) {
        logger.error({ err: error }, 'Toggle course error');
        res.redirect('/admin/courses?error=' + encodeURIComponent(error.message));
    }
});

// ============================================================
// УПРАВЛЕНИЕ УРОКАМИ
// ============================================================

router.get('/lessons', async (req, res) => {
    try {
        const courseId = req.query.courseId;
        const courses = await courseService.getAllCourses(false);

        let lessons = [];
        let selectedCourse = null;

        if (courseId) {
            lessons = await courseService.getCourseLessons(courseId);
            selectedCourse = await courseService.getCourseById(courseId);
        } else if (courses.length > 0) {
            selectedCourse = courses[0];
            lessons = await courseService.getCourseLessons(selectedCourse.id);
        }

        res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Уроки - Админ-панель</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f0f2f5; }
        .header { background: #1a1a2e; color: white; padding: 16px 30px; display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; z-index: 100; }
        .header h1 { font-size: 20px; }
        .header a { color: white; text-decoration: none; padding: 6px 14px; background: #2d2d44; border-radius: 6px; }
        .container { max-width: 1400px; margin: 0 auto; padding: 24px 30px; }
        .nav-links { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 24px; }
        .nav-links a { padding: 8px 18px; border-radius: 8px; text-decoration: none; color: #495057; background: white; font-size: 14px; font-weight: 500; box-shadow: 0 2px 8px rgba(0,0,0,0.06); transition: all 0.2s; }
        .nav-links a:hover { background: #4361ee; color: white; }
        .nav-links a.active { background: #4361ee; color: white; }
        .section { background: white; border-radius: 12px; padding: 24px; margin-bottom: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
        .section h2 { font-size: 18px; color: #1a1a2e; margin-bottom: 16px; }
        .toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 12px; }
        .btn { padding: 8px 20px; border: none; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s; }
        .btn-primary { background: #4361ee; color: white; }
        .btn-primary:hover { background: #3651d4; }
        .btn-danger { background: #dc3545; color: white; }
        .btn-danger:hover { background: #c82333; }
        .btn-success { background: #28a745; color: white; }
        .btn-success:hover { background: #218838; }
        .btn-warning { background: #ffc107; color: #212529; }
        .btn-warning:hover { background: #e0a800; }
        .btn-sm { padding: 4px 12px; font-size: 12px; }
        .btn-secondary { background: #6c757d; color: white; }
        .btn-secondary:hover { background: #5a6268; }
        table { width: 100%; border-collapse: collapse; }
        table th { text-align: left; padding: 10px 12px; border-bottom: 2px solid #e9ecef; font-weight: 600; color: #495057; font-size: 13px; }
        table td { padding: 10px 12px; border-bottom: 1px solid #f1f3f5; font-size: 14px; }
        table tr:hover td { background: #f8f9fa; }
        .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 500; }
        .badge-success { background: #d4edda; color: #155724; }
        .badge-info { background: #d1ecf1; color: #0c5460; }
        .badge-warning { background: #fff3cd; color: #856404; }
        .badge-danger { background: #f8d7da; color: #721c24; }
        .form-group { margin-bottom: 16px; }
        .form-group label { display: block; font-weight: 500; margin-bottom: 4px; color: #333; font-size: 14px; }
        .form-group input, .form-group textarea, .form-group select { width: 100%; padding: 10px 14px; border: 2px solid #e9ecef; border-radius: 8px; font-size: 14px; transition: border-color 0.2s; }
        .form-group input:focus, .form-group textarea:focus, .form-group select:focus { outline: none; border-color: #4361ee; }
        .form-group textarea { min-height: 80px; resize: vertical; }
        .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .modal-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center; }
        .modal-overlay.active { display: flex; }
        .modal { background: white; border-radius: 16px; padding: 32px; width: 100%; max-width: 600px; max-height: 90vh; overflow-y: auto; }
        .modal h2 { font-size: 20px; margin-bottom: 20px; }
        .modal .actions { display: flex; gap: 12px; margin-top: 20px; }
        .actions-right { display: flex; gap: 8px; justify-content: flex-end; }
        .empty { color: #6c757d; text-align: center; padding: 30px; }
        .course-selector { margin-bottom: 20px; }
        .course-selector select { padding: 10px 16px; border: 2px solid #e9ecef; border-radius: 8px; font-size: 14px; min-width: 200px; }
        @media (max-width: 768px) {
            .header { padding: 12px 16px; }
            .container { padding: 16px; }
            .form-row { grid-template-columns: 1fr; }
            .modal { padding: 20px; margin: 16px; }
        }
    </style>
</head>
<body>
    <header class="header">
        <h1>📚 Обучающий бот</h1>
        <a href="/admin/logout">Выйти</a>
    </header>

    <div class="container">
        <div class="nav-links">
            <a href="/admin">📊 Главная</a>
            <a href="/admin/courses">📚 Курсы</a>
            <a href="/admin/lessons" class="active">📖 Уроки</a>
            <a href="/admin/users">👤 Пользователи</a>
            <a href="/admin/payments">💳 Оплаты</a>
            <a href="/admin/settings">⚙️ Настройки</a>
            <a href="/admin/admins">👥 Администраторы</a>
            <a href="/admin/logs">📋 Логи</a>
            <a href="/admin/webhook">🔗 Webhook</a>
        </div>

        <div class="section">
            <div class="course-selector">
                <label style="font-weight:500;margin-right:12px;">Выберите курс:</label>
                <select onchange="window.location.href='/admin/lessons?courseId='+this.value">
                    ${courses.map(c => `
                        <option value="${c.id}" ${selectedCourse && selectedCourse.id === c.id ? 'selected' : ''}>
                            ${c.title}
                        </option>
                    `).join('')}
                </select>
            </div>

            <div class="toolbar">
                <h2>📖 Уроки ${selectedCourse ? '— ' + selectedCourse.title : ''}</h2>
                ${selectedCourse ? `<button class="btn btn-primary" onclick="openModal('createLessonModal')">+ Создать урок</button>` : ''}
            </div>

            ${!selectedCourse ? '<div class="empty">Выберите курс</div>' :
            lessons.length === 0 ? '<div class="empty">Нет уроков в этом курсе</div>' : `
            <table>
                <tr>
                    <th>#</th>
                    <th>Название</th>
                    <th>Тип</th>
                    <th>Статус</th>
                    <th>Действия</th>
                </tr>
                ${lessons.map((l, i) => `
                <tr>
                    <td>${l.order_number || i + 1}</td>
                    <td><strong>${l.title}</strong><br><small style="color:#6c757d">${l.description ? l.description.substring(0, 40) + '...' : ''}</small></td>
                    <td>${l.is_free ? '🆓 Бесплатный' : '💰 Платный'}</td>
                    <td><span class="badge ${l.video_url ? 'badge-success' : 'badge-warning'}">${l.video_url ? '🎬 Есть видео' : 'Нет видео'}</span></td>
                    <td>
                        <button class="btn btn-primary btn-sm" onclick="editLesson('${l.id}')">✏️</button>
                        <button class="btn btn-danger btn-sm" onclick="deleteLesson('${l.id}')">🗑️</button>
                        <button class="btn btn-warning btn-sm" onclick="toggleFree('${l.id}')">${l.is_free ? '🔒' : '🆓'}</button>
                    </td>
                </tr>
                `).join('')}
            </table>
            `}
        </div>
    </div>

    <!-- Модалка создания урока -->
    <div class="modal-overlay" id="createLessonModal">
        <div class="modal">
            <h2>📖 Создать урок</h2>
            <form method="POST" action="/admin/lessons/create" enctype="multipart/form-data">
                <input type="hidden" name="courseId" value="${selectedCourse ? selectedCourse.id : ''}">
                <div class="form-group">
                    <label>Название *</label>
                    <input type="text" name="title" required>
                </div>
                <div class="form-group">
                    <label>Описание</label>
                    <textarea name="description"></textarea>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Порядок</label>
                        <input type="number" name="orderNumber" value="${lessons.length + 1}">
                    </div>
                    <div class="form-group">
                        <label>
                            <input type="checkbox" name="isFree" checked>
                            Бесплатный
                        </label>
                    </div>
                </div>
                <div class="form-group">
                    <label>Видео (ссылка или загрузите ниже)</label>
                    <input type="text" name="videoUrl" placeholder="https://example.com/video.mp4">
                </div>
                <div class="form-group">
                    <label>Загрузить видео (до 50MB)</label>
                    <input type="file" name="videoFile" accept="video/*">
                </div>
                <div class="form-group">
                    <label>Файл к уроку</label>
                    <input type="file" name="lessonFile">
                </div>
                <div class="actions">
                    <button type="submit" class="btn btn-success">✅ Создать</button>
                    <button type="button" class="btn" onclick="closeModal('createLessonModal')">Отмена</button>
                </div>
            </form>
        </div>
    </div>

    <script>
        function openModal(id) { document.getElementById(id).classList.add('active'); }
        function closeModal(id) { document.getElementById(id).classList.remove('active'); }
        function editLesson(id) { window.location.href = '/admin/lessons/edit/' + id; }
        function deleteLesson(id) { if (confirm('Удалить урок?')) window.location.href = '/admin/lessons/delete/' + id; }
        function toggleFree(id) { window.location.href = '/admin/lessons/toggle-free/' + id; }
        document.querySelectorAll('.modal-overlay').forEach(el => {
            el.addEventListener('click', function(e) { if (e.target === this) this.classList.remove('active'); });
        });
    </script>
</body>
</html>
        `);
    } catch (error) {
        logger.error({ err: error }, 'Lessons error');
        res.send('<h1>Ошибка</h1><p>' + error.message + '</p>');
    }
});

// Создание урока
router.post('/lessons/create', upload.fields([
    { name: 'videoFile', maxCount: 1 },
    { name: 'lessonFile', maxCount: 1 }
]), async (req, res) => {
    try {
        const { courseId, title, description, orderNumber, isFree, videoUrl } = req.body;

        let videoUrlFinal = videoUrl || '';

        // Обработка загруженного видео
        if (req.files && req.files.videoFile && req.files.videoFile[0]) {
            const file = req.files.videoFile[0];
            videoUrlFinal = `/uploads/admin/${file.filename}`;
        }

        const lesson = await lessonService.createLesson({
            courseId,
            title,
            description,
            orderNumber: parseInt(orderNumber) || 0,
            isFree: isFree === 'on',
            videoUrl: videoUrlFinal,
        });

        // Обработка файла урока
        if (req.files && req.files.lessonFile && req.files.lessonFile[0]) {
            const file = req.files.lessonFile[0];
            await lessonService.addLessonFile(lesson.id, {
                filename: file.originalname,
                url: `/uploads/admin/${file.filename}`,
                type: file.mimetype,
                size: file.size,
            });
        }

        res.redirect('/admin/lessons?courseId=' + courseId);
    } catch (error) {
        logger.error({ err: error }, 'Create lesson error');
        res.redirect('/admin/lessons?error=' + encodeURIComponent(error.message));
    }
});

router.get('/lessons/edit/:id', async (req, res) => {
    try {
        const lesson = await lessonService.getLessonWithFiles(req.params.id);
        if (!lesson) return res.redirect('/admin/lessons');

        const courses = await courseService.getAllCourses(false);
        
        // Получаем файлы урока отдельно
        const files = await lessonService.getLessonFiles(req.params.id);
        const videoFile = files.find(f => f.type === 'video');
        const lessonFiles = files.filter(f => f.type !== 'video');

        res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Редактирование урока</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f0f2f5; }
        .header { background: #1a1a2e; color: white; padding: 16px 30px; display: flex; justify-content: space-between; align-items: center; }
        .header h1 { font-size: 20px; }
        .header a { color: white; text-decoration: none; padding: 6px 14px; background: #2d2d44; border-radius: 6px; }
        .container { max-width: 800px; margin: 30px auto; padding: 0 20px; }
        .section { background: white; border-radius: 12px; padding: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
        .section h2 { margin-bottom: 20px; }
        .form-group { margin-bottom: 16px; }
        .form-group label { display: block; font-weight: 500; margin-bottom: 4px; }
        .form-group input, .form-group textarea, .form-group select { width: 100%; padding: 10px 14px; border: 2px solid #e9ecef; border-radius: 8px; font-size: 14px; }
        .form-group input:focus, .form-group textarea:focus { outline: none; border-color: #4361ee; }
        .form-group textarea { min-height: 80px; resize: vertical; }
        .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .btn { padding: 10px 24px; border: none; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; }
        .btn-success { background: #28a745; color: white; }
        .btn-secondary { background: #6c757d; color: white; }
        .btn-danger { background: #dc3545; color: white; }
        .btn-danger:hover { background: #c82333; }
        .actions { display: flex; gap: 12px; margin-top: 20px; flex-wrap: wrap; }
        .back-link { display: inline-block; margin-bottom: 16px; color: #4361ee; text-decoration: none; }
        .back-link:hover { text-decoration: underline; }
        .file-list { margin: 8px 0; padding: 8px 12px; background: #f8f9fa; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; }
        .file-list a { color: #4361ee; text-decoration: none; }
        .file-list a:hover { text-decoration: underline; }
        .test-section { margin-top: 20px; padding: 16px; background: #f8f9fa; border-radius: 8px; }
        .test-section h3 { margin-bottom: 12px; }
        .answer-item { display: flex; align-items: center; gap: 12px; padding: 6px 0; }
        .answer-item input[type="text"] { flex: 1; }
        @media (max-width: 768px) {
            .form-row { grid-template-columns: 1fr; }
            .header { padding: 12px 16px; }
            .container { padding: 0 12px; }
            .section { padding: 20px; }
        }
    </style>
</head>
<body>
    <header class="header">
        <h1>📖 Редактирование урока</h1>
        <a href="/admin/lessons?courseId=${lesson.course_id}">← Назад</a>
    </header>

    <div class="container">
        <a href="/admin/lessons?courseId=${lesson.course_id}" class="back-link">← Все уроки</a>

        <div class="section">
            <h2>${lesson.title}</h2>

            <form method="POST" action="/admin/lessons/update" enctype="multipart/form-data">
                <input type="hidden" name="id" value="${lesson.id}">
                <input type="hidden" name="courseId" value="${lesson.course_id}">

                <div class="form-group">
                    <label>Название *</label>
                    <input type="text" name="title" value="${lesson.title}" required>
                </div>
                <div class="form-group">
                    <label>Описание</label>
                    <textarea name="description">${lesson.description || ''}</textarea>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label>Порядок</label>
                        <input type="number" name="orderNumber" value="${lesson.order_number || 0}">
                    </div>
                    <div class="form-group">
                        <label>
                            <input type="checkbox" name="isFree" ${lesson.is_free ? 'checked' : ''}>
                            Бесплатный
                        </label>
                    </div>
                </div>
                <div class="form-group">
                    <label>Видео (ссылка)</label>
                    <input type="text" name="videoUrl" value="${lesson.video_url || ''}" placeholder="https://example.com/video.mp4">
                </div>
                <div class="form-group">
                    <label>Заменить видео (до 50MB)</label>
                    <input type="file" name="videoFile" accept="video/*">
                </div>

                ${lesson.files && lesson.files.length > 0 ? `
                <div class="form-group">
                    <label>Прикрепленные файлы:</label>
                    ${lesson.files.map(f => `
                        <div class="file-list">
                            <a href="${f.url}" target="_blank">📎 ${f.filename}</a>
                            <a href="/admin/lessons/delete-file/${f.id}?courseId=${lesson.course_id}" onclick="return confirm('Удалить файл?')" style="color:#dc3545;">🗑️</a>
                        </div>
                    `).join('')}
                </div>
                ` : ''}

                <div class="form-group">
                    <label>Добавить файл к уроку</label>
                    <input type="file" name="lessonFile">
                </div>

                <div class="actions">
                    <button type="submit" class="btn btn-success">💾 Сохранить</button>
                    <a href="/admin/lessons?courseId=${lesson.course_id}" class="btn btn-secondary">Отмена</a>
                    <a href="/admin/lessons/delete/${lesson.id}" class="btn btn-danger" onclick="return confirm('Удалить урок?')">🗑️ Удалить</a>
                </div>
            </form>
        </div>

        <!-- ТЕСТЫ -->
        <div class="section">
            <h2>📝 Тест к уроку</h2>
            ${lesson.test ? `
                <div class="test-section">
                    <h3>Вопрос: ${lesson.test.question}</h3>
                    ${(lesson.test.answers || []).map(a => `
                        <div class="answer-item">
                            <span>${a.is_correct ? '✅' : '⬜'}</span>
                            <span>${a.answer}</span>
                        </div>
                    `).join('')}
                    <div style="margin-top:12px;">
                        <a href="/admin/lessons/edit-test/${lesson.id}" class="btn btn-warning">✏️ Редактировать тест</a>
                        <a href="/admin/lessons/delete-test/${lesson.id}?courseId=${lesson.course_id}" class="btn btn-danger" onclick="return confirm('Удалить тест?')">🗑️ Удалить</a>
                    </div>
                </div>
            ` : `
                <p style="color:#6c757d;margin-bottom:16px;">Тест не создан</p>
                <a href="/admin/lessons/create-test/${lesson.id}" class="btn btn-primary">+ Создать тест</a>
            `}
        </div>
    </div>
</body>
</html>
        `);
    } catch (error) {
        logger.error({ err: error }, 'Edit lesson error');
        res.redirect('/admin/lessons');
    }
});

// Обновление урока
router.post('/lessons/update', upload.fields([
    { name: 'videoFile', maxCount: 1 },
    { name: 'lessonFile', maxCount: 1 }
]), async (req, res) => {
    try {
        const { id, courseId, title, description, orderNumber, isFree, videoUrl } = req.body;

        let videoUrlFinal = videoUrl || '';

        if (req.files && req.files.videoFile && req.files.videoFile[0]) {
            const file = req.files.videoFile[0];
            videoUrlFinal = `/uploads/admin/${file.filename}`;
        }

        await lessonService.updateLesson(id, {
            title,
            description,
            orderNumber: parseInt(orderNumber) || 0,
            isFree: isFree === 'on',
            videoUrl: videoUrlFinal,
        });

        if (req.files && req.files.lessonFile && req.files.lessonFile[0]) {
            const file = req.files.lessonFile[0];
            await lessonService.addLessonFile(id, {
                filename: file.originalname,
                url: `/uploads/admin/${file.filename}`,
                type: file.mimetype,
                size: file.size,
            });
        }

        res.redirect('/admin/lessons?courseId=' + courseId);
    } catch (error) {
        logger.error({ err: error }, 'Update lesson error');
        res.redirect('/admin/lessons?error=' + encodeURIComponent(error.message));
    }
});

router.get('/lessons/delete/:id', async (req, res) => {
    try {
        const lesson = await lessonService.getLessonById(req.params.id);
        const courseId = lesson ? lesson.course_id : '';
        await lessonService.deleteLesson(req.params.id);
        res.redirect('/admin/lessons?courseId=' + courseId);
    } catch (error) {
        logger.error({ err: error }, 'Delete lesson error');
        res.redirect('/admin/lessons');
    }
});

router.get('/lessons/toggle-free/:id', async (req, res) => {
    try {
        const lesson = await lessonService.getLessonById(req.params.id);
        if (lesson) {
            await lessonService.updateLesson(req.params.id, {
                isFree: !lesson.is_free,
            });
        }
        res.redirect('/admin/lessons?courseId=' + (lesson ? lesson.course_id : ''));
    } catch (error) {
        logger.error({ err: error }, 'Toggle free error');
        res.redirect('/admin/lessons');
    }
});

router.get('/lessons/delete-file/:fileId', async (req, res) => {
    try {
        const file = database.readTable('lesson_files').find(f => f.id === req.params.fileId);
        const courseId = req.query.courseId || '';
        await lessonService.deleteLessonFile(req.params.fileId);
        res.redirect('/admin/lessons?courseId=' + courseId);
    } catch (error) {
        logger.error({ err: error }, 'Delete file error');
        res.redirect('/admin/lessons');
    }
});

// Управление тестами
router.get('/lessons/create-test/:lessonId', async (req, res) => {
    try {
        const lesson = await lessonService.getLessonById(req.params.lessonId);
        if (!lesson) return res.redirect('/admin/lessons');

        res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Создание теста</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f0f2f5; }
        .header { background: #1a1a2e; color: white; padding: 16px 30px; display: flex; justify-content: space-between; align-items: center; }
        .header h1 { font-size: 20px; }
        .header a { color: white; text-decoration: none; padding: 6px 14px; background: #2d2d44; border-radius: 6px; }
        .container { max-width: 700px; margin: 30px auto; padding: 0 20px; }
        .section { background: white; border-radius: 12px; padding: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
        .section h2 { margin-bottom: 20px; }
        .form-group { margin-bottom: 16px; }
        .form-group label { display: block; font-weight: 500; margin-bottom: 4px; }
        .form-group input, .form-group textarea { width: 100%; padding: 10px 14px; border: 2px solid #e9ecef; border-radius: 8px; font-size: 14px; }
        .form-group input:focus, .form-group textarea:focus { outline: none; border-color: #4361ee; }
        .answer-row { display: flex; gap: 12px; align-items: center; margin-bottom: 8px; }
        .answer-row input[type="text"] { flex: 1; padding: 8px 12px; border: 2px solid #e9ecef; border-radius: 6px; font-size: 14px; }
        .answer-row input[type="checkbox"] { width: 20px; height: 20px; }
        .btn { padding: 10px 24px; border: none; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; }
        .btn-success { background: #28a745; color: white; }
        .btn-secondary { background: #6c757d; color: white; }
        .btn-danger { background: #dc3545; color: white; }
        .actions { display: flex; gap: 12px; margin-top: 20px; flex-wrap: wrap; }
        .back-link { display: inline-block; margin-bottom: 16px; color: #4361ee; text-decoration: none; }
        .back-link:hover { text-decoration: underline; }
        .add-btn { background: #4361ee; color: white; border: none; padding: 6px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; }
        .add-btn:hover { background: #3651d4; }
        @media (max-width: 768px) {
            .header { padding: 12px 16px; }
            .container { padding: 0 12px; }
            .section { padding: 20px; }
            .answer-row { flex-wrap: wrap; }
        }
    </style>
</head>
<body>
    <header class="header">
        <h1>📝 Создание теста</h1>
        <a href="/admin/lessons/edit/${lesson.id}">← Назад к уроку</a>
    </header>

    <div class="container">
        <a href="/admin/lessons/edit/${lesson.id}" class="back-link">← К уроку: ${lesson.title}</a>

        <div class="section">
            <h2>📝 Тест для урока</h2>
            <form method="POST" action="/admin/lessons/create-test">
                <input type="hidden" name="lessonId" value="${lesson.id}">
                <div class="form-group">
                    <label>Вопрос *</label>
                    <input type="text" name="question" placeholder="Введите вопрос теста" required>
                </div>

                <div class="form-group">
                    <label>Варианты ответа:</label>
                    <div id="answers">
                        <div class="answer-row">
                            <input type="text" name="answers[]" placeholder="Вариант ответа" required>
                            <label><input type="checkbox" name="correct[]" value="0"> Правильный</label>
                        </div>
                        <div class="answer-row">
                            <input type="text" name="answers[]" placeholder="Вариант ответа" required>
                            <label><input type="checkbox" name="correct[]" value="1"> Правильный</label>
                        </div>
                        <div class="answer-row">
                            <input type="text" name="answers[]" placeholder="Вариант ответа" required>
                            <label><input type="checkbox" name="correct[]" value="2"> Правильный</label>
                        </div>
                        <div class="answer-row">
                            <input type="text" name="answers[]" placeholder="Вариант ответа" required>
                            <label><input type="checkbox" name="correct[]" value="3"> Правильный</label>
                        </div>
                    </div>
                    <button type="button" class="add-btn" onclick="addAnswer()">+ Добавить вариант</button>
                </div>

                <div class="actions">
                    <button type="submit" class="btn btn-success">✅ Создать тест</button>
                    <a href="/admin/lessons/edit/${lesson.id}" class="btn btn-secondary">Отмена</a>
                </div>
            </form>
        </div>
    </div>

    <script>
        let answerCount = 4;
        function addAnswer() {
            const container = document.getElementById('answers');
            const row = document.createElement('div');
            row.className = 'answer-row';
            row.innerHTML = \`
                <input type="text" name="answers[]" placeholder="Вариант ответа" required>
                <label><input type="checkbox" name="correct[]" value="\${answerCount}"> Правильный</label>
                <button type="button" onclick="this.parentElement.remove()" style="background:#dc3545;color:white;border:none;border-radius:4px;padding:4px 10px;cursor:pointer;">✕</button>
            \`;
            container.appendChild(row);
            answerCount++;
        }
    </script>
</body>
</html>
        `);
    } catch (error) {
        logger.error({ err: error }, 'Create test page error');
        res.redirect('/admin/lessons');
    }
});

router.post('/lessons/create-test', async (req, res) => {
    try {
        const { lessonId, question, answers, correct } = req.body;

        const answerList = [];
        for (let i = 0; i < answers.length; i++) {
            if (answers[i] && answers[i].trim()) {
                answerList.push({
                    text: answers[i].trim(),
                    isCorrect: correct && correct.includes(i.toString()),
                });
            }
        }

        await lessonService.createTest(lessonId, {
            question: question || 'Проверьте свои знания',
            answers: answerList,
        });

        res.redirect('/admin/lessons/edit/' + lessonId);
    } catch (error) {
        logger.error({ err: error }, 'Create test error');
        res.redirect('/admin/lessons');
    }
});

router.get('/lessons/edit-test/:lessonId', async (req, res) => {
    try {
        const lesson = await lessonService.getLessonById(req.params.lessonId);
        const test = await lessonService.getLessonTest(req.params.lessonId);
        if (!lesson || !test) return res.redirect('/admin/lessons');

        res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Редактирование теста</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f0f2f5; }
        .header { background: #1a1a2e; color: white; padding: 16px 30px; display: flex; justify-content: space-between; align-items: center; }
        .header h1 { font-size: 20px; }
        .header a { color: white; text-decoration: none; padding: 6px 14px; background: #2d2d44; border-radius: 6px; }
        .container { max-width: 700px; margin: 30px auto; padding: 0 20px; }
        .section { background: white; border-radius: 12px; padding: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
        .section h2 { margin-bottom: 20px; }
        .form-group { margin-bottom: 16px; }
        .form-group label { display: block; font-weight: 500; margin-bottom: 4px; }
        .form-group input, .form-group textarea { width: 100%; padding: 10px 14px; border: 2px solid #e9ecef; border-radius: 8px; font-size: 14px; }
        .form-group input:focus, .form-group textarea:focus { outline: none; border-color: #4361ee; }
        .answer-row { display: flex; gap: 12px; align-items: center; margin-bottom: 8px; }
        .answer-row input[type="text"] { flex: 1; padding: 8px 12px; border: 2px solid #e9ecef; border-radius: 6px; font-size: 14px; }
        .answer-row input[type="checkbox"] { width: 20px; height: 20px; }
        .btn { padding: 10px 24px; border: none; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; }
        .btn-success { background: #28a745; color: white; }
        .btn-secondary { background: #6c757d; color: white; }
        .btn-danger { background: #dc3545; color: white; }
        .actions { display: flex; gap: 12px; margin-top: 20px; flex-wrap: wrap; }
        .back-link { display: inline-block; margin-bottom: 16px; color: #4361ee; text-decoration: none; }
        .back-link:hover { text-decoration: underline; }
        .add-btn { background: #4361ee; color: white; border: none; padding: 6px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; }
        .add-btn:hover { background: #3651d4; }
        @media (max-width: 768px) {
            .header { padding: 12px 16px; }
            .container { padding: 0 12px; }
            .section { padding: 20px; }
            .answer-row { flex-wrap: wrap; }
        }
    </style>
</head>
<body>
    <header class="header">
        <h1>✏️ Редактирование теста</h1>
        <a href="/admin/lessons/edit/${lesson.id}">← Назад к уроку</a>
    </header>

    <div class="container">
        <a href="/admin/lessons/edit/${lesson.id}" class="back-link">← К уроку: ${lesson.title}</a>

        <div class="section">
            <h2>✏️ Редактировать тест</h2>
            <form method="POST" action="/admin/lessons/update-test">
                <input type="hidden" name="testId" value="${test.id}">
                <input type="hidden" name="lessonId" value="${lesson.id}">
                <div class="form-group">
                    <label>Вопрос *</label>
                    <input type="text" name="question" value="${test.question}" required>
                </div>

                <div class="form-group">
                    <label>Варианты ответа:</label>
                    <div id="answers">
                        ${(test.answers || []).map((a, i) => `
                            <div class="answer-row">
                                <input type="text" name="answers[]" value="${a.answer}" required>
                                <label><input type="checkbox" name="correct[]" value="${i}" ${a.is_correct ? 'checked' : ''}> Правильный</label>
                                <button type="button" onclick="this.parentElement.remove()" style="background:#dc3545;color:white;border:none;border-radius:4px;padding:4px 10px;cursor:pointer;">✕</button>
                            </div>
                        `).join('')}
                    </div>
                    <button type="button" class="add-btn" onclick="addAnswer()">+ Добавить вариант</button>
                </div>

                <div class="actions">
                    <button type="submit" class="btn btn-success">💾 Сохранить</button>
                    <a href="/admin/lessons/edit/${lesson.id}" class="btn btn-secondary">Отмена</a>
                </div>
            </form>
        </div>
    </div>

    <script>
        let answerCount = ${(test.answers || []).length};
        function addAnswer() {
            const container = document.getElementById('answers');
            const row = document.createElement('div');
            row.className = 'answer-row';
            row.innerHTML = \`
                <input type="text" name="answers[]" placeholder="Вариант ответа" required>
                <label><input type="checkbox" name="correct[]" value="\${answerCount}"> Правильный</label>
                <button type="button" onclick="this.parentElement.remove()" style="background:#dc3545;color:white;border:none;border-radius:4px;padding:4px 10px;cursor:pointer;">✕</button>
            \`;
            container.appendChild(row);
            answerCount++;
        }
    </script>
</body>
</html>
        `);
    } catch (error) {
        logger.error({ err: error }, 'Edit test page error');
        res.redirect('/admin/lessons');
    }
});

router.post('/lessons/update-test', async (req, res) => {
    try {
        const { testId, lessonId, question, answers, correct } = req.body;

        const answerList = [];
        for (let i = 0; i < answers.length; i++) {
            if (answers[i] && answers[i].trim()) {
                answerList.push({
                    text: answers[i].trim(),
                    isCorrect: correct && correct.includes(i.toString()),
                });
            }
        }

        const lessonService = require('../core/lesson');
        await lessonService.updateTest(testId, {
            question: question || 'Проверьте свои знания',
            answers: answerList,
        });

        res.redirect('/admin/lessons/edit/' + lessonId);
    } catch (error) {
        logger.error({ err: error }, 'Update test error');
        res.redirect('/admin/lessons');
    }
});

router.get('/lessons/delete-test/:testId', async (req, res) => {
    try {
        const courseId = req.query.courseId || '';
        await lessonService.deleteTest(req.params.testId);
        res.redirect('/admin/lessons?courseId=' + courseId);
    } catch (error) {
        logger.error({ err: error }, 'Delete test error');
        res.redirect('/admin/lessons');
    }
});

// ============================================================
// УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ
// ============================================================

router.get('/users', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 50;
        const result = await userService.getAllUsers(page, limit);

        res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Пользователи - Админ-панель</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f0f2f5; }
        .header { background: #1a1a2e; color: white; padding: 16px 30px; display: flex; justify-content: space-between; align-items: center; }
        .header h1 { font-size: 20px; }
        .header a { color: white; text-decoration: none; padding: 6px 14px; background: #2d2d44; border-radius: 6px; }
        .container { max-width: 1400px; margin: 0 auto; padding: 24px 30px; }
        .nav-links { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 24px; }
        .nav-links a { padding: 8px 18px; border-radius: 8px; text-decoration: none; color: #495057; background: white; font-size: 14px; font-weight: 500; box-shadow: 0 2px 8px rgba(0,0,0,0.06); transition: all 0.2s; }
        .nav-links a:hover { background: #4361ee; color: white; }
        .nav-links a.active { background: #4361ee; color: white; }
        .section { background: white; border-radius: 12px; padding: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
        .section h2 { font-size: 18px; color: #1a1a2e; margin-bottom: 16px; }
        .toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 12px; }
        .btn { padding: 8px 20px; border: none; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s; }
        .btn-primary { background: #4361ee; color: white; }
        .btn-primary:hover { background: #3651d4; }
        .btn-sm { padding: 4px 12px; font-size: 12px; }
        table { width: 100%; border-collapse: collapse; }
        table th { text-align: left; padding: 10px 12px; border-bottom: 2px solid #e9ecef; font-weight: 600; color: #495057; font-size: 13px; }
        table td { padding: 10px 12px; border-bottom: 1px solid #f1f3f5; font-size: 14px; }
        table tr:hover td { background: #f8f9fa; }
        .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 500; }
        .badge-info { background: #d1ecf1; color: #0c5460; }
        .badge-success { background: #d4edda; color: #155724; }
        .empty { color: #6c757d; text-align: center; padding: 30px; }
        .pagination { display: flex; gap: 8px; margin-top: 16px; justify-content: center; }
        .pagination a { padding: 6px 14px; border: 1px solid #dee2e6; border-radius: 6px; text-decoration: none; color: #495057; }
        .pagination a.active { background: #4361ee; color: white; border-color: #4361ee; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; margin-bottom: 20px; }
        .stat-item { text-align: center; padding: 12px; background: #f8f9fa; border-radius: 8px; }
        .stat-item .num { font-size: 24px; font-weight: 700; color: #1a1a2e; }
        .stat-item .label { color: #6c757d; font-size: 13px; }
        @media (max-width: 768px) {
            .header { padding: 12px 16px; }
            .container { padding: 16px; }
        }
    </style>
</head>
<body>
    <header class="header">
        <h1>📚 Обучающий бот</h1>
        <a href="/admin/logout">Выйти</a>
    </header>

    <div class="container">
        <div class="nav-links">
            <a href="/admin">📊 Главная</a>
            <a href="/admin/courses">📚 Курсы</a>
            <a href="/admin/lessons">📖 Уроки</a>
            <a href="/admin/users" class="active">👤 Пользователи</a>
            <a href="/admin/payments">💳 Оплаты</a>
            <a href="/admin/settings">⚙️ Настройки</a>
            <a href="/admin/admins">👥 Администраторы</a>
            <a href="/admin/logs">📋 Логи</a>
            <a href="/admin/webhook">🔗 Webhook</a>
        </div>

        <div class="section">
            <h2>👤 Пользователи</h2>
            <div class="stats">
                <div class="stat-item">
                    <div class="num">${result.total}</div>
                    <div class="label">Всего</div>
                </div>
                <div class="stat-item">
                    <div class="num">${result.users.filter(u => u.platform === 'max').length}</div>
                    <div class="label">MAX</div>
                </div>
                <div class="stat-item">
                    <div class="num">${result.users.filter(u => u.platform === 'vk').length}</div>
                    <div class="label">VK</div>
                </div>
            </div>

            ${result.users.length === 0 ? '<div class="empty">Нет пользователей</div>' : `
            <table>
                <tr>
                    <th>Имя</th>
                    <th>Платформа</th>
                    <th>Дата регистрации</th>
                    <th>Действия</th>
                </tr>
                ${result.users.map(u => `
                <tr>
                    <td><strong>${u.first_name} ${u.last_name}</strong><br><small style="color:#6c757d">${u.username || ''}</small></td>
                    <td><span class="badge badge-info">${u.platform}</span></td>
                    <td>${new Date(u.created_at).toLocaleDateString('ru-RU')} ${new Date(u.created_at).toLocaleTimeString('ru-RU', {hour:'2-digit',minute:'2-digit'})}</td>
                    <td>
                        <a href="/admin/users/${u.id}" class="btn btn-primary btn-sm">👤 Профиль</a>
                    </td>
                </tr>
                `).join('')}
            </table>
            ${result.total > result.limit ? `
            <div class="pagination">
                ${Array.from({length: Math.ceil(result.total / result.limit)}, (_, i) => i + 1).map(p => `
                    <a href="/admin/users?page=${p}" class="${p === result.page ? 'active' : ''}">${p}</a>
                `).join('')}
            </div>
            ` : ''}
            `}
        </div>
    </div>
</body>
</html>
        `);
    } catch (error) {
        logger.error({ err: error }, 'Users error');
        res.send('<h1>Ошибка</h1><p>' + error.message + '</p>');
    }
});

// Профиль пользователя
router.get('/users/:id', async (req, res) => {
    try {
        const user = await userService.getUserById(req.params.id);
        if (!user) return res.redirect('/admin/users');

        const stats = await userService.getUserStats(user.id);
        const progress = await progressService.getUserProgress(user.id);
        const summary = await progressService.getProgressSummary(user.id);
        const payments = await paymentService.getUserPayments(user.id);

        res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Профиль пользователя</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f0f2f5; }
        .header { background: #1a1a2e; color: white; padding: 16px 30px; display: flex; justify-content: space-between; align-items: center; }
        .header h1 { font-size: 20px; }
        .header a { color: white; text-decoration: none; padding: 6px 14px; background: #2d2d44; border-radius: 6px; }
        .container { max-width: 1000px; margin: 30px auto; padding: 0 20px; }
        .card { background: white; border-radius: 12px; padding: 24px; margin-bottom: 20px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
        .card h2 { font-size: 18px; margin-bottom: 16px; }
        .back-link { display: inline-block; margin-bottom: 16px; color: #4361ee; text-decoration: none; }
        .back-link:hover { text-decoration: underline; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .stat { padding: 12px; background: #f8f9fa; border-radius: 8px; text-align: center; }
        .stat .num { font-size: 28px; font-weight: 700; color: #1a1a2e; }
        .stat .label { color: #6c757d; font-size: 13px; }
        table { width: 100%; border-collapse: collapse; }
        table th { text-align: left; padding: 8px 12px; border-bottom: 2px solid #e9ecef; font-weight: 600; color: #495057; font-size: 13px; }
        table td { padding: 8px 12px; border-bottom: 1px solid #f1f3f5; font-size: 14px; }
        .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 500; }
        .badge-success { background: #d4edda; color: #155724; }
        .badge-warning { background: #fff3cd; color: #856404; }
        .badge-info { background: #d1ecf1; color: #0c5460; }
        @media (max-width: 768px) {
            .header { padding: 12px 16px; }
            .container { padding: 0 12px; }
            .grid { grid-template-columns: 1fr; }
        }
    </style>
</head>
<body>
    <header class="header">
        <h1>📚 Обучающий бот</h1>
        <a href="/admin/logout">Выйти</a>
    </header>

    <div class="container">
        <a href="/admin/users" class="back-link">← Все пользователи</a>

        <div class="card">
            <h2>👤 ${user.first_name} ${user.last_name}</h2>
            <p><strong>ID:</strong> ${user.id}</p>
            <p><strong>Платформа:</strong> ${user.platform}</p>
            <p><strong>Username:</strong> ${user.username || '—'}</p>
            <p><strong>Зарегистрирован:</strong> ${new Date(user.created_at).toLocaleString('ru-RU')}</p>
        </div>

        <div class="card">
            <h2>📊 Статистика</h2>
            <div class="grid">
                <div class="stat">
                    <div class="num">${summary.totalLessons}</div>
                    <div class="label">Всего уроков</div>
                </div>
                <div class="stat">
                    <div class="num">${summary.completedLessons}</div>
                    <div class="label">Пройдено уроков</div>
                </div>
                <div class="stat">
                    <div class="num">${payments.filter(p => p.status === 'success').length}</div>
                    <div class="label">Оплат</div>
                </div>
                <div class="stat">
                    <div class="num">${stats.courseAccess ? stats.courseAccess.length : 0}</div>
                    <div class="label">Доступно курсов</div>
                </div>
            </div>
        </div>

        ${progress.length > 0 ? `
        <div class="card">
            <h2>📖 Прогресс по урокам</h2>
            <table>
                <tr>
                    <th>Урок</th>
                    <th>Курс</th>
                    <th>Статус</th>
                    <th>Дата</th>
                </tr>
                ${progress.slice(0, 20).map(p => `
                <tr>
                    <td>${p.lesson_title}</td>
                    <td>${p.course_title}</td>
                    <td><span class="badge ${p.status === 'completed' ? 'badge-success' : 'badge-warning'}">${p.status === 'completed' ? '✅ Пройден' : '📖 В процессе'}</span></td>
                    <td>${p.completed_at ? new Date(p.completed_at).toLocaleDateString('ru-RU') : '—'}</td>
                </tr>
                `).join('')}
            </table>
        </div>
        ` : ''}

        ${payments.length > 0 ? `
        <div class="card">
            <h2>💳 Платежи</h2>
            <table>
                <tr>
                    <th>Сумма</th>
                    <th>Статус</th>
                    <th>Дата</th>
                </tr>
                ${payments.map(p => `
                <tr>
                    <td>${p.amount} ₽</td>
                    <td><span class="badge ${p.status === 'success' ? 'badge-success' : 'badge-warning'}">${p.status === 'success' ? '✅ Успешно' : '⏳ В обработке'}</span></td>
                    <td>${new Date(p.created_at).toLocaleDateString('ru-RU')}</td>
                </tr>
                `).join('')}
            </table>
        </div>
        ` : ''}
    </div>
</body>
</html>
        `);
    } catch (error) {
        logger.error({ err: error }, 'User profile error');
        res.redirect('/admin/users');
    }
});

// ============================================================
// УПРАВЛЕНИЕ ПЛАТЕЖАМИ
// ============================================================

router.get('/payments', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const result = await paymentService.getAllPayments(page, 50);

        res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Оплаты - Админ-панель</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f0f2f5; }
        .header { background: #1a1a2e; color: white; padding: 16px 30px; display: flex; justify-content: space-between; align-items: center; }
        .header h1 { font-size: 20px; }
        .header a { color: white; text-decoration: none; padding: 6px 14px; background: #2d2d44; border-radius: 6px; }
        .container { max-width: 1400px; margin: 0 auto; padding: 24px 30px; }
        .nav-links { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 24px; }
        .nav-links a { padding: 8px 18px; border-radius: 8px; text-decoration: none; color: #495057; background: white; font-size: 14px; font-weight: 500; box-shadow: 0 2px 8px rgba(0,0,0,0.06); transition: all 0.2s; }
        .nav-links a:hover { background: #4361ee; color: white; }
        .nav-links a.active { background: #4361ee; color: white; }
        .section { background: white; border-radius: 12px; padding: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
        .section h2 { font-size: 18px; color: #1a1a2e; margin-bottom: 16px; }
        table { width: 100%; border-collapse: collapse; }
        table th { text-align: left; padding: 10px 12px; border-bottom: 2px solid #e9ecef; font-weight: 600; color: #495057; font-size: 13px; }
        table td { padding: 10px 12px; border-bottom: 1px solid #f1f3f5; font-size: 14px; }
        table tr:hover td { background: #f8f9fa; }
        .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 500; }
        .badge-success { background: #d4edda; color: #155724; }
        .badge-danger { background: #f8d7da; color: #721c24; }
        .badge-warning { background: #fff3cd; color: #856404; }
        .empty { color: #6c757d; text-align: center; padding: 30px; }
        .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 16px; margin-bottom: 20px; }
        .stat-item { text-align: center; padding: 12px; background: #f8f9fa; border-radius: 8px; }
        .stat-item .num { font-size: 24px; font-weight: 700; color: #1a1a2e; }
        .stat-item .label { color: #6c757d; font-size: 13px; }
        .pagination { display: flex; gap: 8px; margin-top: 16px; justify-content: center; }
        .pagination a { padding: 6px 14px; border: 1px solid #dee2e6; border-radius: 6px; text-decoration: none; color: #495057; }
        .pagination a.active { background: #4361ee; color: white; border-color: #4361ee; }
        @media (max-width: 768px) {
            .header { padding: 12px 16px; }
            .container { padding: 16px; }
        }
    </style>
</head>
<body>
    <header class="header">
        <h1>📚 Обучающий бот</h1>
        <a href="/admin/logout">Выйти</a>
    </header>

    <div class="container">
        <div class="nav-links">
            <a href="/admin">📊 Главная</a>
            <a href="/admin/courses">📚 Курсы</a>
            <a href="/admin/lessons">📖 Уроки</a>
            <a href="/admin/users">👤 Пользователи</a>
            <a href="/admin/payments" class="active">💳 Оплаты</a>
            <a href="/admin/settings">⚙️ Настройки</a>
            <a href="/admin/admins">👥 Администраторы</a>
            <a href="/admin/logs">📋 Логи</a>
            <a href="/admin/webhook">🔗 Webhook</a>
        </div>

        <div class="section">
            <h2>💳 Все платежи</h2>
            <div class="stats">
                <div class="stat-item">
                    <div class="num">${result.total}</div>
                    <div class="label">Всего</div>
                </div>
                <div class="stat-item">
                    <div class="num">${result.payments.filter(p => p.status === 'success').length}</div>
                    <div class="label">Успешных</div>
                </div>
                <div class="stat-item">
                    <div class="num">${result.payments.reduce((sum, p) => sum + (p.status === 'success' ? (p.amount || 0) : 0), 0)} ₽</div>
                    <div class="label">Выручка</div>
                </div>
            </div>

            ${result.payments.length === 0 ? '<div class="empty">Нет платежей</div>' : `
            <table>
                <tr>
                    <th>Пользователь</th>
                    <th>Сумма</th>
                    <th>Статус</th>
                    <th>Дата</th>
                </tr>
                ${result.payments.map(p => `
                <tr>
                    <td>${p.first_name} ${p.last_name || 'Неизвестно'}</td>
                    <td>${p.amount || 0} ₽</td>
                    <td><span class="badge ${p.status === 'success' ? 'badge-success' : p.status === 'failed' ? 'badge-danger' : 'badge-warning'}">${p.status === 'success' ? '✅ Успешно' : p.status === 'failed' ? '❌ Ошибка' : '⏳ В обработке'}</span></td>
                    <td>${new Date(p.created_at).toLocaleDateString('ru-RU')} ${new Date(p.created_at).toLocaleTimeString('ru-RU', {hour:'2-digit',minute:'2-digit'})}</td>
                </tr>
                `).join('')}
            </table>
            ${result.total > result.limit ? `
            <div class="pagination">
                ${Array.from({length: Math.ceil(result.total / result.limit)}, (_, i) => i + 1).map(p => `
                    <a href="/admin/payments?page=${p}" class="${p === result.page ? 'active' : ''}">${p}</a>
                `).join('')}
            </div>
            ` : ''}
            `}
        </div>
    </div>
</body>
</html>
        `);
    } catch (error) {
        logger.error({ err: error }, 'Payments error');
        res.send('<h1>Ошибка</h1><p>' + error.message + '</p>');
    }
});

// ============================================================
// НАСТРОЙКИ
// ============================================================

router.get('/settings', async (req, res) => {
    try {
        const settings = database.readTable('bot_settings');

        res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Настройки - Админ-панель</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f0f2f5; }
        .header { background: #1a1a2e; color: white; padding: 16px 30px; display: flex; justify-content: space-between; align-items: center; }
        .header h1 { font-size: 20px; }
        .header a { color: white; text-decoration: none; padding: 6px 14px; background: #2d2d44; border-radius: 6px; }
        .container { max-width: 800px; margin: 30px auto; padding: 0 20px; }
        .nav-links { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 24px; }
        .nav-links a { padding: 8px 18px; border-radius: 8px; text-decoration: none; color: #495057; background: white; font-size: 14px; font-weight: 500; box-shadow: 0 2px 8px rgba(0,0,0,0.06); transition: all 0.2s; }
        .nav-links a:hover { background: #4361ee; color: white; }
        .nav-links a.active { background: #4361ee; color: white; }
        .section { background: white; border-radius: 12px; padding: 30px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
        .section h2 { margin-bottom: 20px; }
        .form-group { margin-bottom: 16px; }
        .form-group label { display: block; font-weight: 500; margin-bottom: 4px; color: #333; font-size: 14px; }
        .form-group input, .form-group textarea { width: 100%; padding: 10px 14px; border: 2px solid #e9ecef; border-radius: 8px; font-size: 14px; }
        .form-group input:focus, .form-group textarea:focus { outline: none; border-color: #4361ee; }
        .btn { padding: 10px 24px; border: none; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; }
        .btn-success { background: #28a745; color: white; }
        .btn-success:hover { background: #218838; }
        .actions { display: flex; gap: 12px; margin-top: 20px; }
        @media (max-width: 768px) {
            .header { padding: 12px 16px; }
            .container { padding: 0 12px; }
            .section { padding: 20px; }
        }
    </style>
</head>
<body>
    <header class="header">
        <h1>📚 Обучающий бот</h1>
        <a href="/admin/logout">Выйти</a>
    </header>

    <div class="container">
        <div class="nav-links">
            <a href="/admin">📊 Главная</a>
            <a href="/admin/courses">📚 Курсы</a>
            <a href="/admin/lessons">📖 Уроки</a>
            <a href="/admin/users">👤 Пользователи</a>
            <a href="/admin/payments">💳 Оплаты</a>
            <a href="/admin/settings" class="active">⚙️ Настройки</a>
            <a href="/admin/admins">👥 Администраторы</a>
            <a href="/admin/logs">📋 Логи</a>
            <a href="/admin/webhook">🔗 Webhook</a>
        </div>

        <div class="section">
            <h2>⚙️ Настройки бота</h2>
            <form method="POST" action="/admin/settings/update">
                <div class="form-group">
                    <label>Название бота</label>
                    <input type="text" name="bot_name" value="${settings.find(s => s.key === 'bot_name')?.value || 'Обучающий бот'}">
                </div>
                <div class="form-group">
                    <label>Контакты поддержки</label>
                    <input type="text" name="support_contact" value="${settings.find(s => s.key === 'support_contact')?.value || '@support'}">
                </div>
                <div class="form-group">
                    <label>Welcome сообщение</label>
                    <textarea name="welcome_message" rows="4">${settings.find(s => s.key === 'welcome_message')?.value || '👋 Добро пожаловать в обучающий бот!'}</textarea>
                </div>
                <div class="actions">
                    <button type="submit" class="btn btn-success">💾 Сохранить</button>
                </div>
            </form>
        </div>

        <div class="section">
            <h2>🔗 Платформы</h2>
            <form method="POST" action="/admin/settings/update-platforms">
                <div class="form-group">
                    <label>MAX Bot Token</label>
                    <input type="text" name="max_token" value="${process.env.MAX_BOT_TOKEN || ''}" placeholder="Введите токен MAX">
                </div>
                <div class="form-group">
                    <label>VK Group Token</label>
                    <input type="text" name="vk_token" value="${process.env.VK_GROUP_TOKEN || ''}" placeholder="Введите токен VK">
                </div>
                <div class="form-group">
                    <label>Public URL</label>
                    <input type="text" name="public_url" value="${process.env.PUBLIC_URL || ''}" placeholder="https://example.com">
                </div>
                <div class="actions">
                    <button type="submit" class="btn btn-success">💾 Сохранить</button>
                </div>
            </form>
        </div>
    </div>
</body>
</html>
        `);
    } catch (error) {
        logger.error({ err: error }, 'Settings error');
        res.send('<h1>Ошибка</h1><p>' + error.message + '</p>');
    }
});

router.post('/settings/update', async (req, res) => {
    try {
        const { bot_name, support_contact, welcome_message } = req.body;

        let settings = database.readTable('bot_settings');

        const updateSetting = (key, value) => {
            const existing = settings.find(s => s.key === key);
            if (existing) {
                existing.value = value;
            } else {
                settings.push({ key, value });
            }
        };

        updateSetting('bot_name', bot_name);
        updateSetting('support_contact', support_contact);
        updateSetting('welcome_message', welcome_message);

        database.writeTable('bot_settings', settings);
        res.redirect('/admin/settings');
    } catch (error) {
        logger.error({ err: error }, 'Update settings error');
        res.redirect('/admin/settings?error=' + encodeURIComponent(error.message));
    }
});

// ============================================================
// УПРАВЛЕНИЕ АДМИНИСТРАТОРАМИ
// ============================================================

router.get('/admins', async (req, res) => {
    try {
        const admins = await AdminController.getAllAdmins();

        res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Администраторы - Админ-панель</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f0f2f5; }
        .header { background: #1a1a2e; color: white; padding: 16px 30px; display: flex; justify-content: space-between; align-items: center; }
        .header h1 { font-size: 20px; }
        .header a { color: white; text-decoration: none; padding: 6px 14px; background: #2d2d44; border-radius: 6px; }
        .container { max-width: 1000px; margin: 30px auto; padding: 0 20px; }
        .nav-links { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 24px; }
        .nav-links a { padding: 8px 18px; border-radius: 8px; text-decoration: none; color: #495057; background: white; font-size: 14px; font-weight: 500; box-shadow: 0 2px 8px rgba(0,0,0,0.06); transition: all 0.2s; }
        .nav-links a:hover { background: #4361ee; color: white; }
        .nav-links a.active { background: #4361ee; color: white; }
        .section { background: white; border-radius: 12px; padding: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
        .section h2 { font-size: 18px; color: #1a1a2e; margin-bottom: 16px; }
        .toolbar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 12px; }
        .btn { padding: 8px 20px; border: none; border-radius: 8px; font-size: 14px; font-weight: 500; cursor: pointer; transition: all 0.2s; }
        .btn-primary { background: #4361ee; color: white; }
        .btn-primary:hover { background: #3651d4; }
        .btn-danger { background: #dc3545; color: white; }
        .btn-danger:hover { background: #c82333; }
        .btn-sm { padding: 4px 12px; font-size: 12px; }
        table { width: 100%; border-collapse: collapse; }
        table th { text-align: left; padding: 10px 12px; border-bottom: 2px solid #e9ecef; font-weight: 600; color: #495057; font-size: 13px; }
        table td { padding: 10px 12px; border-bottom: 1px solid #f1f3f5; font-size: 14px; }
        table tr:hover td { background: #f8f9fa; }
        .badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 500; }
        .badge-info { background: #d1ecf1; color: #0c5460; }
        .badge-warning { background: #fff3cd; color: #856404; }
        .empty { color: #6c757d; text-align: center; padding: 30px; }
        .form-group { margin-bottom: 16px; }
        .form-group label { display: block; font-weight: 500; margin-bottom: 4px; }
        .form-group input, .form-group select { width: 100%; padding: 10px 14px; border: 2px solid #e9ecef; border-radius: 8px; font-size: 14px; }
        .form-group input:focus, .form-group select:focus { outline: none; border-color: #4361ee; }
        .modal-overlay { display: none; position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 1000; align-items: center; justify-content: center; }
        .modal-overlay.active { display: flex; }
        .modal { background: white; border-radius: 16px; padding: 32px; width: 100%; max-width: 500px; }
        .modal h2 { font-size: 20px; margin-bottom: 20px; }
        .modal .actions { display: flex; gap: 12px; margin-top: 20px; }
        @media (max-width: 768px) {
            .header { padding: 12px 16px; }
            .container { padding: 0 12px; }
            .modal { padding: 20px; margin: 16px; }
        }
    </style>
</head>
<body>
    <header class="header">
        <h1>📚 Обучающий бот</h1>
        <a href="/admin/logout">Выйти</a>
    </header>

    <div class="container">
        <div class="nav-links">
            <a href="/admin">📊 Главная</a>
            <a href="/admin/courses">📚 Курсы</a>
            <a href="/admin/lessons">📖 Уроки</a>
            <a href="/admin/users">👤 Пользователи</a>
            <a href="/admin/payments">💳 Оплаты</a>
            <a href="/admin/settings">⚙️ Настройки</a>
            <a href="/admin/admins" class="active">👥 Администраторы</a>
            <a href="/admin/logs">📋 Логи</a>
            <a href="/admin/webhook">🔗 Webhook</a>
        </div>

        <div class="section">
            <div class="toolbar">
                <h2>👥 Администраторы</h2>
                <button class="btn btn-primary" onclick="openModal('createAdminModal')">+ Создать администратора</button>
            </div>

            ${admins.length === 0 ? '<div class="empty">Нет администраторов</div>' : `
            <table>
                <tr>
                    <th>Логин</th>
                    <th>Роль</th>
                    <th>Дата создания</th>
                    <th>Действия</th>
                </tr>
                ${admins.map(a => `
                <tr>
                    <td><strong>${a.login}</strong></td>
                    <td><span class="badge ${a.role === 'superadmin' ? 'badge-warning' : 'badge-info'}">${a.role || 'admin'}</span></td>
                    <td>${new Date(a.created_at).toLocaleDateString('ru-RU')}</td>
                    <td>
                        ${a.id !== req.session.adminId ? `
                            <button class="btn btn-danger btn-sm" onclick="deleteAdmin('${a.id}')">🗑️</button>
                        ` : '<span style="color:#6c757d;font-size:13px;">Вы</span>'}
                    </td>
                </tr>
                `).join('')}
            </table>
            `}
        </div>
    </div>

    <div class="modal-overlay" id="createAdminModal">
        <div class="modal">
            <h2>👥 Создать администратора</h2>
            <form method="POST" action="/admin/admins/create">
                <div class="form-group">
                    <label>Логин *</label>
                    <input type="text" name="login" required>
                </div>
                <div class="form-group">
                    <label>Пароль *</label>
                    <input type="password" name="password" required minlength="6">
                </div>
                <div class="form-group">
                    <label>Роль</label>
                    <select name="role">
                        <option value="admin">Администратор</option>
                        <option value="superadmin">Супер-администратор</option>
                    </select>
                </div>
                <div class="actions">
                    <button type="submit" class="btn btn-primary">✅ Создать</button>
                    <button type="button" class="btn" onclick="closeModal('createAdminModal')">Отмена</button>
                </div>
            </form>
        </div>
    </div>

    <script>
        function openModal(id) { document.getElementById(id).classList.add('active'); }
        function closeModal(id) { document.getElementById(id).classList.remove('active'); }
        function deleteAdmin(id) {
            if (confirm('Удалить администратора?')) {
                window.location.href = '/admin/admins/delete/' + id;
            }
        }
        document.querySelectorAll('.modal-overlay').forEach(el => {
            el.addEventListener('click', function(e) { if (e.target === this) this.classList.remove('active'); });
        });
    </script>
</body>
</html>
        `);
    } catch (error) {
        logger.error({ err: error }, 'Admins error');
        res.send('<h1>Ошибка</h1><p>' + error.message + '</p>');
    }
});

router.post('/admins/create', async (req, res) => {
    try {
        const { login, password, role } = req.body;
        await AdminController.createAdmin(login, password, role || 'admin');
        res.redirect('/admin/admins');
    } catch (error) {
        logger.error({ err: error }, 'Create admin error');
        res.redirect('/admin/admins?error=' + encodeURIComponent(error.message));
    }
});

router.get('/admins/delete/:id', async (req, res) => {
    try {
        await AdminController.deleteAdmin(req.params.id);
        res.redirect('/admin/admins');
    } catch (error) {
        logger.error({ err: error }, 'Delete admin error');
        res.redirect('/admin/admins?error=' + encodeURIComponent(error.message));
    }
});

// ============================================================
// ЛОГИ
// ============================================================

router.get('/logs', async (req, res) => {
    try {
        const logDir = LOG_DIR;
        let logs = [];

        if (fs.existsSync(logDir)) {
            const files = fs.readdirSync(logDir);
            for (const file of files) {
                if (file.endsWith('.log')) {
                    const content = fs.readFileSync(path.join(logDir, file), 'utf-8');
                    const lines = content.split('\n').filter(l => l.trim());
                    logs.push({
                        name: file,
                        content: lines.slice(-100).join('\n'),
                        size: lines.length,
                    });
                }
            }
        }

        res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Логи - Админ-панель</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f0f2f5; }
        .header { background: #1a1a2e; color: white; padding: 16px 30px; display: flex; justify-content: space-between; align-items: center; }
        .header h1 { font-size: 20px; }
        .header a { color: white; text-decoration: none; padding: 6px 14px; background: #2d2d44; border-radius: 6px; }
        .container { max-width: 1400px; margin: 0 auto; padding: 24px 30px; }
        .nav-links { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 24px; }
        .nav-links a { padding: 8px 18px; border-radius: 8px; text-decoration: none; color: #495057; background: white; font-size: 14px; font-weight: 500; box-shadow: 0 2px 8px rgba(0,0,0,0.06); transition: all 0.2s; }
        .nav-links a:hover { background: #4361ee; color: white; }
        .nav-links a.active { background: #4361ee; color: white; }
        .section { background: white; border-radius: 12px; padding: 24px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }
        .section h2 { font-size: 18px; color: #1a1a2e; margin-bottom: 16px; }
        .log-viewer { background: #1a1a2e; color: #e9ecef; padding: 16px; border-radius: 8px; font-family: 'Courier New', monospace; font-size: 12px; overflow-x: auto; white-space: pre-wrap; word-break: break-all; max-height: 600px; overflow-y: auto; }
        .log-viewer .error { color: #ff6b6b; }
        .log-viewer .warn { color: #ffd93d; }
        .log-viewer .info { color: #6bcbff; }
        .log-viewer .success { color: #6bcb6b; }
        .empty { color: #6c757d; text-align: center; padding: 30px; }
        .file-selector { display: flex; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
        .file-selector button { padding: 6px 16px; border: 2px solid #e9ecef; border-radius: 6px; background: white; cursor: pointer; font-size: 13px; }
        .file-selector button.active { border-color: #4361ee; background: #4361ee; color: white; }
        .file-selector button:hover { border-color: #4361ee; }
        @media (max-width: 768px) {
            .header { padding: 12px 16px; }
            .container { padding: 16px; }
        }
    </style>
</head>
<body>
    <header class="header">
        <h1>📚 Обучающий бот</h1>
        <a href="/admin/logout">Выйти</a>
    </header>

    <div class="container">
        <div class="nav-links">
            <a href="/admin">📊 Главная</a>
            <a href="/admin/courses">📚 Курсы</a>
            <a href="/admin/lessons">📖 Уроки</a>
            <a href="/admin/users">👤 Пользователи</a>
            <a href="/admin/payments">💳 Оплаты</a>
            <a href="/admin/settings">⚙️ Настройки</a>
            <a href="/admin/admins">👥 Администраторы</a>
            <a href="/admin/logs" class="active">📋 Логи</a>
            <a href="/admin/webhook">🔗 Webhook</a>
        </div>

        <div class="section">
            <h2>📋 Логи</h2>
            ${logs.length === 0 ? '<div class="empty">Логи не найдены</div>' : `
            <div class="file-selector">
                ${logs.map((log, i) => `
                    <button onclick="showLog('${log.name}', ${i})" id="btn-${i}" class="${i === 0 ? 'active' : ''}">${log.name} (${log.size})</button>
                `).join('')}
            </div>
            ${logs.map((log, i) => `
                <div id="log-${i}" style="${i === 0 ? '' : 'display:none;'}">
                    <div class="log-viewer">
                        ${log.content || '(пусто)'}
                    </div>
                </div>
            `).join('')}
            `}
        </div>
    </div>

    <script>
        function showLog(name, index) {
            document.querySelectorAll('[id^="log-"]').forEach(el => el.style.display = 'none');
            document.getElementById('log-' + index).style.display = 'block';
            document.querySelectorAll('.file-selector button').forEach(el => el.classList.remove('active'));
            document.getElementById('btn-' + index).classList.add('active');
        }
    </script>
</body>
</html>
        `);
    } catch (error) {
        logger.error({ err: error }, 'Logs error');
        res.send('<h1>Ошибка</h1><p>' + error.message + '</p>');
    }
});

// ============================================================
// WEBHOOK УПРАВЛЕНИЕ
// ============================================================

router.get('/webhook', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/admin-webhook.html'));
});

// ============================================================
// ЭКСПОРТ
// ============================================================

module.exports = router;
