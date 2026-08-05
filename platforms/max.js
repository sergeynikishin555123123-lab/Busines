// platforms/max.js
// КЛИЕНТ MAX API - ПОЛНАЯ ВЕРСИЯ

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const config = require('../config');
const logger = require('../logger');
const { RateLimiter } = require('../core/queue');

class MaxAPI {
    constructor() {
        console.log('[MAX] Initializing API client...');
        console.log('[MAX] Base URL:', config.max.baseUrl);
        console.log('[MAX] Token:', config.max.token ? '✅ Set' : '❌ Not set');

        this.client = axios.create({
            baseURL: config.max.baseUrl,
            timeout: 30000,
            headers: {
                'Authorization': config.max.token,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
        });

        this.messageQueues = new Map();
        this.rateLimiter = new RateLimiter(config.rateLimit.messagesPerChatPerSecond, 1000);

        this.client.interceptors.request.use(
            (config) => {
                console.log(`[MAX] Request: ${config.method.toUpperCase()} ${config.baseURL}${config.url}`);
                if (config.data) {
                    console.log('[MAX] Request data:', JSON.stringify(config.data, null, 2));
                }
                return config;
            },
            (error) => {
                console.error('[MAX] Request error:', error);
                return Promise.reject(error);
            }
        );

        this.client.interceptors.response.use(
            (response) => {
                console.log(`[MAX] Response: ${response.status} ${response.config.url}`);
                console.log('[MAX] Response data:', JSON.stringify(response.data, null, 2));
                return response;
            },
            (error) => {
                if (error.response) {
                    console.error(`[MAX] Response error: ${error.response.status} ${error.config?.url}`);
                    console.error('[MAX] Response data:', error.response.data);
                } else {
                    console.error('[MAX] Network error:', error.message);
                }
                logger.error({
                    err: error,
                    config: error.config,
                    response: error.response?.data
                }, 'MAX API request failed');
                return Promise.reject(error);
            }
        );
    }

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
            queue.shift();

            if (queue.length > 0) {
                setImmediate(() => this.processQueue(chatId));
            }
        } catch (error) {
            logger.error({ err: error, chatId }, 'Error processing message queue');
            queue.shift();
            if (queue.length > 0) {
                setImmediate(() => this.processQueue(chatId));
            }
        }
    }

    // ============================================================
    // ОТПРАВКА СООБЩЕНИЯ
    // ============================================================
    async sendMessage({ chatId, text, parseMode = 'markdown', attachments = [] }) {
        return this.enqueueMessage(chatId, async () => {
            try {
                const requestData = {
                    chat_id: chatId,
                    text: text,
                    format: parseMode,
                };

                if (attachments && attachments.length > 0) {
                    requestData.attachments = attachments;
                }

                const response = await this.client.post('/messages', requestData, {
                    params: {
                        chat_id: chatId
                    }
                });

                console.log(`[MAX] ✅ Message sent to ${chatId}: ${text.substring(0, 50)}`);
                logger.info({ chatId, text: text.substring(0, 50) }, 'Message sent successfully');
                return response.data;

            } catch (error) {
                console.error(`[MAX] ❌ Failed to send message to ${chatId}:`, error.message);
                if (error.response) {
                    console.error('[MAX] Error response:', error.response.data);
                }
                logger.error({ err: error, chatId, text }, 'Failed to send message');
                throw error;
            }
        });
    }

    // ============================================================
    // ОТПРАВКА КЛАВИАТУРЫ
    // ============================================================
    async sendKeyboard({ chatId, text, buttons, parseMode = 'markdown' }) {
        const attachment = {
            type: 'inline_keyboard',
            payload: {
                buttons: buttons
            }
        };
        return this.sendMessage({ chatId, text, parseMode, attachments: [attachment] });
    }

   // platforms/max.js - ИСПРАВЛЕННЫЙ МЕТОД uploadFile

