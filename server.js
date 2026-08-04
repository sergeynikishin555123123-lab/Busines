require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const config = require('./config');
const database = require('./database');
const logger = require('./logger');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

// Инициализация базы данных
database.initDatabase();

const app = express();

// Настройка шаблонизатора
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'admin', 'views'));

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Сессии
app.use(session({
  secret: config.session.secret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: config.session.maxAge,
    secure: config.server.nodeEnv === 'production',
    httpOnly: true,
  },
}));

// Статические файлы
app.use('/static', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(config.storage.localPath || './uploads'));

// Routes
const adminRouter = require('./admin/admin');
app.use('/admin', adminRouter);

// VK Webhook
app.post('/webhook/vk', async (req, res) => {
  try {
    const { type, object } = req.body;
    
    if (type === 'confirmation') {
      return res.send(config.vk.confirmationToken);
    }
    
    if (type === 'message_new') {
      const message = object.message;
      const dispatcher = require('./core/dispatcher');
      
      await dispatcher.handleMessage({
        platform: 'vk',
        userId: message.from_id,
        message: message.text,
        payload: message.payload ? JSON.parse(message.payload) : {},
        firstName: '',
        lastName: '',
        username: '',
      });
    }
    
    res.send('ok');
  } catch (error) {
    logger.error('VK webhook error:', error);
    res.send('ok');
  }
});

// MAX Webhook
app.post('/webhook/max', async (req, res) => {
  try {
    const { message, callback_query } = req.body;
    
    const dispatcher = require('./core/dispatcher');
    
    if (callback_query) {
      const data = JSON.parse(callback_query.data);
      await dispatcher.handleMessage({
        platform: 'max',
        userId: callback_query.from.id,
        message: '',
        payload: data,
        firstName: callback_query.from.first_name || '',
        lastName: callback_query.from.last_name || '',
        username: callback_query.from.username || '',
      });
      return res.send('ok');
    }
    
    if (message && message.text) {
      await dispatcher.handleMessage({
        platform: 'max',
        userId: message.from.id,
        message: message.text,
        payload: {},
        firstName: message.from.first_name || '',
        lastName: message.from.last_name || '',
        username: message.from.username || '',
      });
    }
    
    res.send('ok');
  } catch (error) {
    logger.error('MAX webhook error:', error);
    res.send('ok');
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handlers
app.use(notFoundHandler);
app.use(errorHandler);

// Start server
const PORT = config.server.port;
app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Environment: ${config.server.nodeEnv}`);
});

module.exports = app;
