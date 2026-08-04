const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const config = require('../config');
const logger = require('../logger');
const { RateLimiter } = require('../core/queue'); // Импорт очереди

class MaxAPI {
  constructor() {
    this.client = axios.create({
      baseURL: config.max.baseUrl,
      timeout: 30000,
      headers: {
        'Authorization': config.max.token, // <-- БЕЗ Bearer
        'Content-Type': 'application/json',
      },
    });
    
    // Очередь для соблюдения лимита 2 сообщения в секунду на чат
    this.messageQueues = new Map();
    this.rateLimiter = new RateLimiter(config.rateLimit.messagesPerChatPerSecond, 1000);
    
    // Установка обработчиков для перехвата ошибок
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        logger.error({ err: error, config: error.config }, 'MAX API request failed');
        return Promise.reject(error);
      }
    );
  }

  // Вспомогательный метод для очереди
  async enqueueMessage(chatId, sendFunction) {
    if (!this.messageQueues.has(chatId)) {
      this.messageQueues.set(chatId, []);
    }
    
    const queue = this.messageQueues.get(chatId);
    queue.push(sendFunction);
    
    if (queue.length === 1) {
      await this.processQueue(chatId);
    }
  }

  async processQueue(chatId) {
    const queue = this.messageQueues.get(chatId);
    if (!queue || queue.length === 0) return;

    try {
      const sendFunction = queue[0];
      await this.rateLimiter.wait();
      await sendFunction();
      queue.shift(); // Удаляем обработанное
      
      // Обработка следующего в очереди
      if (queue.length > 0) {
        setImmediate(() => this.processQueue(chatId));
      }
    } catch (error) {
      logger.error({ err: error, chatId }, 'Error processing message queue');
      queue.shift(); // Удаляем сообщение с ошибкой, чтобы не блокировать очередь
      if (queue.length > 0) {
        setImmediate(() => this.processQueue(chatId));
      }
    }
  }

  // 1. Отправка простого сообщения
  async sendMessage({ chatId, text, parseMode = 'markdown', attachments = [] }) {
    return this.enqueueMessage(chatId, async () => {
      try {
        const response = await this.client.post('/messages', 
          {
            text: text,
            parse_mode: parseMode, // 'markdown' или 'html'
            attachments: attachments, // Массив аттачментов
          },
          {
            params: {
              user_id: chatId, // <-- Параметр в query
              // или chat_id: chatId
            }
          }
        );
        logger.info({ chatId, text: text.substring(0, 50) }, 'Message sent successfully');
        return response.data;
      } catch (error) {
        logger.error({ err: error, chatId, text }, 'Failed to send message');
        throw error;
      }
    });
  }

  // 2. Отправка сообщения с клавиатурой (inline keyboard)
  async sendKeyboard({ chatId, text, buttons, parseMode = 'markdown' }) {
    const attachment = {
      type: 'inline_keyboard',
      buttons: buttons, // [{ text: '...', payload: {...}, type: 'callback' }]
    };
    return this.sendMessage({ chatId, text, parseMode, attachments: [attachment] });
  }

  // 3. Загрузка файла
  async uploadFile(filePath, fileType = 'document') {
    try {
      const formData = new FormData();
      formData.append('file', fs.createReadStream(filePath));
      formData.append('type', fileType); // document, photo, video

      const response = await this.client.post('/uploads', formData, {
        headers: {
          ...formData.getHeaders(),
          'Authorization': config.max.token, // <-- БЕЗ Bearer
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });

      logger.info({ filePath, token: response.data.token }, 'File uploaded successfully');
      return response.data.token; // Возвращаем token для использования в attachments
    } catch (error) {
      logger.error({ err: error, filePath }, 'Failed to upload file');
      throw error;
    }
  }

  // 4. Отправка сообщения с файлом (используя token или URL)
  async sendFile({ chatId, fileToken, fileUrl, caption = '', parseMode = 'markdown' }) {
    const attachment = {
      type: 'document', // или 'photo', 'video'
      token: fileToken, // предпочтительный способ
      // или url: fileUrl, если разрешено
      caption: caption,
      parse_mode: parseMode,
    };
    return this.sendMessage({ chatId, text: caption, parseMode, attachments: [attachment] });
  }

  // 5. Регистрация webhook
  async registerWebhook(webhookUrl, secret = '') {
    try {
      const response = await this.client.post('/subscriptions', {
        url: webhookUrl,
        secret: secret || config.max.webhookSecret,
        // Возможно также указать конкретные события: ['message_created', 'message_callback']
      });
      logger.info({ webhookUrl }, 'Webhook registered successfully');
      return response.data;
    } catch (error) {
      logger.error({ err: error, webhookUrl }, 'Failed to register webhook');
      throw error;
    }
  }

  // 6. Проверка статуса webhook
  async getWebhookInfo() {
    try {
      const response = await this.client.get('/subscriptions');
      logger.info({ subscriptions: response.data }, 'Webhook info retrieved');
      return response.data;
    } catch (error) {
      logger.error({ err: error }, 'Failed to get webhook info');
      throw error;
    }
  }

  // 7. Регистрация команд
  async registerCommands(commands) {
    try {
      const response = await this.client.patch('/me/commands', {
        commands: commands, // [{ name: 'start', description: '...' }]
      });
      logger.info({ commands }, 'Commands registered successfully');
      return response.data;
    } catch (error) {
      logger.error({ err: error, commands }, 'Failed to register commands');
      throw error;
    }
  }
}

module.exports = MaxAPI;
