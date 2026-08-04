const fs = require('fs');
const path = require('path');

const LOG_DIR = process.env.LOG_DIR || '/tmp/logs';

try {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
} catch (error) {
  console.warn(`[LOGGER] Cannot create ${LOG_DIR}`);
}

function getTimestamp() {
  return new Date().toISOString();
}

function writeToFile(level, message, data) {
  try {
    if (!fs.existsSync(LOG_DIR)) return;
    const logFile = path.join(LOG_DIR, `${level.toLowerCase()}.log`);
    const logLine = `[${getTimestamp()}] ${level.toUpperCase()}: ${message} ${data ? JSON.stringify(data) : ''}\n`;
    fs.appendFileSync(logFile, logLine);
  } catch (error) {
    // игнорируем
  }
}

function log(level, message, data) {
  const timestamp = getTimestamp();
  const logMsg = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
  const logData = data ? ' ' + JSON.stringify(data) : '';
  
  if (level === 'ERROR') console.error(logMsg + logData);
  else if (level === 'WARN') console.warn(logMsg + logData);
  else console.log(logMsg + logData);
  
  if (level !== 'DEBUG') writeToFile(level, message, data);
}

const logger = {
  info: (message, data) => log('INFO', message, data),
  error: (message, data) => log('ERROR', message, data),
  warn: (message, data) => log('WARN', message, data),
  debug: (message, data) => log('DEBUG', message, data),
};

module.exports = logger;
