const crypto = require('crypto');
const config = require('../config');
const dispatcher = require('../core/dispatcher');
const logger = require('../logger');
const { AppError } = require('../middleware/errorHandler');

async function webhookHandler(req, res) {
  try {
    const update = req.body;

    if (!update) {
      logger.warn('MAX webhook: Empty body');
      return res.sendStatus(200);
    }

    if (update.message) {
      return handleMessage(update.message, res);
    } else if (update.callback_query) {
      return handleCallbackQuery(update.callback_query, res);
    } else {
      logger.info('MAX: Unknown update type', update);
      return res.sendStatus(200);
    }
  } catch (error) {
    logger.error('MAX webhook error:', error);
    return res.sendStatus(200);
  }
}

async function handleMessage(message, res) {
  try {
    const normalizedMessage = normalizeMaxMessage(message);
    
    res.sendStatus(200);

    await dispatcher.handleMessage(normalizedMessage);
  } catch (error) {
    logger.error('MAX handleMessage error:', error);
    res.sendStatus(200);
  }
}

async function handleCallbackQuery(callbackQuery, res) {
  try {
    const normalizedMessage = normalizeMaxCallbackQuery(callbackQuery);
    
    res.sendStatus(200);

    await dispatcher.handleMessage(normalizedMessage);
  } catch (error) {
    logger.error('MAX handleCallbackQuery error:', error);
    res.sendStatus(200);
  }
}

function normalizeMaxMessage(message) {
  let payload = {};

  if (message.text) {
    const text = message.text;
    if (text === '/start') {
      payload = { command: 'start' };
    }
  }

  return {
    platform: 'max',
    userId: message.chat.id.toString(),
    firstName: message.chat.first_name || '',
    lastName: message.chat.last_name || '',
    username: message.chat.username || '',
    message: message.text || '',
    payload: payload,
    attachments: [],
  };
}

function normalizeMaxCallbackQuery(callbackQuery) {
  let payload = {};

  if (callbackQuery.data) {
    try {
      payload = JSON.parse(callbackQuery.data);
    } catch (e) {
      payload = { command: callbackQuery.data };
    }
  }

  return {
    platform: 'max',
    userId: callbackQuery.message.chat.id.toString(),
    firstName: callbackQuery.message.chat.first_name || '',
    lastName: callbackQuery.message.chat.last_name || '',
    username: callbackQuery.message.chat.username || '',
    message: '',
    payload: payload,
    attachments: [],
  };
}

module.exports = {
  webhookHandler,
};
