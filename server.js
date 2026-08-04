require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const config = require('./config');
const database = require('./database');
const logger = require('./logger');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const { initializeMaxBot } = require('./platforms/max');
const { errorHandler: domainErrorHandler } = require('./middleware/errorHandler');

// Инициализация базы данных
database.initDatabase();

const app = express();

// Настройка шаблонизатора
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'admin', 'views'));

// Middleware безопасности
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      ...helmet.contentSecurityPolicy.getDefaultDirectives(),
      "script-src": ["'self'", "'unsafe-inline'"],
    },
  },
}));
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Сессии
app.use(session({
  secret: config.session.secret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: config.session.maxAge,
    secure: config.server.nodeEnv === 'production',
    httpOnly: true,
    sameSite: 'lax',
  },
}));

// Статические файлы
app.use('/static', express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(config.storage.localPath || './uploads'));

// Routes
const adminRouter = require('./admin/admin');
app.use('/admin', adminRouter);

// VK Webhook (оставлен без изменений для совместимости)
app.post('/webhook/vk', async (req, res) => {
  try {
    const { type, object } = req.body;
    
    if (type === 'confirmation') {
      return res.send(config.vk.confirmationToken);
    }
    
    if (type === 'message_new') {
      const message = object.message;
      const dispatcher = require('./core/dispatcher');
      
      // Асинхронная обработка
      setImmediate(() => {
        dispatcher.handleMessage({
          platform: 'vk',
          userId: message.from_id,
          message: message.text,
          payload: message.payload ? JSON.parse(message.payload) : {},
          firstName: '',
          lastName: '',
          username: '',
        }).catch(err => logger.error({ err, platform: 'vk' }, 'Error handling VK message'));
      });
    }
    
    res.send('ok');
  } catch (error) {
    logger.error({ err: error }, 'VK webhook error');
    res.send('ok');
  }
});

// MAX Webhook
app.post('/webhook/max', async (req, res) => {
  const webhookSecret = config.max.webhookSecret;
  
  // 1. Проверка секрета
  if (webhookSecret) {
    const receivedSecret = req.headers['x-max-bot-api-secret'];
    if (!receivedSecret || receivedSecret !== webhookSecret) {
      logger.warn({ headers: req.headers }, 'Invalid or missing X-Max-Bot-Api-Secret');
      return res.status(401).send('Unauthorized');
    }
  }

  // 2. Немедленный ответ 200 OK
  res.status(200).send('ok');

  // 3. Асинхронная обработка события
  setImmediate(async () => {
    try {
      const { event } = req.body; // Событие внутри поля "event"
      if (!event) {
        logger.warn({ body: req.body }, 'MAX webhook: event is missing');
        return;
      }

      const { type, payload } = event;
      const dispatcher = require('./core/dispatcher');

      logger.info({ eventType: type, payload }, 'Received MAX event');

      switch (type) {
        case 'message_created': {
          const message = payload.message;
          if (message && message.text) {
            await dispatcher.handleMessage({
              platform: 'max',
              userId: message.from.id,
              message: message.text,
              payload: message.attachments?.inline_keyboard ? { callback: true } : {},
              firstName: message.from.first_name || '',
              lastName: message.from.last_name || '',
              username: message.from.username || '',
            });
          }
          break;
        }

        case 'message_callback': {
          const callback = payload.callback;
          const { button, user, message } = callback;
          if (button && button.payload) {
            // payload может быть строкой JSON или объектом
            let parsedPayload;
            try {
              parsedPayload = typeof button.payload === 'string' 
                ? JSON.parse(button.payload) 
                : button.payload;
            } catch (e) {
              parsedPayload = { data: button.payload };
            }

            await dispatcher.handleMessage({
              platform: 'max',
              userId: user.id,
              message: '', // Callback не содержит текста
              payload: parsedPayload,
              firstName: user.first_name || '',
              lastName: user.last_name || '',
              username: user.username || '',
            });
          }
          break;
        }

        case 'bot_started': {
          logger.info({ payload }, 'Bot started event');
          // Инициализация для пользователя, если нужно
          const userService = require('./core/user');
          await userService.registerUser({
            platform: 'max',
            platformId: payload.user.id,
            firstName: payload.user.first_name,
            lastName: payload.user.last_name,
            username: payload.user.username,
          });
          break;
        }

        case 'bot_removed':
        case 'bot_stopped': {
          logger.info({ eventType: type, payload }, 'Bot removal event');
          // Обработка удаления бота
          break;
        }

        default: {
          logger.warn({ eventType: type, payload }, 'Unhandled MAX event type');
        }
      }
    } catch (error) {
      logger.error({ err: error, body: req.body }, 'Error processing MAX webhook event');
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handlers
app.use(notFoundHandler);
app.use(domainErrorHandler);

// Инициализация бота при старте
async function initializeBot() {
  try {
    await initializeMaxBot();
    logger.info('MAX bot initialized successfully');
  } catch (error) {
    logger.error({ err: error }, 'Failed to initialize MAX bot');
    // Продолжаем запуск, но логируем ошибку
  }
}

// Start server
const PORT = config.server.port;
app.listen(PORT, async () => {
  logger.info(`Server running on port ${PORT}`);
  logger.info(`Environment: ${config.server.nodeEnv}`);
  
  await initializeBot();
});

module.exports = app;