async uploadFile(filePath, fileType = 'file') {
    try {
        console.log(`[MAX] Uploading file: ${filePath}, type: ${fileType}`);

        if (!fs.existsSync(filePath)) {
            throw new Error(`File not found: ${filePath}`);
        }

        const fileStats = fs.statSync(filePath);
        console.log(`[MAX] File size: ${fileStats.size} bytes`);

        // ВАЖНО: Используем правильный формат FormData
        const formData = new FormData();
        
        // Добавляем файл с правильным полем
        const readStream = fs.createReadStream(filePath);
        formData.append('file', readStream, {
            filename: path.basename(filePath),
            contentType: fileType === 'video' ? 'video/mp4' : 'application/octet-stream'
        });
        
        // Добавляем тип файла ОБЯЗАТЕЛЬНО
        formData.append('type', fileType);

        // ОТПРАВЛЯЕМ ЗАПРОС
        const response = await this.client.post('/uploads', formData, {
            headers: {
                ...formData.getHeaders(),
                'Authorization': config.max.token,
                // Убираем Content-Type, т.к. form-data установит свой
            },
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            // Увеличиваем таймаут для больших файлов
            timeout: 600000, // 10 минут
        });

        console.log(`[MAX] ✅ File uploaded, token: ${response.data.token}`);
        logger.info({ filePath, token: response.data.token, type: fileType }, 'File uploaded successfully');
        return response.data.token;

    } catch (error) {
        console.error(`[MAX] ❌ Failed to upload file: ${filePath}`, error.message);
        if (error.response) {
            console.error('[MAX] Response status:', error.response.status);
            console.error('[MAX] Response data:', error.response.data);
        }
        logger.error({ err: error, filePath }, 'Failed to upload file to MAX');
        throw error;
    }
}

    // ============================================================
    // ============== НОВЫЙ МЕТОД: ЗАГРУЗКА ФАЙЛА ИЗ URL =========
    // ============================================================
    async uploadFileFromUrl(fileUrl, fileType = 'file') {
        try {
            console.log(`[MAX] Downloading file from URL: ${fileUrl}, type: ${fileType}`);

            // Скачиваем файл
            const response = await axios.get(fileUrl, {
                responseType: 'arraybuffer',
                timeout: 300000,
            });

            // Сохраняем временно
            const tempPath = `/tmp/upload-${Date.now()}.tmp`;
            fs.writeFileSync(tempPath, Buffer.from(response.data));

            // Загружаем в MAX
            const token = await this.uploadFile(tempPath, fileType);

            // Удаляем временный файл
            fs.unlinkSync(tempPath);

            console.log(`[MAX] ✅ File uploaded from URL, token: ${token}`);
            return token;

        } catch (error) {
            console.error(`[MAX] ❌ Failed to upload file from URL: ${fileUrl}`, error.message);
            logger.error({ err: error, fileUrl }, 'Failed to upload file from URL');
            throw error;
        }
    }

    // ============================================================
    // ОТПРАВКА ВИДЕО (через загрузку файла)
    // ============================================================
    async sendVideo({ chatId, videoPath, caption = '', parseMode = 'markdown' }) {
        try {
            console.log(`[MAX] Uploading video for chat ${chatId}...`);
            const token = await this.uploadFile(videoPath, 'video');

            const attachment = {
                type: 'video',
                payload: { token: token }
            };

            console.log(`[MAX] Sending video message to ${chatId}...`);
            return await this.sendMessage({
                chatId,
                text: caption,
                parseMode,
                attachments: [attachment]
            });

        } catch (error) {
            console.error(`[MAX] ❌ Failed to send video to ${chatId}:`, error.message);
            logger.error({ err: error, chatId, videoPath }, 'Failed to send video');
            throw error;
        }
    }

    // ============================================================
    // ОТПРАВКА ФАЙЛА (через загрузку файла)
    // ============================================================
    async sendFile({ chatId, filePath, caption = '', parseMode = 'markdown' }) {
        try {
            console.log(`[MAX] Uploading file for chat ${chatId}...`);
            const token = await this.uploadFile(filePath, 'file');

            const attachment = {
                type: 'file',
                payload: { token: token }
            };

            console.log(`[MAX] Sending file message to ${chatId}...`);
            return await this.sendMessage({
                chatId,
                text: caption,
                parseMode,
                attachments: [attachment]
            });

        } catch (error) {
            console.error(`[MAX] ❌ Failed to send file to ${chatId}:`, error.message);
            logger.error({ err: error, chatId, filePath }, 'Failed to send file');
            throw error;
        }
    }

    // ============================================================
    // ============== ОТПРАВКА ПО ТОКЕНУ (БЕЗ ПОВТОРНОЙ ЗАГРУЗКИ) =
    // ============================================================

    // ОТПРАВКА ВИДЕО ПО ТОКЕНУ
    async sendVideoByToken({ chatId, token, caption = '', parseMode = 'markdown' }) {
        try {
            console.log(`[MAX] Sending video by token to ${chatId}...`);
            
            const attachment = {
                type: 'video',
                payload: { token: token }
            };

            return await this.sendMessage({
                chatId,
                text: caption,
                parseMode,
                attachments: [attachment]
            });

        } catch (error) {
            console.error(`[MAX] ❌ Failed to send video by token to ${chatId}:`, error.message);
            logger.error({ err: error, chatId, token }, 'Failed to send video by token');
            throw error;
        }
    }

    // ОТПРАВКА ФАЙЛА ПО ТОКЕНУ
    async sendFileByToken({ chatId, token, caption = '', parseMode = 'markdown' }) {
        try {
            console.log(`[MAX] Sending file by token to ${chatId}...`);
            
            const attachment = {
                type: 'file',
                payload: { token: token }
            };

            return await this.sendMessage({
                chatId,
                text: caption,
                parseMode,
                attachments: [attachment]
            });

        } catch (error) {
            console.error(`[MAX] ❌ Failed to send file by token to ${chatId}:`, error.message);
            logger.error({ err: error, chatId, token }, 'Failed to send file by token');
            throw error;
        }
    }

    // ОТПРАВКА ИЗОБРАЖЕНИЯ ПО ТОКЕНУ
    async sendImageByToken({ chatId, token, caption = '', parseMode = 'markdown' }) {
        try {
            console.log(`[MAX] Sending image by token to ${chatId}...`);
            
            const attachment = {
                type: 'image',
                payload: { token: token }
            };

            return await this.sendMessage({
                chatId,
                text: caption,
                parseMode,
                attachments: [attachment]
            });

        } catch (error) {
            console.error(`[MAX] ❌ Failed to send image by token to ${chatId}:`, error.message);
            logger.error({ err: error, chatId, token }, 'Failed to send image by token');
            throw error;
        }
    }

    // ============================================================
    // ============== РАБОТА С ВЛОЖЕНИЯМИ В СООБЩЕНИЯХ ===========
    // ============================================================

    // ПОЛУЧЕНИЕ ИНФОРМАЦИИ О ФАЙЛЕ ПО ТОКЕНУ
    async getFileInfo(token) {
        try {
            console.log(`[MAX] Getting file info for token: ${token.substring(0, 20)}...`);
            
            const response = await this.client.get(`/uploads/${token}`);
            return response.data;
        } catch (error) {
            console.error('[MAX] Failed to get file info:', error.message);
            return null;
        }
    }

    // УДАЛЕНИЕ ФАЙЛА ПО ТОКЕНУ
    async deleteFile(token) {
        try {
            console.log(`[MAX] Deleting file: ${token.substring(0, 20)}...`);
            
            const response = await this.client.delete(`/uploads/${token}`);
            return response.data;
        } catch (error) {
            console.error('[MAX] Failed to delete file:', error.message);
            throw error;
        }
    }

    // ============================================================
    // УПРАВЛЕНИЕ ВЕБХУКОМ
    // ============================================================
    async registerWebhook(webhookUrl, secret = '') {
        try {
            const payload = {
                url: webhookUrl,
                update_types: ['message_created', 'bot_started', 'message_callback', 'bot_added', 'bot_removed'],
            };

            if (secret) {
                payload.secret = secret;
            }

            const response = await this.client.post('/subscriptions', payload);
            logger.info({ webhookUrl }, 'Webhook registered successfully');
            return response.data;

        } catch (error) {
            logger.error({ err: error, webhookUrl }, 'Failed to register webhook');
            throw error;
        }
    }

    async getWebhookInfo() {
        try {
            const response = await this.client.get('/subscriptions');
            return response.data;
        } catch (error) {
            logger.error({ err: error }, 'Failed to get webhook info');
            throw error;
        }
    }

    async deleteWebhook(url) {
        try {
            const response = await this.client.delete('/subscriptions', {
                params: { url: url }
            });
            logger.info('Webhook deleted successfully');
            return response.data;
        } catch (error) {
            logger.error({ err: error }, 'Failed to delete webhook');
            throw error;
        }
    }

    // ============================================================
    // РЕГИСТРАЦИЯ КОМАНД
    // ============================================================
    async registerCommands(commands) {
        try {
            const response = await this.client.patch('/me/commands', { commands });
            logger.info({ commands }, 'Commands registered successfully');
            return response.data;
        } catch (error) {
            logger.error({ err: error, commands }, 'Failed to register commands');
            throw error;
        }
    }

    async getMe() {
        try {
            const response = await this.client.get('/me');
            return response.data;
        } catch (error) {
            logger.error({ err: error }, 'Failed to get bot info');
            throw error;
        }
    }

    // ============================================================
    // ============== ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ =====================
    // ============================================================

    // ПРОВЕРКА ТОКЕНА
    async validateToken(token) {
        try {
            const info = await this.getFileInfo(token);
            return info && info.id;
        } catch (error) {
            return false;
        }
    }

    // ПОЛУЧЕНИЕ СТАТИСТИКИ БОТА
    async getBotStats() {
        try {
            const response = await this.client.get('/me/stats');
            return response.data;
        } catch (error) {
            console.error('[MAX] Failed to get bot stats:', error.message);
            return null;
        }
    }

    // ОТПРАВКА УВЕДОМЛЕНИЯ О НАБОРЕ ТЕКСТА
    async sendTyping(chatId) {
        try {
            await this.client.post('/messages/typing', { chat_id: chatId });
        } catch (error) {
            console.error('[MAX] Failed to send typing:', error.message);
        }
    }

    // ОТМЕТКА СООБЩЕНИЯ КАК ПРОЧИТАННОГО
    async markAsRead(chatId, messageId) {
        try {
            await this.client.post('/messages/read', {
                chat_id: chatId,
                message_id: messageId
            });
        } catch (error) {
            console.error('[MAX] Failed to mark as read:', error.message);
        }
    }
}

module.exports = MaxAPI;
