// platforms/max.js
// КЛИЕНТ MAX API - ПОЛНАЯ ВЕРСИЯ ПО ДОКУМЕНТАЦИИ

const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
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
            timeout: 600000, // 10 минут для больших файлов
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            headers: {
                'Authorization': config.max.token,
                'Accept': 'application/json',
            },
        });

        this.messageQueues = new Map();
        this.rateLimiter = new RateLimiter(config.rateLimit?.messagesPerChatPerSecond || 30, 1000);

        this.client.interceptors.request.use(
            (config) => {
                console.log(`[MAX] Request: ${config.method.toUpperCase()} ${config.baseURL}${config.url}`);
                if (config.data && typeof config.data === 'object') {
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

                const response = await this.client.post('/messages', requestData);

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

    // ============================================================
    // ============== ЗАГРУЗКА ФАЙЛА В MAX (ПО ДОКУМЕНТАЦИИ) =====
    // ============================================================
    /**
     * Загрузка медиафайла в MAX
     * @param {string} filePath - путь к файлу
     * @param {string} fileType - тип файла: 'image', 'video', 'audio', 'file'
     * @returns {Promise<string>} - токен файла
     */
    async uploadFile(filePath, fileType = 'file') {
        try {
            console.log(`[MAX] Uploading file: ${filePath}, type: ${fileType}`);

            if (!fs.existsSync(filePath)) {
                throw new Error(`File not found: ${filePath}`);
            }

            const fileStats = fs.statSync(filePath);
            console.log(`[MAX] File size: ${fileStats.size} bytes`);

            // ШАГ 1: Получаем URL для загрузки
            // POST /uploads?type={type}
            const uploadResponse = await this.client.post(`/uploads?type=${fileType}`);
            const uploadUrl = uploadResponse.data.url;
            
            console.log(`[MAX] Got upload URL: ${uploadUrl}`);

            // ШАГ 2: Загружаем файл по полученному URL
            // Используем multipart/form-data как в документации
            const formData = new FormData();
            formData.append('data', fs.createReadStream(filePath));

            const uploadResult = await axios.post(uploadUrl, formData, {
                headers: {
                    ...formData.getHeaders(),
                    'Authorization': config.max.token,
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
                timeout: 600000,
            });

            // ШАГ 3: Получаем токен из ответа
            const token = uploadResult.data.token;
            
            if (!token) {
                throw new Error('No token received from upload');
            }

            console.log(`[MAX] ✅ File uploaded, token: ${token}`);
            logger.info({ filePath, token, type: fileType }, 'File uploaded successfully');
            return token;

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
    // ЗАГРУЗКА ФАЙЛА С ПОВТОРАМИ ПРИ ОШИБКЕ attachment.not.ready
    // ============================================================
    /**
     * Загрузка файла с автоматическими повторами при ошибке attachment.not.ready
     */
    async uploadFileWithRetry(filePath, fileType = 'file', maxRetries = 5) {
        let lastError = null;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const token = await this.uploadFile(filePath, fileType);
                
                // Ждем обработки файла на сервере
                const waitTime = Math.min(attempt * 2000, 10000);
                console.log(`[MAX] Waiting ${waitTime}ms for file processing...`);
                await this.sleep(waitTime);
                
                return token;
            } catch (error) {
                lastError = error;
                console.log(`[MAX] Upload attempt ${attempt} failed: ${error.message}`);
                
                // Если ошибка не связана с обработкой файла, пробуем снова
                if (error.response?.data?.code === 'attachment.not.ready') {
                    console.log(`[MAX] File not ready, retrying in ${attempt * 2}s...`);
                    await this.sleep(attempt * 2000);
                    continue;
                }
                
                // Для других ошибок тоже пробуем повторить
                if (attempt < maxRetries) {
                    await this.sleep(attempt * 1000);
                    continue;
                }
            }
        }
        
        throw lastError || new Error('Failed to upload file after max retries');
    }

    async sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ============================================================
    // ОТПРАВКА ВИДЕО
    // ============================================================
    async sendVideo({ chatId, videoPath, caption = '', parseMode = 'markdown' }) {
        try {
            console.log(`[MAX] Uploading video for chat ${chatId}...`);
            const token = await this.uploadFileWithRetry(videoPath, 'video');

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
    // ОТПРАВКА ФАЙЛА
    // ============================================================
    async sendFile({ chatId, filePath, caption = '', parseMode = 'markdown' }) {
        try {
            console.log(`[MAX] Uploading file for chat ${chatId}...`);
            const token = await this.uploadFileWithRetry(filePath, 'file');

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
    // ОТПРАВКА ИЗОБРАЖЕНИЯ
    // ============================================================
    async sendImage({ chatId, imagePath, caption = '', parseMode = 'markdown' }) {
        try {
            console.log(`[MAX] Uploading image for chat ${chatId}...`);
            const token = await this.uploadFileWithRetry(imagePath, 'image');

            const attachment = {
                type: 'image',
                payload: { token: token }
            };

            console.log(`[MAX] Sending image message to ${chatId}...`);
            return await this.sendMessage({
                chatId,
                text: caption,
                parseMode,
                attachments: [attachment]
            });

        } catch (error) {
            console.error(`[MAX] ❌ Failed to send image to ${chatId}:`, error.message);
            logger.error({ err: error, chatId, imagePath }, 'Failed to send image');
            throw error;
        }
    }

    // ============================================================
    // ОТПРАВКА ПО ТОКЕНУ (БЕЗ ПОВТОРНОЙ ЗАГРУЗКИ)
    // ============================================================

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
    // ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ
    // ============================================================

    async validateToken(token) {
        try {
            // Пытаемся получить информацию о файле
            const response = await this.client.get(`/uploads/${token}`);
            return response.data && response.data.id;
        } catch (error) {
            return false;
        }
    }

    async getFileInfo(token) {
        try {
            const response = await this.client.get(`/uploads/${token}`);
            return response.data;
        } catch (error) {
            console.error('[MAX] Failed to get file info:', error.message);
            return null;
        }
    }

    async deleteFile(token) {
        try {
            const response = await this.client.delete(`/uploads/${token}`);
            return response.data;
        } catch (error) {
            console.error('[MAX] Failed to delete file:', error.message);
            throw error;
        }
    }

    async getBotStats() {
        try {
            const response = await this.client.get('/me/stats');
            return response.data;
        } catch (error) {
            console.error('[MAX] Failed to get bot stats:', error.message);
            return null;
        }
    }

    async sendTyping(chatId) {
        try {
            await this.client.post('/messages/typing', { chat_id: chatId });
        } catch (error) {
            console.error('[MAX] Failed to send typing:', error.message);
        }
    }

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
