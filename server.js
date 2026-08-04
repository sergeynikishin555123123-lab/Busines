const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const database = require('./database');
const logger = require('./logger');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const adminRouter = require('./admin/admin');
const migrate = require('./migration');

async function startServer() {
  try {
    // Создаём папки
    ['/tmp/data', '/tmp/uploads', '/tmp/logs'].forEach(dir => {
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
    });

    database.initDatabase();
    await migrate();
    
    const app = express();

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
    
    app.use('/uploads', express.static('/tmp/uploads', {
      setHeaders: (res, filePath) => {
        if (filePath.match(/\.(php|phtml|php3|php4|php5|php7|phps|cgi|pl|py|jsp|asp|aspx|shtml|shtm|exe|dll|bat|cmd|sh)$/i)) {
          res.setHeader('Content-Type', 'text/plain');
        }
      },
    }));

    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));

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

app.use(session({
  secret: config.session.secret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: false,
    httpOnly: true,
    maxAge: config.session.maxAge,
  },
}));

    app.get('/health', (req, res) => {
      res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
      });
    });

    app.post('/webhook/vk', (req, res) => {
      require('./platforms/vk').webhookHandler(req, res);
    });

    app.post('/webhook/max', (req, res) => {
      require('./platforms/max').webhookHandler(req, res);
    });

    app.use('/admin', adminRouter);
    app.set('view engine', 'ejs');
    app.set('views', path.join(__dirname, 'admin', 'views'));

    app.use(notFoundHandler);
    app.use(errorHandler);

    const server = app.listen(config.server.port, () => {
      logger.info(`Server started on port ${config.server.port}`);
      logger.info(`Environment: ${config.server.nodeEnv}`);
      logger.info(`Admin panel: http://localhost:${config.server.port}/admin`);
      logger.info(`VK Webhook: http://localhost:${config.server.port}/webhook/vk`);
      logger.info(`MAX Webhook: http://localhost:${config.server.port}/webhook/max`);
    });

    const shutdown = async (signal) => {
      logger.info(`Received ${signal}. Starting graceful shutdown...`);
      server.close(() => {
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

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
