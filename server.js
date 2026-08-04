const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const path = require('path');
const config = require('./config');
const database = require('./database');
const logger = require('./logger');
const storageService = require('./services/storage');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const adminRouter = require('./admin/admin');

async function startServer() {
  const app = express();

  // Безопасность
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net"],
        imgSrc: ["'self'", "data:", "blob:"],
        mediaSrc: ["'self'"],
      },
    },
  }));
  
  app.use(cors());
  
  // Статические файлы
  app.use('/uploads', express.static(config.storage.localPath, {
    setHeaders: (res, filePath) => {
      if (filePath.match(/\.(php|phtml|php3|php4|php5|php7|phps|cgi|pl|py|jsp|asp|aspx|shtml|shtm|exe|dll|bat|cmd|sh)$/i)) {
        res.setHeader('Content-Type', 'text/plain');
      }
    },
  }));

  // Парсинг тела запроса
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Rate limiting
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    message: {
      error: {
        code: 'RATE_LIMIT',
        message: 'Слишком много запросов. Попробуйте позже.',
      },
    },
  });
  app.use('/api/', limiter);

  // Сессии для админки
  app.use(session({
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: config.server.nodeEnv === 'production',
      httpOnly: true,
      maxAge: config.session.maxAge,
    },
  }));

  // Health check
  app.get('/health', (req, res) => {
    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  // Webhook'и ботов
  app.post('/webhook/vk', require('./platforms/vk').webhookHandler);
  app.post('/webhook/max', require('./platforms/max').webhookHandler);

  // Админ-панель
  app.use('/admin', adminRouter);
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, 'admin', 'views'));

  // Обработка ошибок
  app.use(notFoundHandler);
  app.use(errorHandler);

  // Запуск сервера
  const server = app.listen(config.server.port, () => {
    logger.info(`Server started on port ${config.server.port}`);
    logger.info(`Environment: ${config.server.nodeEnv}`);
    logger.info(`Admin panel: http://localhost:${config.server.port}/admin`);
    logger.info(`Storage type: ${config.storage.type}`);
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);
    
    server.close(async () => {
      logger.info('HTTP server closed');
      
      try {
        await database.closePool();
        logger.info('Database connections closed');
      } catch (err) {
        logger.error('Error closing database:', err);
      }
      
      logger.info('Shutdown complete');
      process.exit(0);
    });

    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection:', reason);
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    shutdown('UNCAUGHT_EXCEPTION');
  });
}

startServer().catch((error) => {
  logger.error('Failed to start server:', error);
  process.exit(1);
});
