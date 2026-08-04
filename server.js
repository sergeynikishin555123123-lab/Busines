require('dotenv').config();
const express = require('express');
const session = require('express-session');
const path = require('path');
const helmet = require('helmet');
const cors = require('cors');
const fs = require('fs');

console.log('[STARTUP] Starting application...');
console.log('[STARTUP] NODE_ENV:', process.env.NODE_ENV);
console.log('[STARTUP] PORT:', process.env.PORT);
console.log('[STARTUP] PWD:', process.cwd());
console.log('[STARTUP] USER:', process.env.USER || process.env.USERNAME || 'unknown');

// Проверяем права на запись в текущей директории
try {
  const testFile = path.join(__dirname, '.write-test');
  fs.writeFileSync(testFile, 'test');
  fs.unlinkSync(testFile);
  console.log('[STARTUP] ✅ Write permission OK');
} catch (error) {
  console.error('[STARTUP] ❌ No write permission:', error.message);
  console.error('[STARTUP] Continuing anyway...');
}

// Загружаем конфиг
let config;
try {
  config = require('./config');
  console.log('[STARTUP] Config loaded successfully');
} catch (error) {
  console.error('[STARTUP] Failed to load config:', error.message);
  process.exit(1);
}

// Загружаем логгер
let logger;
try {
  logger = require('./logger');
  console.log('[STARTUP] Logger loaded successfully');
} catch (error) {
  console.error('[STARTUP] Failed to load logger:', error.message);
  console.error('[STARTUP] Using console logger');
  logger = {
    info: console.log,
    error: console.error,
    warn: console.warn,
    debug: console.log,
  };
}

// Загружаем database
let database;
try {
  database = require('./database');
  console.log('[STARTUP] Database loaded successfully');
} catch (error) {
  console.error('[STARTUP] Failed to load database:', error.message);
  console.error('[STARTUP] Stack:', error.stack);
  process.exit(1);
}

// Инициализация базы данных
try {
  // Убеждаемся, что data директория существует с правильными правами
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o777 });
    console.log(`[STARTUP] Created data directory: ${dataDir}`);
  }
  
  database.initDatabase();
  console.log('[STARTUP] Database initialized successfully');
} catch (error) {
  console.error('[STARTUP] Failed to initialize database:', error.message);
  console.error('[STARTUP] Stack:', error.stack);
  process.exit(1);
}

const app = express();

// Настройка шаблонизатора
try {
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'admin', 'views'));
  console.log('[STARTUP] View engine configured');
} catch (error) {
  console.error('[STARTUP] Failed to configure views:', error.message);
  process.exit(1);
}

// Middleware
try {
  // Helmet с минимальной конфигурацией
  app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }));
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  console.log('[STARTUP] Middleware configured');
} catch (error) {
  console.error('[STARTUP] Failed to configure middleware:', error.message);
  process.exit(1);
}

// Сессии
try {
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
  console.log('[STARTUP] Sessions configured');
} catch (error) {
  console.error('[STARTUP] Failed to configure sessions:', error.message);
  process.exit(1);
}

// Статические файлы
try {
  // Создаём директорию uploads если её нет
  const uploadsDir = config.storage.localPath || './uploads';
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true, mode: 0o777 });
    console.log(`[STARTUP] Created uploads directory: ${uploadsDir}`);
  }
  
  app.use('/static', express.static(path.join(__dirname, 'public')));
  app.use('/uploads', express.static(path.join(__dirname, uploadsDir)));
  console.log('[STARTUP] Static files configured');
} catch (error) {
  console.error('[STARTUP] Failed to configure static files:', error.message);
  process.exit(1);
}

// Routes
try {
  const adminRouter = require('./admin/admin');
  app.use('/admin', adminRouter);
  console.log('[STARTUP] Admin routes loaded');
} catch (error) {
  console.warn('[STARTUP] Failed to load admin routes:', error.message);
  console.warn('[STARTUP] Using minimal admin routes');
  // Минимальный admin роут
  app.get('/admin', (req, res) => {
    res.json({ message: 'Admin API - minimal placeholder' });
  });
}

