// services/storage.js
// СЕРВИС ХРАНЕНИЯ ФАЙЛОВ

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const logger = require('../logger');

const UPLOADS_DIR = process.env.UPLOADS_DIR || '/tmp/uploads';

class StorageService {
    constructor() {
        this.baseDir = UPLOADS_DIR;
        this.ensureDirectories();
    }

    ensureDirectories() {
        const dirs = [
            this.baseDir,
            path.join(this.baseDir, 'admin'),
            path.join(this.baseDir, 'videos'),
            path.join(this.baseDir, 'files'),
            path.join(this.baseDir, 'temp'),
        ];

        for (const dir of dirs) {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                logger.debug(`Created directory: ${dir}`);
            }
        }
    }

    generateFileName(originalName) {
        const ext = path.extname(originalName);
        const name = path.basename(originalName, ext);
        const timestamp = Date.now();
        const random = crypto.randomBytes(4).toString('hex');
        return `${name}-${timestamp}-${random}${ext}`;
    }

    async saveFile(file, subDir = 'files') {
        try {
            const dir = path.join(this.baseDir, subDir);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            const fileName = this.generateFileName(file.originalname || 'file');
            const filePath = path.join(dir, fileName);
            const url = `/uploads/${subDir}/${fileName}`;

            if (file.buffer) {
                fs.writeFileSync(filePath, file.buffer);
            } else if (file.path) {
                fs.copyFileSync(file.path, filePath);
            } else {
                throw new Error('No file data provided');
            }

            const stats = fs.statSync(filePath);

            logger.info({ filePath, size: stats.size }, 'File saved successfully');
            return {
                url: url,
                path: filePath,
                filename: file.originalname || fileName,
                size: stats.size,
                mimetype: file.mimetype || 'application/octet-stream',
            };

        } catch (error) {
            logger.error({ err: error, file: file.originalname }, 'Failed to save file');
            throw error;
        }
    }

    async deleteFile(url) {
        try {
            if (!url) return false;

            // Извлекаем путь из URL
            const relativePath = url.replace(/^\/uploads\//, '');
            const filePath = path.join(this.baseDir, relativePath);

            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
                logger.info({ filePath }, 'File deleted successfully');
                return true;
            }

            logger.warn({ filePath }, 'File not found for deletion');
            return false;

        } catch (error) {
            logger.error({ err: error, url }, 'Failed to delete file');
            throw error;
        }
    }

    async getFileInfo(url) {
        try {
            const relativePath = url.replace(/^\/uploads\//, '');
            const filePath = path.join(this.baseDir, relativePath);

            if (!fs.existsSync(filePath)) {
                return null;
            }

            const stats = fs.statSync(filePath);
            return {
                path: filePath,
                size: stats.size,
                created: stats.birthtime,
                modified: stats.mtime,
            };

        } catch (error) {
            logger.error({ err: error, url }, 'Failed to get file info');
            return null;
        }
    }

    async readFile(url) {
        try {
            const info = await this.getFileInfo(url);
            if (!info) return null;
            return fs.readFileSync(info.path);
        } catch (error) {
            logger.error({ err: error, url }, 'Failed to read file');
            return null;
        }
    }

    async copyFile(sourceUrl, destSubDir = 'files') {
        try {
            const sourceInfo = await this.getFileInfo(sourceUrl);
            if (!sourceInfo) {
                throw new Error('Source file not found');
            }

            const dir = path.join(this.baseDir, destSubDir);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            const fileName = this.generateFileName(path.basename(sourceInfo.path));
            const destPath = path.join(dir, fileName);
            const destUrl = `/uploads/${destSubDir}/${fileName}`;

            fs.copyFileSync(sourceInfo.path, destPath);

            logger.info({ source: sourceUrl, dest: destUrl }, 'File copied successfully');
            return {
                url: destUrl,
                path: destPath,
                filename: path.basename(sourceInfo.path),
                size: sourceInfo.size,
            };

        } catch (error) {
            logger.error({ err: error, sourceUrl }, 'Failed to copy file');
            throw error;
        }
    }

    async moveFile(sourceUrl, destSubDir = 'files') {
        try {
            const result = await this.copyFile(sourceUrl, destSubDir);
            await this.deleteFile(sourceUrl);
            return result;
        } catch (error) {
            logger.error({ err: error, sourceUrl }, 'Failed to move file');
            throw error;
        }
    }

    getFileUrl(filePath) {
        if (!filePath) return null;
        const relative = path.relative(this.baseDir, filePath);
        return `/uploads/${relative}`;
    }

    getFilePath(url) {
        if (!url) return null;
        const relative = url.replace(/^\/uploads\//, '');
        return path.join(this.baseDir, relative);
    }

    async listFiles(subDir = 'files') {
        try {
            const dir = path.join(this.baseDir, subDir);
            if (!fs.existsSync(dir)) {
                return [];
            }

            const files = fs.readdirSync(dir);
            const result = [];

            for (const file of files) {
                const filePath = path.join(dir, file);
                const stats = fs.statSync(filePath);
                if (stats.isFile()) {
                    result.push({
                        filename: file,
                        path: filePath,
                        url: `/uploads/${subDir}/${file}`,
                        size: stats.size,
                        created: stats.birthtime,
                        modified: stats.mtime,
                    });
                }
            }

            return result;

        } catch (error) {
            logger.error({ err: error, subDir }, 'Failed to list files');
            return [];
        }
    }

    async ensureDirectory(subDir) {
        const dir = path.join(this.baseDir, subDir);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
        return dir;
    }

    // Метод для сохранения видео
    async saveVideo(file) {
        return this.saveFile(file, 'videos');
    }

    // Метод для сохранения изображений
    async saveImage(file) {
        return this.saveFile(file, 'images');
    }

    // Метод для сохранения документов
    async saveDocument(file) {
        return this.saveFile(file, 'files');
    }

    // Получение размера директории
    async getDirectorySize(subDir = '') {
        try {
            const dir = path.join(this.baseDir, subDir);
            if (!fs.existsSync(dir)) {
                return 0;
            }

            let totalSize = 0;
            const files = fs.readdirSync(dir);

            for (const file of files) {
                const filePath = path.join(dir, file);
                const stats = fs.statSync(filePath);
                if (stats.isFile()) {
                    totalSize += stats.size;
                } else if (stats.isDirectory()) {
                    totalSize += await this.getDirectorySize(path.join(subDir, file));
                }
            }

            return totalSize;

        } catch (error) {
            logger.error({ err: error }, 'Failed to get directory size');
            return 0;
        }
    }

    // Очистка временных файлов старше N дней
    async cleanTempFiles(days = 7) {
        try {
            const tempDir = path.join(this.baseDir, 'temp');
            if (!fs.existsSync(tempDir)) {
                return 0;
            }

            const now = Date.now();
            const maxAge = days * 24 * 60 * 60 * 1000;
            let deleted = 0;

            const files = fs.readdirSync(tempDir);
            for (const file of files) {
                const filePath = path.join(tempDir, file);
                const stats = fs.statSync(filePath);
                if (stats.isFile() && (now - stats.mtimeMs) > maxAge) {
                    fs.unlinkSync(filePath);
                    deleted++;
                }
            }

            if (deleted > 0) {
                logger.info({ deleted, days }, 'Cleaned temporary files');
            }

            return deleted;

        } catch (error) {
            logger.error({ err: error }, 'Failed to clean temp files');
            return 0;
        }
    }
}

module.exports = new StorageService();
