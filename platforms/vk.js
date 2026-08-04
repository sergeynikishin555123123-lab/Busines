const crypto = require('crypto');
const config = require('../config');
const dispatcher = require('../core/dispatcher');
const logger = require('../logger');
const { AppError } = require('../middleware/errorHandler');

async function webhookHandler(req, res) {
  try {
    const { type, group_id, secret, object } = req.body;

    if (config.vk.secret && secret !== config.vk.secret) {
      logger.warn('VK webhook: Invalid secret');
      return res.status(403).send('Invalid secret');
    }

    switch (type) {
      case 'confirmation':
        logger.info('VK confirmation request');
        return res.send(config.vk.confirmationToken);

      case 'message_new':
        return handleMessageNew(object.message, res);

      case 'message_event':
        return handleMessageEvent(object, res);

      default:
        logger.info(`VK: Unhandled event type: ${type}`);
        return res.send('ok');
    }
  } catch (error) {
    logger.error('VK webhook error:', error);
    return res.send('ok');
  }
}

async function handleMessageNew(message, res) {
  try {
    const normalizedMessage = normalizeVkMessage(message);
    
    res.send('ok');

    await dispatcher.handleMessage(normalizedMessage);
  } catch (error) {
    logger.error('VK handleMessageNew error:', error);
    res.send('ok');
  }
}

async function handleMessageEvent(event, res) {
  try {
    const normalizedMessage = normalizeVkEvent(event);
    
    res.send('ok');

    await dispatcher.handleMessage(normalizedMessage);
  } catch (error) {
    logger.error('VK handleMessageEvent error:', error);
    res.send('ok');
  }
}

function normalizeVkMessage(message) {
  let payload = {};
  
  if (message.payload) {
    try {
      payload = JSON.parse(message.payload);
    } catch (e) {
      payload = {};
    }
  }

  return {
    platform: 'vk',
    userId: message.from_id.toString(),
    firstName: '',
    lastName: '',
    username: '',
    message: message.text || '',
    payload: payload,
    attachments: message.attachments || [],
  };
}

function normalizeVkEvent(event) {
  let payload = {};

  if (event.payload) {
    try {
      payload = typeof event.payload === 'string' ? JSON.parse(event.payload) : event.payload;
    } catch (e) {
      payload = {};
    }
  }

  return {
    platform: 'vk',
    userId: event.user_id.toString(),
    firstName: '',
    lastName: '',
    username: '',
    message: '',
    payload: payload,
    attachments: [],
  };
}

module.exports = {
  webhookHandler,
};