// VK Webhook
app.post('/webhook/vk', async (req, res) => {
  try {
    const { type, object } = req.body;
    
    if (type === 'confirmation') {
      return res.send(config.vk.confirmationToken);
    }
    
    if (type === 'message_new') {
      const message = object.message;
      res.send('ok');
      
      setImmediate(() => {
        try {
          const dispatcher = require('./core/dispatcher');
          dispatcher.handleMessage({
            platform: 'vk',
            userId: message.from_id,
            message: message.text,
            payload: message.payload ? JSON.parse(message.payload) : {},
            firstName: '',
            lastName: '',
            username: '',
          }).catch(err => logger.error({ err }, 'VK message error'));
        } catch (error) {
          logger.error('Failed to load dispatcher:', error.message);
        }
      });
    } else {
      res.send('ok');
    }
  } catch (error) {
    logger.error({ err: error }, 'VK webhook error');
    res.send('ok');
  }
});

// MAX Webhook
app.post('/webhook/max', async (req, res) => {
  const webhookSecret = config.max.webhookSecret;
  
  if (webhookSecret) {
    const receivedSecret = req.headers['x-max-bot-api-secret'];
    if (!receivedSecret || receivedSecret !== webhookSecret) {
      logger.warn({ headers: req.headers }, 'Invalid X-Max-Bot-Api-Secret');
      return res.status(401).send('Unauthorized');
    }
  }

  res.status(200).send('ok');

  setImmediate(async () => {
    try {
      const { event } = req.body;
      if (!event) {
        logger.warn({ body: req.body }, 'MAX webhook: event missing');
        return;
      }

      const { type, payload } = event;
      logger.info({ eventType: type }, 'Received MAX event');

      if (type === 'message_created' || type === 'message_callback' || type === 'bot_started') {
        try {
          const dispatcher = require('./core/dispatcher');
          if (type === 'message_created') {
            const message = payload.message;
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
          } else if (type === 'message_callback') {
            const callback = payload.callback;
            if (callback && callback.button && callback.button.payload) {
              let parsedPayload;
              try {
                parsedPayload = typeof callback.button.payload === 'string' 
                  ? JSON.parse(callback.button.payload) 
                  : callback.button.payload;
              } catch (e) {
                parsedPayload = { data: callback.button.payload };
              }
              await dispatcher.handleMessage({
                platform: 'max',
                userId: callback.user.id,
                message: '',
                payload: parsedPayload,
                firstName: callback.user.first_name || '',
                lastName: callback.user.last_name || '',
                username: callback.user.username || '',
              });
            }
          }
        } catch (error) {
          logger.error('Failed to load dispatcher:', error.message);
        }
      }
    } catch (error) {
      logger.error({ err: error }, 'MAX webhook error');
    }
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    pid: process.pid,
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'Learning Bot Platform',
    version: '1.0.0',
    status: 'running',
    endpoints: ['/health', '/webhook/vk', '/webhook/max', '/admin'],
  });
});

// Error handlers
try {
  const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
  app.use(notFoundHandler);
  app.use(errorHandler);
  console.log('[STARTUP] Error handlers configured');
} catch (error) {
  console.warn('[STARTUP] Failed to load error handlers, using defaults');
  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
  app.use((err, req, res, next) => {
    console.error('[ERROR]', err.message);
    res.status(500).json({ error: 'Internal server error' });
  });
}

// Start server
const PORT = parseInt(process.env.PORT) || config.server.port || 8080;
const HOST = '0.0.0.0';

console.log(`[STARTUP] Starting server on ${HOST}:${PORT}...`);

const server = app.listen(PORT, HOST, () => {
  console.log(`[STARTUP] ✅ Server running on port ${PORT}`);
  console.log(`[STARTUP] Health check: http://${HOST}:${PORT}/health`);
  console.log(`[STARTUP] Environment: ${config.server.nodeEnv}`);
});

server.on('error', (error) => {
  console.error('[STARTUP] Server error:', error.message);
  console.error('[STARTUP] Stack:', error.stack);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[SHUTDOWN] SIGTERM received, closing...');
  server.close(() => {
    console.log('[SHUTDOWN] Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[SHUTDOWN] SIGINT received, closing...');
  server.close(() => {
    console.log('[SHUTDOWN] Server closed');
    process.exit(0);
  });
});

// Uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('[FATAL] Uncaught exception:', error.message);
  console.error('[FATAL] Stack:', error.stack);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[FATAL] Unhandled rejection:', reason);
});

console.log('[STARTUP] ✅ Ready');

module.exports = app;
