const fs = require('fs');
const path = require('path');

// Определяем путь к логам
const logDir = path.join(__dirname, 'logs');

// Создаём директорию с обработкой ошибок
try {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true, mode: 0o777 });
    console.log(`[LOGGER] Created log directory: ${logDir}`);
  }
} catch (error) {
  // Если не можем создать - используем /tmp или /dev/null
  console.warn(`[LOGGER] Cannot create ${logDir}, using fallback:`, error.message);
  // Fallback: используем /tmp/logs
  const fallbackDir = '/tmp/logs';
  try {
    if (!fs.existsSync(fallbackDir)) {
      fs.mkdirSync(fallbackDir, { recursive: true, mode: 0o777 });
    }
    logDir = fallbackDir;
    console.log(`[LOGGER] Using fallback log directory: ${fallbackDir}`);
  } catch (fallbackError) {
    console.warn('[LOGGER] Cannot create fallback log directory, logging to console only');
    // Включаем режим только консоль
    const consoleOnly = true;
  }
}

// Исправленный путь для модуля
const LOG_DIR = logDir;

function getTimestamp() {
  return new Date().toISOString();
}

function writeToFile(level, message, data) {
  try {
    const logFile = path.join(LOG_DIR, `${level.toLowerCase()}.log`);
    const logLine = `[${getTimestamp()}] ${level.toUpperCase()}: ${message} ${data ? JSON.stringify(data) : ''}\n`;
    fs.appendFileSync(logFile, logLine);
  } catch (error) {
    // Если не можем записать в файл - только консоль
    // console.warn('[LOGGER] Cannot write to file:', error.message);
  }
}

function log(level, message, data) {
  const logMsg = `[${getTimestamp()}] ${level.toUpperCase()}: ${message} ${data ? JSON.stringify(data) : ''}`;
  
  if (level === 'ERROR') {
    console.error(logMsg);
  } else if (level === 'WARN') {
    console.warn(logMsg);
  } else {
    console.log(logMsg);
  }
  
  // Запись в файл (кроме DEBUG)
  if (level !== 'DEBUG' && LOG_DIR) {
    writeToFile(level, message, data);
  }
}

const logger = {
  info: (message, data) => log('INFO', message, data),
  error: (message, data) => log('ERROR', message, data),
  warn: (message, data) => log('WARN', message, data),
  debug: (message, data) => log('DEBUG', message, data),
};

module.exports = logger;
