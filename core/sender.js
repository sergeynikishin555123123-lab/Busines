const axios = require('axios');
const config = require('../config');
const logger = require('../logger');
const { AppError } = require('../middleware/errorHandler');

class MessageSender {
  constructor(platform, userId) {
    this.platform = platform;
    this.userId = userId;
  }

  async sendText(text) {
    if (this.platform === 'vk') {
      return this.sendVkMessage(text);
    } else if (this.platform === 'max') {
      return this.sendMaxMessage(text);
    }
    throw new AppError(`Unknown platform: ${this.platform}`, 400, 'UNKNOWN_PLATFORM');
  }

  async sendButtons(text, buttons) {
    if (this.platform === 'vk') {
      return this.sendVkButtons(text, buttons);
    } else if (this.platform === 'max') {
      return this.sendMaxButtons(text, buttons);
    }
    throw new AppError(`Unknown platform: ${this.platform}`, 400, 'UNKNOWN_PLATFORM');
  }

  async sendFile(fileUrl, filename) {
    if (this.platform === 'vk') {
      return this.sendVkFile(fileUrl, filename);
    } else if (this.platform === 'max') {
      return this.sendMaxFile(fileUrl, filename);
    }
    throw new AppError(`Unknown platform: ${this.platform}`, 400, 'UNKNOWN_PLATFORM');
  }

  async sendVideo(videoUrl) {
    if (this.platform === 'vk') {
      return this.sendVkMessage(`📹 Видео: ${videoUrl}`);
    } else if (this.platform === 'max') {
      return this.sendMaxMessage(`📹 Видео: ${videoUrl}`);
    }
    throw new AppError(`Unknown platform: ${this.platform}`, 400, 'UNKNOWN_PLATFORM');
  }

  async sendVkMessage(text) {
    try {
      const response = await axios.post(
        'https://api.vk.com/method/messages.send',
        null,
        {
          params: {
            user_id: this.userId,
            message: text,
            random_id: Math.floor(Math.random() * 2147483647),
            access_token: config.vk.accessToken,
            v: '5.199',
          },
        }
      );

      if (response.data.error) {
        logger.error('VK send message error:', response.data.error);
        throw new AppError('Failed to send VK message', 500, 'VK_SEND_ERROR');
      }

      return response.data;
    } catch (error) {
      logger.error('VK send message exception:', error.message);
      throw new AppError('Failed to send VK message', 500, 'VK_SEND_ERROR');
    }
  }

  async sendVkButtons(text, buttons) {
    try {
      const keyboard = {
        one_time: false,
        inline: false,
        buttons: buttons.map(row => 
          row.map(btn => ({
            action: {
              type: 'text',
              label: btn.text,
              payload: JSON.stringify(btn.payload || {}),
            },
            color: btn.color || 'primary',
          }))
        ),
      };

      const response = await axios.post(
        'https://api.vk.com/method/messages.send',
        null,
        {
          params: {
            user_id: this.userId,
            message: text,
            keyboard: JSON.stringify(keyboard),
            random_id: Math.floor(Math.random() * 2147483647),
            access_token: config.vk.accessToken,
            v: '5.199',
          },
        }
      );

      if (response.data.error) {
        logger.error('VK send buttons error:', response.data.error);
        throw new AppError('Failed to send VK buttons', 500, 'VK_SEND_ERROR');
      }

      return response.data;
    } catch (error) {
      logger.error('VK send buttons exception:', error.message);
      throw new AppError('Failed to send VK buttons', 500, 'VK_SEND_ERROR');
    }
  }

  async sendVkFile(fileUrl, filename) {
    const fullUrl = fileUrl.startsWith('http') ? fileUrl : `https://${config.server.adminDomain}${fileUrl}`;
    return this.sendVkMessage(`📎 Файл: ${filename}\n${fullUrl}`);
  }

  async sendMaxMessage(text) {
    try {
      const response = await axios.post(
        `${config.max.apiUrl}/bot${config.max.botToken}/sendMessage`,
        {
          chat_id: this.userId,
          text: text,
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data;
    } catch (error) {
      logger.error('MAX send message error:', error.message);
      throw new AppError('Failed to send MAX message', 500, 'MAX_SEND_ERROR');
    }
  }

  async sendMaxButtons(text, buttons) {
    try {
      const inlineKeyboard = {
        inline_keyboard: buttons.map(row =>
          row.map(btn => ({
            text: btn.text,
            callback_data: JSON.stringify(btn.payload || {}),
          }))
        ),
      };

      const response = await axios.post(
        `${config.max.apiUrl}/bot${config.max.botToken}/sendMessage`,
        {
          chat_id: this.userId,
          text: text,
          reply_markup: inlineKeyboard,
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data;
    } catch (error) {
      logger.error('MAX send buttons error:', error.message);
      throw new AppError('Failed to send MAX buttons', 500, 'MAX_SEND_ERROR');
    }
  }

  async sendMaxFile(fileUrl, filename) {
    const fullUrl = fileUrl.startsWith('http') ? fileUrl : `https://${config.server.adminDomain}${fileUrl}`;
    
    try {
      const response = await axios.post(
        `${config.max.apiUrl}/bot${config.max.botToken}/sendDocument`,
        {
          chat_id: this.userId,
          document: fullUrl,
          caption: filename,
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data;
    } catch (error) {
      logger.error('MAX send file error:', error.message);
      return this.sendMaxMessage(`📎 Файл: ${filename}\n${fullUrl}`);
    }
  }
}

module.exports = MessageSender;
