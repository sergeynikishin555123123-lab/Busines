const pino = require('pino');
const path = require('path');
const fs = require('fs');

const logDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

const transport = pino.transport({
  targets: [
    {
      target: 'pino-pretty',
      level: 'info',
      options: { destination: 1, colorize: true },
    },
    {
      target: 'pino/file',
      level: 'error',
      options: { destination: path.join(logDir, 'error.log') },
    },
    {
      target: 'pino/file',
      level: 'info',
      options: { destination: path.join(logDir, 'combined.log') },
    },
  ],
});

const logger = pino(
  {
    level: process.env.LOG_LEVEL || 'info',
    formatters: {
      bindings: (bindings) => ({ pid: bindings.pid, host: bindings.hostname }),
      level: (label) => ({ level: label.toUpperCase() }),
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  },
  transport
);

module.exports = logger;
