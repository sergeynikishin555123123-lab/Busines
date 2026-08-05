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
            },
        });

        this.messageQueues = new Map();
        this.rateLimiter = new RateLimiter(config.rateLimit.messagesPerChatPerSecond, 1000);

        // Логирование запросов
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
                    console.error(`[MAX] Response error: ${error.response.status} ${error.config.url}`);
                    console.error('[MAX] Response data:', JSON.stringify(error.response.data, null, 2));
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

    // ИСПРАВЛЕННЫЙ МЕТОД ОТПРАВКИ СООБЩЕНИЙ
    async sendMessage({ chatId, text, parseMode = 'markdown', attachments = [] }) {
        return this.enqueueMessage(chatId, async () => {
            try {
                // ПРАВИЛЬНАЯ структура запроса к MAX API
                const requestData = {
                    text: text,
                    format: parseMode,
                };
                
                // Добавляем attachments только если они есть
                if (attachments && attachments.length > 0) {
                    requestData.attachments = attachments;
                }
                
                const response = await this.client.post('/messages', requestData, {
                    params: {
                        chat_id: chatId,  // chat_id в query-параметрах
                    }
                });
                
                console.log(`[MAX] Message sent to ${chatId}: ${text.substring(0, 50)}`);
                logger.info({ chatId, text: text.substring(0, 50) }, 'Message sent successfully');
                return response.data;
            } catch (error) {
                console.error(`[MAX] Failed to send message to ${chatId}:`, error.message);
                if (error.response) {
                    console.error('[MAX] Error response:', error.response.data);
                }
                logger.error({ err: error, chatId, text }, 'Failed to send message');
                throw error;
            }
        });
    }

    // ОТПРАВКА КЛАВИАТУРЫ (ИСПРАВЛЕНА)
    async sendKeyboard({ chatId, text, buttons, parseMode = 'markdown' }) {
        const attachment = {
            type: 'inline_keyboard',
            payload: {
                buttons: buttons
            }
        };
        return this.sendMessage({ chatId, text, parseMode, attachments: [attachment] });
    }

    // ОТПРАВКА ИЗОБРАЖЕНИЯ
    async sendImage({ chatId, imageToken, caption = '', parseMode = 'markdown' }) {
        const attachment = {
            type: 'image',
            payload: { token: imageToken }
        };
        return this.sendMessage({ chatId, text: caption, parseMode, attachments: [attachment] });
    }

    // ОТПРАВКА ВИДЕО
    async sendVideo({ chatId, videoToken, caption = '', parseMode = 'markdown' }) {
        const attachment = {
            type: 'video',
            payload: { token: videoToken }
        };
        return this.sendMessage({ chatId, text: caption, parseMode, attachments: [attachment] });
    }

    // ОТПРАВКА ФАЙЛА
    async sendFile({ chatId, fileToken, caption = '', parseMode = 'markdown' }) {
        const attachment = {
            type: 'file',
            payload: { token: fileToken }
        };
        return this.sendMessage({ chatId, text: caption, parseMode, attachments: [attachment] });
    }

    // ЗАГРУЗКА ФАЙЛА
    async uploadFile(filePath, fileType = 'file') {
        try {
            const formData = new FormData();
            formData.append('file', fs.createReadStream(filePath));
            formData.append('type', fileType);

            const response = await this.client.post('/uploads', formData, {
                headers: {
                    ...formData.getHeaders(),
                    'Authorization': config.max.token,
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
            });
            logger.info({ filePath, token: response.data.token }, 'File uploaded successfully');
            return response.data.token;
        } catch (error) {
            logger.error({ err: error, filePath }, 'Failed to upload file');
            throw error;
        }
    }

    // УПРАВЛЕНИЕ ВЕБХУКОМ
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

    // РЕГИСТРАЦИЯ КОМАНД
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
