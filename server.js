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
console.log('[STARTUP] UID:', process.getuid?.() || 'unknown');

// Определяем директории с приоритетом: volume > /tmp > ./ 
const DATA_DIR = process.env.DATA_DIR || '/tmp/data';
const LOG_DIR = process.env.LOG_DIR || '/tmp/logs';
const UPLOADS_DIR = process.env.UPLOADS_DIR || '/tmp/uploads';

console.log('[STARTUP] DATA_DIR:', DATA_DIR);
console.log('[STARTUP] LOG_DIR:', LOG_DIR);
console.log('[STARTUP] UPLOADS_DIR:', UPLOADS_DIR);

// Создаём все директории
const dirs = [DATA_DIR, LOG_DIR, UPLOADS_DIR];
for (const dir of dirs) {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      console.log(`[STARTUP] Created: ${dir}`);
    }
  } catch (error) {
    console.error(`[STARTUP] Cannot create ${dir}:`, error.message);
    // Продолжаем, может быть readonly файловая система
  }
}

// Загружаем конфиг
let config;
try {
  config = require('./config');
  console.log('[STARTUP] Config loaded');
} catch (error) {
  console.error('[STARTUP] Config error:', error.message);
  process.exit(1);
}

// Переопределяем пути в конфиге
config.storage.localPath = UPLOADS_DIR;

// Загружаем логгер
let logger;
try {
  process.env.LOG_DIR = LOG_DIR;
  logger = require('./logger');
  console.log('[STARTUP] Logger loaded');
} catch (error) {
  console.error('[STARTUP] Logger error:', error.message);
  logger = { info: console.log, error: console.error, warn: console.warn, debug: console.log };
}

// Загружаем database
let database;
try {
  process.env.DATA_DIR = DATA_DIR;
  database = require('./database');
  console.log('[STARTUP] Database loaded');
} catch (error) {
  console.error('[STARTUP] Database error:', error.message);
  process.exit(1);
}

// Инициализация БД
try {
  database.initDatabase();
  console.log('[STARTUP] Database initialized');
} catch (error) {
  console.error('[STARTUP] DB init error:', error.message);
  process.exit(1);
}

const app = express();

// Настройка шаблонов
try {
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'admin', 'views'));
  console.log('[STARTUP] Views configured');
} catch (error) {
  console.error('[STARTUP] Views error:', error.message);
}

// Middleware
try {
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));
  console.log('[STARTUP] Middleware configured');
} catch (error) {
  console.error('[STARTUP] Middleware error:', error.message);
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
  console.error('[STARTUP] Sessions error:', error.message);
  process.exit(1);
}

// Статические файлы - используем только существующие директории
try {
  // Проверяем существование public
  const publicPath = path.join(__dirname, 'public');
  if (fs.existsSync(publicPath)) {
    app.use('/static', express.static(publicPath));
    console.log('[STARTUP] Static: /public');
  } else {
    console.warn('[STARTUP] public directory not found, skipping');
  }

  // Создаём и используем uploads
  if (!fs.existsSync(UPLOADS_DIR)) {
    fs.mkdirSync(UPLOADS_DIR, { recursive: true });
  }
  app.use('/uploads', express.static(UPLOADS_DIR));
  console.log(`[STARTUP] Static: /uploads -> ${UPLOADS_DIR}`);
} catch (error) {
  console.warn('[STARTUP] Static files warning:', error.message);
}

// ============ РОУТЫ ============

// Root
app.get('/', (req, res) => {
  res.json({
    name: 'Learning Bot Platform',
    version: '1.0.0',
    status: 'running',
    pid: process.pid,
    uid: process.getuid?.() || 'unknown',
    directories: { data: DATA_DIR, logs: LOG_DIR, uploads: UPLOADS_DIR },
  });
});

// Health
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    pid: process.pid,
    memory: process.memoryUsage(),
  });
});

// VK Webhook
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

// MAX Webhook
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
        logger.info({ eventType: event.type }, 'MAX event');
      }
    } catch (error) {
      logger.error('MAX webhook error:', error.message);
    }
  });
});

// Admin - минимальная заглушка
app.get('/admin', (req, res) => {
  res.json({ message: 'Admin API' });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// ============ ЗАПУСК ============

const PORT = parseInt(process.env.PORT) || 8080;
const HOST = '0.0.0.0';

console.log(`[STARTUP] Starting on ${HOST}:${PORT}...`);

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
  console.log('[SHUTDOWN] SIGTERM');
  server.close(() => { console.log('[SHUTDOWN] Closed'); process.exit(0); });
});

process.on('SIGINT', () => {
  console.log('[SHUTDOWN] SIGINT');
  server.close(() => { console.log('[SHUTDOWN] Closed'); process.exit(0); });
});

console.log('[STARTUP] ✅ Ready');
