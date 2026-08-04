const fs = require('fs');
const path = require('path');

function getTimestamp() {
  return new Date().toISOString();
}

function log(level, message, data) {
  const logMsg = `[${getTimestamp()}] ${level}: ${message} ${data ? JSON.stringify(data) : ''}`;
  
  if (level === 'ERROR') {
    console.error(logMsg);
  } else if (level === 'WARN') {
    console.warn(logMsg);
  } else {
    console.log(logMsg);
  }
}

const logger = {
  info: (message, data) => log('INFO', message, data),
  error: (message, data) => log('ERROR', message, data),
  warn: (message, data) => log('WARN', message, data),
  debug: (message, data) => log('DEBUG', message, data),
};

module.exports = logger;
