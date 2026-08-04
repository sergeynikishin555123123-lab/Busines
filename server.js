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
console.log('[STARTUP] UID:', process.getuid?.() || 'unknown');

// Проверяем права на запись
try {
  const testFile = path.join('/tmp', `.write-test-${Date.now()}`);
  fs.writeFileSync(testFile, 'test');
  fs.unlinkSync(testFile);
  console.log('[STARTUP] ✅ Write permission OK in /tmp');
} catch (error) {
  console.error('[STARTUP] ❌ No write permission in /tmp:', error.message);
}

// Проверяем права в /app
let hasAppWrite = false;
try {
  const testFile = path.join('/app', `.write-test-${Date.now()}`);
  fs.writeFileSync(testFile, 'test');
  fs.unlinkSync(testFile);
  hasAppWrite = true;
  console.log('[STARTUP] ✅ Write permission OK in /app');
} catch (error) {
  console.warn('[STARTUP] ⚠️ No write permission in /app:', error.message);
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

// Загружаем логгер (с использованием /tmp)
let logger;
try {
  // Переопределяем путь для логов
  process.env.LOG_DIR = '/tmp/logs';
  logger = require('./logger');
  console.log('[STARTUP] Logger loaded successfully');
} catch (error) {
  console.error('[STARTUP] Failed to load logger:', error.message);
  logger = {
    info: console.log,
    error: console.error,
    warn: console.warn,
    debug: console.log,
  };
}

// Загружаем database (с использованием /tmp/data)
let database;
try {
  // Переопределяем путь для данных
  process.env.DATA_DIR = '/tmp/data';
  database = require('./database');
  console.log('[STARTUP] Database loaded successfully');
} catch (error) {
  console.error('[STARTUP] Failed to load database:', error.message);
  console.error('[STARTUP] Stack:', error.stack);
  process.exit(1);
}

// Инициализация базы данных
try {
  // Используем /tmp/data если нет прав на /app/data
  const dataDir = process.env.DATA_DIR || '/tmp/data';
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
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
  const uploadsDir = config.storage.localPath || '/tmp/uploads';
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
    console.log(`[STARTUP] Created uploads directory: ${uploadsDir}`);
  }
  
  app.use('/static', express.static(path.join(__dirname, 'public')));
  app.use('/uploads', express.static(uploadsDir));
  console.log('[STARTUP] Static files configured');
} catch (error) {
  console.error('[STARTUP] Failed to configure static files:', error.message);
  process.exit(1);
}

// Простой роут для теста
app.get('/', (req, res) => {
  res.json({
    name: 'Learning Bot Platform',
    version: '1.0.0',
    status: 'running',
    pid: process.pid,
    uid: process.getuid?.() || 'unknown',
    cwd: process.cwd(),
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    pid: process.pid,
    memory: process.memoryUsage(),
  });
});

// VK Webhook (заглушка)
app.post('/webhook/vk', (req, res) => {
  try {
    const { type } = req.body;
    if (type === 'confirmation') {
      return res.send(config.vk.confirmationToken || 'test');
    }
    res.send('ok');
  } catch (error) {
    logger.error('VK webhook error:', error.message);
    res.send('ok');
  }
});

// MAX Webhook (заглушка)
app.post('/webhook/max', (req, res) => {
  const webhookSecret = config.max.webhookSecret;
  if (webhookSecret) {
    const received = req.headers['x-max-bot-api-secret'];
    if (!received || received !== webhookSecret) {
      return res.status(401).send('Unauthorized');
    }
  }
  
  res.status(200).send('ok');
  
  setImmediate(() => {
    try {
      const { event } = req.body;
      if (event) {
        logger.info({ eventType: event.type }, 'MAX event received');
      }
    } catch (error) {
      logger.error('MAX webhook error:', error.message);
    }
  });
});

// Error handlers
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
const PORT = parseInt(process.env.PORT) || 8080;
const HOST = '0.0.0.0';

console.log(`[STARTUP] Starting server on ${HOST}:${PORT}...`);

const server = app.listen(PORT, HOST, () => {
  console.log(`[STARTUP] ✅ Server running on port ${PORT}`);
  console.log(`[STARTUP] Health: http://${HOST}:${PORT}/health`);
  console.log(`[STARTUP] Root: http://${HOST}:${PORT}/`);
});

server.on('error', (error) => {
  console.error('[STARTUP] Server error:', error.message);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[SHUTDOWN] SIGTERM received');
  server.close(() => {
    console.log('[SHUTDOWN] Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('[SHUTDOWN] SIGINT received');
  server.close(() => {
    console.log('[SHUTDOWN] Server closed');
    process.exit(0);
  });
});

console.log('[STARTUP] ✅ Ready');
