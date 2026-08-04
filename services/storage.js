const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const logger = require('../logger');

class StorageService {
  constructor() {
    this.basePath = path.resolve(config.storage.localPath);
    this.maxFileSizeBytes = config.storage.maxFileSizeMb * 1024 * 1024;
    this.allowedExtensions = config.storage.allowedExtensions;
    this.allowedMimeTypes = config.storage.allowedMimeTypes;
    
    this.ensureBasePath();
  }

 ensureBasePath() {
  try {
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
  } catch (error) {
    console.warn('Cannot create uploads directory:', error.message);
    this.basePath = '/tmp/uploads';
    try {
      if (!fs.existsSync(this.basePath)) {
        fs.mkdirSync(this.basePath, { recursive: true });
      }
    } catch (err) {
      console.error('Cannot create /tmp/uploads:', err.message);
    }
  }
  
  try {
    const htaccessPath = path.join(this.basePath, '.htaccess');
    if (!fs.existsSync(htaccessPath)) {
      const htaccessContent = `
# Запрет выполнения файлов
<FilesMatch "\.(php|phtml|php3|php4|php5|php7|phps|cgi|pl|py|jsp|asp|aspx|shtml|shtm|exe|dll|bat|cmd|sh)$">
    Deny from all
</FilesMatch>

# Запрет листинга директорий
Options -Indexes
      `.trim();
      fs.writeFileSync(htaccessPath, htaccessContent);
    }
  } catch (error) {
    console.warn('Cannot create .htaccess:', error.message);
  }
}
  validateFile(file) {
    if (!file) {
      throw new Error('Файл не предоставлен');
    }

    if (file.size > this.maxFileSizeBytes) {
      throw new Error(`Размер файла превышает максимально допустимый (${config.storage.maxFileSizeMb}MB)`);
    }

    const ext = path.extname(file.originalname).toLowerCase();
    if (!this.allowedExtensions.includes(ext)) {
      throw new Error(`Недопустимое расширение файла: ${ext}`);
    }

    if (!this.allowedMimeTypes.includes(file.mimetype)) {
      throw new Error(`Недопустимый тип файла: ${file.mimetype}`);
    }

    return true;
  }

  generateSafeFilename(originalname) {
    const ext = path.extname(originalname).toLowerCase();
    const randomName = crypto.randomBytes(16).toString('hex');
    return `${randomName}${ext}`;
  }

  async uploadFile(file, directory = 'files') {
    this.validateFile(file);

    const dirPath = path.join(this.basePath, directory);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }

    const safeFilename = this.generateSafeFilename(file.originalname);
    const filePath = path.join(dirPath, safeFilename);

    await fs.promises.writeFile(filePath, file.buffer);
    
    logger.info(`File uploaded: ${safeFilename}`, {
      originalName: file.originalname,
      size: file.size,
      directory: directory,
    });

    return {
      url: `/uploads/${directory}/${safeFilename}`,
      filename: safeFilename,
      originalname: file.originalname,
      size: file.size,
    };
  }

  async deleteFile(fileUrl) {
    if (!fileUrl) {
      throw new Error('URL файла не указан');
    }

    const relativePath = fileUrl.replace('/uploads/', '');
    const filePath = path.join(this.basePath, relativePath);

    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
      logger.info(`File deleted: ${relativePath}`);
      return true;
    }
    
    logger.warn(`File not found for deletion: ${relativePath}`);
    return false;
  }

  getUrl(fileUrl) {
    if (!fileUrl) {
      return null;
    }
    return fileUrl;
  }

  getAbsolutePath(fileUrl) {
    if (!fileUrl) {
      return null;
    }
    const relativePath = fileUrl.replace('/uploads/', '');
    return path.join(this.basePath, relativePath);
  }
}

const storageService = new StorageService();

module.exports = storageService;
