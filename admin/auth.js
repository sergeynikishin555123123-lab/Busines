// admin/auth.js
const express = require('express');
const router = express.Router();
const AdminController = require('./controller');
const logger = require('../logger');
const rateLimit = require('express-rate-limit');

// Лимит для предотвращения брутфорса
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 минут
  max: 5, // 5 попыток
  message: 'Too many login attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/login', (req, res) => {
  if (req.session.adminId) {
    return res.redirect('/admin/dashboard');
  }
  res.render('login', { error: null, csrfToken: req.csrfToken?.() || '' });
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { login, password } = req.body;
    
    if (!login || !password) {
      return res.status(400).render('login', { error: 'Login and password are required' });
    }

    const admin = await AdminController.authenticate(login, password);
    
    if (!admin) {
      logger.warn({ login }, 'Failed login attempt');
      return res.status(401).render('login', { error: 'Invalid login or password' });
    }

    // Обновляем сессию
    req.session.adminId = admin.id;
    req.session.adminLogin = admin.login;
    req.session.adminRole = admin.role;
    // Обновление времени сессии для безопасности
    req.session.cookie.maxAge = 24 * 60 * 60 * 1000; // 24 часа

    logger.info({ login, role: admin.role }, 'Admin logged in successfully');
    res.redirect('/admin/dashboard');
  } catch (error) {
    logger.error({ err: error }, 'Login error');
    res.status(500).render('login', { error: 'Internal server error' });
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      logger.error({ err }, 'Logout error');
    }
    res.redirect('/admin/login');
  });
});

module.exports = router;
