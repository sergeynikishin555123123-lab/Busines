// platforms/max.js - ИСПРАВЛЕННАЯ ВЕРСИЯ
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const config = require('../config');
const logger = require('../logger');
const { RateLimiter } = require('../core/queue');

class MaxAPI {
    constructor() {
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

        // Логирование запросов (для отладки)
        this.client.interceptors.request.use(
            (config) => {
                console.log(`[MAX] Request: ${config.method.toUpperCase()} ${config.baseURL}${config.url}`);
                if (config.data) console.log('[MAX] Request data:', JSON.stringify(config.data, null, 2));
                return config;
            },
            (error) => Promise.reject(error)
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
                return Promise.reject(error);
            }
        );
    }

    // Очередь для избежания rate limit
    async enqueueMessage(chatId, sendFunction) {
        if (!this.messageQueues.has(chatId)) this.messageQueues.set(chatId, []);
        const queue = this.messageQueues.get(chatId);
        queue.push(sendFunction);
        if (queue.length === 1) await this.processQueue(chatId);
    }

    async processQueue(chatId) {
        const queue = this.messageQueues.get(chatId);
        if (!queue || queue.length === 0) return;
        try {
            const sendFunction = queue[0];
            await this.rateLimiter.wait();
            await sendFunction();
            queue.shift();
            if (queue.length > 0) setImmediate(() => this.processQueue(chatId));
        } catch (error) {
            logger.error({ err: error, chatId }, 'Error processing message queue');
            queue.shift();
            if (queue.length > 0) setImmediate(() => this.processQueue(chatId));
        }
    }

    // БАЗОВАЯ ОТПРАВКА СООБЩЕНИЯ
    async sendMessage({ chatId, text, parseMode = 'markdown', attachments = [] }) {
        return this.enqueueMessage(chatId, async () => {
            try {
                const requestData = { chat_id: chatId, text: text, format: parseMode };
                if (attachments && attachments.length > 0) requestData.attachments = attachments;
                const response = await this.client.post('/messages', requestData);
                logger.info({ chatId, text: text.substring(0, 50) }, 'Message sent successfully');
                return response.data;
            } catch (error) {
                console.error(`[MAX] ❌ Failed to send message to ${chatId}:`, error.message);
                if (error.response) console.error('[MAX] Error response:', error.response.data);
                logger.error({ err: error, chatId, text }, 'Failed to send message');
                throw error;
            }
        });
    }

    // ОТПРАВКА КНОПОК (Inline Keyboard)
    async sendKeyboard({ chatId, text, buttons, parseMode = 'markdown' }) {
        const attachment = { type: 'inline_keyboard', payload: { buttons: buttons } };
        return this.sendMessage({ chatId, text, parseMode, attachments: [attachment] });
    }

    // ============================================================
    // === НОВЫЙ МЕТОД ЗАГРУЗКИ ПО ДОКУМЕНТАЦИИ MAX ===
    // ============================================================
    async uploadFile(filePath, fileType = 'file') {
        try {
            console.log(`[MAX] Uploading file: ${filePath}, type: ${fileType}`);
            if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);

            // 1. Получаем URL для загрузки (ПЕРЕДАЕМ TYPE В URL)
            console.log(`[MAX] Step 1: Getting upload URL for type: ${fileType}`);
            const uploadResponse = await this.client.post(`/uploads?type=${fileType}`); // <-- ИСПРАВЛЕНО
            const uploadUrl = uploadResponse.data.url;
            console.log(`[MAX] Got upload URL: ${uploadUrl}`);

            // 2. Загружаем файл по полученному URL
            console.log(`[MAX] Step 2: Uploading file to: ${uploadUrl}`);
            const formData = new FormData();
            formData.append('data', fs.createReadStream(filePath)); // Поле 'data' согласно документации

            const uploadResult = await axios.post(uploadUrl, formData, {
                headers: {
                    ...formData.getHeaders(),
                    'Authorization': config.max.token, // Токен нужен и тут
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
                timeout: 600000, // 10 минут на загрузку
            });

            // 3. Получаем токен
            const token = uploadResult.data.token;
            if (!token) throw new Error('No token received from upload');
            console.log(`[MAX] ✅ File uploaded, token: ${token.substring(0, 20)}...`);
            logger.info({ filePath, token: token, type: fileType }, 'File uploaded successfully');
            return token;
        } catch (error) {
            console.error(`[MAX] ❌ Failed to upload file: ${filePath}`, error.message);
            if (error.response) console.error('[MAX] Response status:', error.response.status);
            logger.error({ err: error, filePath }, 'Failed to upload file to MAX');
            throw error;
        }
    }

    // Отправка видео по токену (без повторной загрузки)
    async sendVideoByToken({ chatId, token, caption = '', parseMode = 'markdown' }) {
        try {
            const attachment = { type: 'video', payload: { token: token } };
            return await this.sendMessage({ chatId, text: caption, parseMode, attachments: [attachment] });
        } catch (error) {
            console.error(`[MAX] ❌ Failed to send video by token to ${chatId}:`, error.message);
            throw error;
        }
    }

    // Отправка файла по токену
    async sendFileByToken({ chatId, token, caption = '', parseMode = 'markdown' }) {
        try {
            const attachment = { type: 'file', payload: { token: token } };
            return await this.sendMessage({ chatId, text: caption, parseMode, attachments: [attachment] });
        } catch (error) {
            console.error(`[MAX] ❌ Failed to send file by token to ${chatId}:`, error.message);
            throw error;
        }
    }

    // Вспомогательные методы
    async sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

    async registerWebhook(webhookUrl, secret = '') {
        const payload = { url: webhookUrl, update_types: ['message_created', 'bot_started', 'message_callback', 'bot_added', 'bot_removed'] };
        if (secret) payload.secret = secret;
        const response = await this.client.post('/subscriptions', payload);
        return response.data;
    }

    async getWebhookInfo() {
        const response = await this.client.get('/subscriptions');
        return response.data;
    }

    async deleteWebhook(url) {
        const response = await this.client.delete('/subscriptions', { params: { url: url } });
        return response.data;
    }

    async registerCommands(commands) {
        const response = await this.client.patch('/me/commands', { commands });
        return response.data;
    }

    async getMe() {
        const response = await this.client.get('/me');
        return response.data;
    }
}

module.exports = MaxAPI;
