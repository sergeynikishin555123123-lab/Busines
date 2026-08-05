// platforms/max.js
// КЛИЕНТ MAX API - ПОЛНАЯ РАБОЧАЯ ВЕРСИЯ

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
            baseURL: config.max.baseUrl || 'https://platform-api2.max.ru',
            timeout: 600000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
            headers: {
                'Authorization': config.max.token,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
        });

        this.uploadClient = axios.create({
            timeout: 600000,
            maxContentLength: Infinity,
            maxBodyLength: Infinity,
        });

        this.messageQueues = new Map();
        this.rateLimiter = new RateLimiter(30, 1000);

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
        const key = String(chatId);
        if (!this.messageQueues.has(key)) {
            this.messageQueues.set(key, []);
        }

        const queue = this.messageQueues.get(key);
        queue.push(sendFunction);

        if (queue.length === 1) {
            await this.processQueue(key);
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
        const numericChatId = Number(chatId);
        
        return this.enqueueMessage(numericChatId, async () => {
            try {
                const requestData = {
                    chat_id: numericChatId,
                    text: text,
                    format: parseMode,
                };

                if (attachments && attachments.length > 0) {
                    requestData.attachments = attachments;
                }

                console.log(`[MAX] Sending message to chat_id: ${numericChatId}`);

                const response = await this.client.post('/messages', requestData);

                console.log(`[MAX] ✅ Message sent to ${numericChatId}: ${text.substring(0, 50)}`);
                logger.info({ chatId, text: text.substring(0, 50) }, 'Message sent successfully');
                return response.data;

            } catch (error) {
                console.error(`[MAX] ❌ Failed to send message to ${numericChatId}:`, error.message);
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
    // ЗАГРУЗКА ФАЙЛА В MAX (ПО ДОКУМЕНТАЦИИ)
    // ============================================================
    async uploadFile(filePath, fileType = 'file') {
        try {
            console.log(`[MAX] Uploading file: ${filePath}, type: ${fileType}`);

            if (!fs.existsSync(filePath)) {
                throw new Error(`File not found: ${filePath}`);
            }

            const fileStats = fs.statSync(filePath);
            console.log(`[MAX] File size: ${fileStats.size} bytes`);

            // ШАГ 1: Получаем URL для загрузки
            console.log(`[MAX] Step 1: Getting upload URL for type: ${fileType}`);
            const uploadResponse = await this.client.post(`/uploads?type=${fileType}`);
            
            const uploadUrl = uploadResponse.data.url;
            console.log(`[MAX] Got upload URL: ${uploadUrl}`);

            // ШАГ 2: Загружаем файл по полученному URL
            console.log(`[MAX] Step 2: Uploading file to: ${uploadUrl}`);
            
            const formData = new FormData();
            formData.append('data', fs.createReadStream(filePath));

            const uploadResult = await this.uploadClient.post(uploadUrl, formData, {
                headers: {
                    ...formData.getHeaders(),
                    'Authorization': config.max.token,
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
            });

            // ШАГ 3: Получаем токен
            const token = uploadResult.data.token;
            
            if (!token) {
                throw new Error('No token received from upload');
            }

            console.log(`[MAX] ✅ File uploaded successfully, token: ${token.substring(0, 20)}...`);
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
    // ЗАГРУЗКА С ПОВТОРАМИ
    // ============================================================
    async uploadFileWithRetry(filePath, fileType = 'file', maxRetries = 5) {
        let lastError = null;
        let waitTime = 2000;
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                const token = await this.uploadFile(filePath, fileType);
                
                console.log(`[MAX] Waiting ${waitTime}ms for file processing...`);
                await this.sleep(waitTime);
                
                return token;
            } catch (error) {
                lastError = error;
                console.log(`[MAX] Upload attempt ${attempt}/${maxRetries} failed: ${error.message}`);
                
                if (error.response?.data?.code === 'attachment.not.ready') {
                    console.log(`[MAX] File not ready, waiting ${waitTime}ms...`);
                    await this.sleep(waitTime);
                    waitTime = Math.min(waitTime * 1.5, 10000);
                    continue;
                }
                
                if (attempt < maxRetries) {
                    console.log(`[MAX] Retrying in ${waitTime}ms...`);
                    await this.sleep(waitTime);
                    waitTime = Math.min(waitTime * 1.5, 10000);
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
            console.log(`[MAX] Sending video to chat ${chatId}...`);
            const token = await this.uploadFileWithRetry(videoPath, 'video');

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
            console.log(`[MAX] Sending file to chat ${chatId}...`);
            const token = await this.uploadFileWithRetry(filePath, 'file');

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
            console.log(`[MAX] Sending image to chat ${chatId}...`);
            const token = await this.uploadFileWithRetry(imagePath, 'image');

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
            console.error(`[MAX] ❌ Failed to send image to ${chatId}:`, error.message);
            logger.error({ err: error, chatId, imagePath }, 'Failed to send image');
            throw error;
        }
    }

    // ============================================================
    // ОТПРАВКА ПО ТОКЕНУ
    // ============================================================
    async sendVideoByToken({ chatId, token, caption = '', parseMode = 'markdown' }) {
        const attachment = {
            type: 'video',
            payload: { token: token }
        };
        return this.sendMessage({ chatId, text: caption, parseMode, attachments: [attachment] });
    }

    async sendFileByToken({ chatId, token, caption = '', parseMode = 'markdown' }) {
        const attachment = {
            type: 'file',
            payload: { token: token }
        };
        return this.sendMessage({ chatId, text: caption, parseMode, attachments: [attachment] });
    }

    async sendImageByToken({ chatId, token, caption = '', parseMode = 'markdown' }) {
        const attachment = {
            type: 'image',
            payload: { token: token }
        };
        return this.sendMessage({ chatId, text: caption, parseMode, attachments: [attachment] });
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
}

module.exports = MaxAPI;
