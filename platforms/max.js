const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const config = require('../config');
const logger = require('../logger');
const { RateLimiter } = require('../core/queue');

class MaxAPI {
    constructor() {
        console.log('[MAX] Initializing API client...');
        console.log(`[MAX] Base URL: ${config.max.baseUrl}`);
        console.log(`[MAX] Token: ${config.max.token ? '✅ Set' : '❌ Not set'}`);
        
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

        // Добавляем логирование запросов
        this.client.interceptors.request.use(
            (config) => {
                console.log(`[MAX] Request: ${config.method.toUpperCase()} ${config.baseURL}${config.url}`);
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
                return response;
            },
            (error) => {
                if (error.response) {
                    console.error(`[MAX] Response error: ${error.response.status} ${error.config.url}`);
                    console.error('[MAX] Response data:', error.response.data);
                } else {
                    console.error('[MAX] Network error:', error.message);
                }
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

    async sendMessage({ chatId, text, parseMode = 'markdown', attachments = [] }) {
        return this.enqueueMessage(chatId, async () => {
            try {
                const response = await this.client.post('/messages', {
                    text: text,
                    format: parseMode,
                    attachments: attachments,
                }, {
                    params: {
                        chat_id: chatId,
                    }
                });
                logger.info({ chatId, text: text.substring(0, 50) }, 'Message sent successfully');
                return response.data;
            } catch (error) {
                logger.error({ err: error, chatId, text }, 'Failed to send message');
                throw error;
            }
        });
    }

    async sendKeyboard({ chatId, text, buttons, parseMode = 'markdown' }) {
        const attachment = {
            type: 'inline_keyboard',
            payload: {
                buttons: buttons,
            }
        };
        return this.sendMessage({ chatId, text, parseMode, attachments: [attachment] });
    }

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

    async sendFile({ chatId, fileToken, caption = '', parseMode = 'markdown' }) {
        const attachment = {
            type: 'file',
            payload: {
                token: fileToken,
            }
        };
        return this.sendMessage({ chatId, text: caption, parseMode, attachments: [attachment] });
    }

    async sendImage({ chatId, imageToken, caption = '', parseMode = 'markdown' }) {
        const attachment = {
            type: 'image',
            payload: {
                token: imageToken,
            }
        };
        return this.sendMessage({ chatId, text: caption, parseMode, attachments: [attachment] });
    }

    async sendVideo({ chatId, videoToken, caption = '', parseMode = 'markdown' }) {
        const attachment = {
            type: 'video',
            payload: {
                token: videoToken,
            }
        };
        return this.sendMessage({ chatId, text: caption, parseMode, attachments: [attachment] });
    }

    async sendAudio({ chatId, audioToken, caption = '', parseMode = 'markdown' }) {
        const attachment = {
            type: 'audio',
            payload: {
                token: audioToken,
            }
        };
        return this.sendMessage({ chatId, text: caption, parseMode, attachments: [attachment] });
    }

    async registerWebhook(webhookUrl, secret = '') {
        try {
            console.log(`[MAX] Registering webhook at ${webhookUrl}`);
            const payload = {
                url: webhookUrl,
                update_types: ['message_created', 'bot_started', 'message_callback', 'bot_added', 'bot_removed'],
            };
            
            if (secret) {
                payload.secret = secret;
            }
            
            const response = await this.client.post('/subscriptions', payload);
            console.log('[MAX] Webhook registered successfully');
            return response.data;
        } catch (error) {
            console.error('[MAX] Failed to register webhook:', error.message);
            if (error.response) {
                console.error('[MAX] Status:', error.response.status);
                console.error('[MAX] Data:', error.response.data);
            }
            throw error;
        }
    }

    async getWebhookInfo() {
        try {
            console.log('[MAX] Getting webhook info...');
            const response = await this.client.get('/subscriptions');
            console.log('[MAX] Webhook info retrieved');
            return response.data;
        } catch (error) {
            console.error('[MAX] Failed to get webhook info:', error.message);
            if (error.response) {
                console.error('[MAX] Status:', error.response.status);
                console.error('[MAX] Data:', error.response.data);
            }
            throw error;
        }
    }

    async deleteWebhook() {
        try {
            console.log('[MAX] Deleting webhook...');
            const response = await this.client.delete('/subscriptions');
            console.log('[MAX] Webhook deleted successfully');
            return response.data;
        } catch (error) {
            console.error('[MAX] Failed to delete webhook:', error.message);
            if (error.response) {
                console.error('[MAX] Status:', error.response.status);
                console.error('[MAX] Data:', error.response.data);
            }
            throw error;
        }
    }

    async registerCommands(commands) {
        try {
            console.log('[MAX] Registering commands...');
            const response = await this.client.patch('/me/commands', {
                commands: commands,
            });
            console.log('[MAX] Commands registered');
            return response.data;
        } catch (error) {
            console.error('[MAX] Failed to register commands:', error.message);
            if (error.response) {
                console.error('[MAX] Status:', error.response.status);
                console.error('[MAX] Data:', error.response.data);
            }
            throw error;
        }
    }

    async getMe() {
        try {
            console.log('[MAX] Getting bot info...');
            const response = await this.client.get('/me');
            return response.data;
        } catch (error) {
            console.error('[MAX] Failed to get bot info:', error.message);
            if (error.response) {
                console.error('[MAX] Status:', error.response.status);
                console.error('[MAX] Data:', error.response.data);
            }
            throw error;
        }
    }
}

module.exports = MaxAPI;
