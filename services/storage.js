const fs = require('fs');
const path = require('path');
const config = require('../config');
const logger = require('../logger');

class StorageService {
  constructor() {
    this.storagePath = config.storage.localPath || './uploads';
    this.ensureDirectoryExists();
  }

  ensureDirectoryExists() {
    const dirs = [this.storagePath];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  async saveFile(buffer, originalFilename, subdir = '') {
    const ext = path.extname(originalFilename);
    const name = path.basename(originalFilename, ext);
    const timestamp = Date.now();
    const safeName = name.replace(/[^a-zA-Z0-9]/g, '_');
    const filename = `${safeName}_${timestamp}${ext}`;
    
    let filePath = this.storagePath;
    if (subdir) {
      filePath = path.join(filePath, subdir);
      if (!fs.existsSync(filePath)) {
        fs.mkdirSync(filePath, { recursive: true });
      }
    }
    
    const fullPath = path.join(filePath, filename);
    fs.writeFileSync(fullPath, buffer);
    
    const url = `/uploads/${subdir ? subdir + '/' : ''}${filename}`;
    logger.info(`File saved: ${fullPath} -> ${url}`);
    
    return url;
  }

  async deleteFile(url) {
    try {
      // Извлекаем путь из URL
      const relativePath = url.replace(/^\/uploads\//, '');
      const fullPath = path.join(this.storagePath, relativePath);
      
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        logger.info(`File deleted: ${fullPath}`);
      }
    } catch (error) {
      logger.warn(`Failed to delete file: ${url}`, error.message);
    }
  }

  async getFileStream(url) {
    const relativePath = url.replace(/^\/uploads\//, '');
    const fullPath = path.join(this.storagePath, relativePath);
    
    if (!fs.existsSync(fullPath)) {
      return null;
    }
    
    return fs.createReadStream(fullPath);
  }
}

module.exports = new StorageService();
