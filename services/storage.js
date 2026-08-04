const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../logger');
const MaxAPI = require('../platforms/max');

// Временное хранилище для привязки загруженных файлов к чату/пользователю
const uploadSessions = new Map();

class StorageService {
  static async uploadFile(fileBuffer, filename, chatId, fileType = 'document') {
    // 1. Сохраняем файл локально
    const uploadDir = config.storage.localPath;
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    const uniqueFilename = `${Date.now()}-${filename}`;
    const filePath = path.join(uploadDir, uniqueFilename);
    fs.writeFileSync(filePath, fileBuffer);
    
    // 2. Загружаем в MAX через API
    const maxApi = new MaxAPI();
    try {
      const token = await maxApi.uploadFile(filePath, fileType);
      
      // Сохраняем связь токена с локальным файлом
      if (!uploadSessions.has(chatId)) {
        uploadSessions.set(chatId, new Map());
      }
      uploadSessions.get(chatId).set(token, filePath);
      
      logger.info({ token, filename, chatId }, 'File uploaded and linked to chat');
      return token;
    } catch (error) {
      // Удаляем локальный файл в случае ошибки
      fs.unlinkSync(filePath);
      throw error;
    }
  }

  static async getLocalFileByToken(chatId, token) {
    if (uploadSessions.has(chatId)) {
      const filePath = uploadSessions.get(chatId).get(token);
      if (filePath && fs.existsSync(filePath)) {
        return filePath;
      }
    }
    return null;
  }

  static cleanupSession(chatId) {
    if (uploadSessions.has(chatId)) {
      for (const [token, filePath] of uploadSessions.get(chatId)) {
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
          }
        } catch (error) {
          logger.error({ err: error, filePath }, 'Error cleaning up uploaded file');
        }
      }
      uploadSessions.delete(chatId);
    }
  }
}

module.exports = StorageService;
