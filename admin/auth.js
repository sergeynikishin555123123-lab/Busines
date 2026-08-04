const bcrypt = require('bcryptjs');
const database = require('../database');
const logger = require('../logger');

function checkAuth(req, res, next) {
  if (req.session && req.session.admin && req.session.admin.id) {
    return next();
  }
  
  if (req.path === '/login' || req.path === '/api/login') {
    return next();
  }
  
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  
  res.redirect('/admin/login');
}

async function login(req, res) {
  try {
    const { login, password } = req.body;

    if (!login || !password) {
      return res.status(400).json({ error: 'Логин и пароль обязательны' });
    }

    const admins = database.readTable('admins');
    const admin = admins.find(a => a.login === login);

    if (!admin) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    const validPassword = await bcrypt.compare(password, admin.password_hash);

    if (!validPassword) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    req.session.admin = {
      id: admin.id,
      login: admin.login,
      role: admin.role,
    };

    logger.info(`Admin logged in: ${admin.login}`);
    res.json({ success: true, redirect: '/admin' });
  } catch (error) {
    logger.error('Admin login error:', error);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
}

function logout(req, res) {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
}

module.exports = { checkAuth, login, logout };
