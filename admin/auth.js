const bcrypt = require('bcryptjs');
const database = require('../database');
const logger = require('../logger');

function checkAuth(req, res, next) {
  if (req.session && req.session.admin) {
    return next();
  }
  res.redirect('/admin/login');
}

async function login(req, res) {
  try {
    const { login, password } = req.body;
    
    if (!login || !password) {
      return res.status(400).json({ success: false, error: 'Введите логин и пароль' });
    }

    const admins = database.readTable('admins');
    const admin = admins.find(a => a.login === login);

    if (!admin) {
      return res.status(401).json({ success: false, error: 'Неверный логин или пароль' });
    }

    const isValid = await bcrypt.compare(password, admin.password_hash);
    if (!isValid) {
      return res.status(401).json({ success: false, error: 'Неверный логин или пароль' });
    }

    req.session.admin = {
      id: admin.id,
      login: admin.login,
      role: admin.role,
    };

    logger.info(`Admin logged in: ${login}`);
    res.json({ success: true });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ success: false, error: 'Ошибка сервера' });
  }
}

function logout(req, res) {
  req.session.destroy(() => {
    res.redirect('/admin/login');
  });
}

module.exports = {
  checkAuth,
  login,
  logout,
};
