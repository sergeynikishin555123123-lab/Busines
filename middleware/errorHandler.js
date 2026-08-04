// middleware/errorHandler.js
const logger = require('../logger');

function errorHandler(err, req, res, next) {
  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal Server Error';
  
  // Логируем ошибку с контекстом запроса
  logger.error({
    err,
    request: {
      method: req.method,
      url: req.url,
      headers: req.headers,
      body: req.body,
      ip: req.ip,
    },
    user: req.session?.adminId,
  }, `Request error: ${message}`);

  // Не раскрываем детали ошибки в production
  if (process.env.NODE_ENV === 'production' && statusCode === 500) {
    return res.status(statusCode).json({ error: 'Internal Server Error' });
  }

  res.status(statusCode).json({ error: message });
}

function notFoundHandler(req, res) {
  res.status(404).json({ error: `Route ${req.method} ${req.url} not found` });
}

module.exports = {
  errorHandler,
  notFoundHandler,
};
