// platforms/vk.js
// ПОЛНАЯ ИНТЕГРАЦИЯ VK

const crypto = require('crypto');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const config = require('../config');
const dispatcher = require('../core/dispatcher');
const logger = require('../logger');

class VKAPI {
    constructor() {
        this.token = config.vk.token;
        this.apiVersion = config.vk.apiVersion || '5.131';
        this.baseUrl = 'https://api.vk.com/method';
        this.confirmationToken = config.vk.confirmationToken;

        this.client = axios.create({
            baseURL: this.baseUrl,
            timeout: 30000,
        });

        // Логирование запросов
        this.client.interceptors.request.use(
            (config) => {
                logger.debug(`VK Request: ${config.method.toUpperCase()} ${config.url}`);
                return config;
            },
            (error) => Promise.reject(error)
        );

        this.client.interceptors.response.use(
            (response) => {
                if (response.data && response.data.error) {
                    logger.error('VK API Error:', response.data.error);
                }
                return response;
            },
            (error) => {
                logger.error('VK API Request failed:', error.message);
                return Promise.reject(error);
            }
        );
    }

    // ОТПРАВКА СООБЩЕНИЯ
    async sendMessage({ userId, text, parseMode = 'html' }) {
        try {
            const response = await this.client.post('/messages.send', null, {
                params: {
                    user_id: userId,
                    message: text,
                    random_id: Math.floor(Math.random() * 2147483647),
                    access_token: this.token,
                    v: this.apiVersion,
                },
            });

            if (response.data.error) {
                throw new Error(`VK API Error: ${response.data.error.error_msg}`);
            }

            logger.info({ userId, text: text.substring(0, 50) }, 'VK message sent');
            return response.data;
        } catch (error) {
            logger.error({ err: error, userId }, 'Failed to send VK message');
            throw error;
        }
    }

    // ОТПРАВКА КЛАВИАТУРЫ
    async sendKeyboard({ userId, text, buttons, parseMode = 'html' }) {
        try {
            const keyboard = {
                one_time: false,
                buttons: buttons.map(row =>
                    row.map(btn => ({
                        action: {
                            type: 'text',
                            label: btn.text,
                            payload: JSON.stringify({ payload: btn.payload || '' }),
                        },
                        color: btn.color || 'primary',
                    }))
                ),
            };

            const response = await this.client.post('/messages.send', null, {
                params: {
                    user_id: userId,
                    message: text,
                    keyboard: JSON.stringify(keyboard),
                    random_id: Math.floor(Math.random() * 2147483647),
                    access_token: this.token,
                    v: this.apiVersion,
                },
            });

            if (response.data.error) {
                throw new Error(`VK API Error: ${response.data.error.error_msg}`);
            }

            logger.info({ userId }, 'VK keyboard sent');
            return response.data;
        } catch (error) {
            logger.error({ err: error, userId }, 'Failed to send VK keyboard');
            throw error;
        }
    }

    // ОТПРАВКА ФАЙЛА (через загрузку на сервер VK)
    async sendFile({ userId, filePath, caption = '' }) {
        try {
            // 1. Загружаем файл на сервер VK
            const uploadUrl = await this.getUploadUrl('doc');

            const formData = new FormData();
            formData.append('file', fs.createReadStream(filePath));

            const uploadResponse = await axios.post(uploadUrl, formData, {
                headers: {
                    ...formData.getHeaders(),
                },
            });

            // 2. Сохраняем документ
            const doc = await this.saveDocument(uploadResponse.data);

            // 3. Отправляем сообщение с документом
            const response = await this.client.post('/messages.send', null, {
                params: {
                    user_id: userId,
                    message: caption,
                    attachment: `doc${doc.owner_id}_${doc.id}`,
                    random_id: Math.floor(Math.random() * 2147483647),
                    access_token: this.token,
                    v: this.apiVersion,
                },
            });

            if (response.data.error) {
                throw new Error(`VK API Error: ${response.data.error.error_msg}`);
            }

            logger.info({ userId, docId: doc.id }, 'VK file sent');
            return response.data;
        } catch (error) {
            logger.error({ err: error, userId }, 'Failed to send VK file');
            // Fallback: отправляем ссылку
            return this.sendMessage({
                userId,
                text: `📎 Файл: ${caption || 'Вложение'}\nСсылка: ${filePath}`,
            });
        }
    }

    // ОТПРАВКА ВИДЕО
    async sendVideo({ userId, videoUrl, caption = '' }) {
        try {
            // Для VK нужно сначала загрузить видео
            // Если это ссылка, пробуем загрузить
            const videoData = await this.uploadVideo(videoUrl);

            const response = await this.client.post('/messages.send', null, {
                params: {
                    user_id: userId,
                    message: caption,
                    attachment: `video${videoData.owner_id}_${videoData.id}`,
                    random_id: Math.floor(Math.random() * 2147483647),
                    access_token: this.token,
                    v: this.apiVersion,
                },
            });

            if (response.data.error) {
                throw new Error(`VK API Error: ${response.data.error.error_msg}`);
            }

            logger.info({ userId, videoId: videoData.id }, 'VK video sent');
            return response.data;
        } catch (error) {
            logger.error({ err: error, userId }, 'Failed to send VK video');
            // Fallback: отправляем ссылку
            return this.sendMessage({
                userId,
                text: `🎬 Видео: ${caption || 'Видео'}\n${videoUrl}`,
            });
        }
    }

    // ВСПОМОГАТЕЛЬНЫЕ МЕТОДЫ ДЛЯ РАБОТЫ С ФАЙЛАМИ

    async getUploadUrl(type = 'doc') {
        const method = type === 'doc' ? '/docs.getUploadServer' : '/photos.getUploadServer';
        const response = await this.client.post(method, null, {
            params: {
                access_token: this.token,
                v: this.apiVersion,
            },
        });

        if (response.data.error) {
            throw new Error(`VK API Error: ${response.data.error.error_msg}`);
        }

        return response.data.response.upload_url;
    }

    async saveDocument(uploadData) {
        const response = await this.client.post('/docs.save', null, {
            params: {
                file: uploadData.file,
                access_token: this.token,
                v: this.apiVersion,
            },
        });

        if (response.data.error) {
            throw new Error(`VK API Error: ${response.data.error.error_msg}`);
        }

        return response.data.response.doc;
    }

    async uploadVideo(videoUrl) {
        // Получаем сервер для загрузки видео
        const response = await this.client.post('/video.save', null, {
            params: {
                link: videoUrl,
                access_token: this.token,
                v: this.apiVersion,
            },
        });

        if (response.data.error) {
            throw new Error(`VK API Error: ${response.data.error.error_msg}`);
        }

        return response.data.response;
    }

    // ПОЛУЧЕНИЕ ИНФОРМАЦИИ О ПОЛЬЗОВАТЕЛЕ
    async getUserInfo(userId) {
        try {
            const response = await this.client.post('/users.get', null, {
                params: {
                    user_ids: userId,
                    access_token: this.token,
                    v: this.apiVersion,
                },
            });

            if (response.data.error) {
                throw new Error(`VK API Error: ${response.data.error.error_msg}`);
            }

            const user = response.data.response[0];
            return {
                id: user.id,
                firstName: user.first_name,
                lastName: user.last_name,
                username: user.screen_name || '',
                photo: user.photo_50 || '',
            };
        } catch (error) {
            logger.error({ err: error, userId }, 'Failed to get VK user info');
            return null;
        }
    }
}

// ============================================================
// ВЕБХУК ОБРАБОТЧИК
// ============================================================

async function webhookHandler(req, res) {
    try {
        const { type, secret, object, group_id } = req.body;

        logger.info({ type, group_id }, 'VK webhook received');

        // Проверка секрета
        if (config.vk.secret && secret !== config.vk.secret) {
            logger.warn('Invalid VK webhook secret');
            return res.status(403).send('Invalid secret');
        }

        // Обработка различных типов событий
        switch (type) {
            case 'confirmation':
                logger.info('VK confirmation request');
                return res.send(config.vk.confirmationToken || 'test');

            case 'message_new':
                res.send('ok');
                await handleMessageNew(object.message);
                return;

            case 'message_event':
                res.send('ok');
                await handleMessageEvent(object);
                return;

            case 'message_reply':
                res.send('ok');
                await handleMessageNew(object.message);
                return;

            default:
                logger.info(`Unhandled VK event type: ${type}`);
                return res.send('ok');
        }
    } catch (error) {
        logger.error('VK webhook error:', error);
        return res.send('ok');
    }
}

async function handleMessageNew(message) {
    try {
        const userId = message.from_id.toString();
        const text = message.text || '';
        let payload = null;

        // Парсим payload из кнопок
        if (message.payload) {
            try {
                const parsed = JSON.parse(message.payload);
                payload = parsed.payload || null;
            } catch (e) {
                // Игнорируем
            }
        }

        // Получаем информацию о пользователе
        const vkApi = new VKAPI();
        const userInfo = await vkApi.getUserInfo(userId);

        // Нормализуем сообщение
        const normalizedMessage = {
            platform: 'vk',
            userId: userId,
            firstName: userInfo?.firstName || '',
            lastName: userInfo?.lastName || '',
            username: userInfo?.username || '',
            message: text,
            payload: payload,
            attachments: message.attachments || [],
            from: message.from_id,
        };

        // Отправляем в диспетчер
        await dispatcher.handleMessage(
            'vk',
            userId,
            text,
            payload
        );

        logger.info({ userId, text: text.substring(0, 50) }, 'VK message processed');

    } catch (error) {
        logger.error({ err: error, message }, 'Error handling VK message');
    }
}

async function handleMessageEvent(event) {
    try {
        const userId = event.user_id.toString();
        let payload = null;

        if (event.payload) {
            try {
                const parsed = typeof event.payload === 'string'
                    ? JSON.parse(event.payload)
                    : event.payload;
                payload = parsed.payload || null;
            } catch (e) {
                // Игнорируем
            }
        }

        // Отправляем в диспетчер
        await dispatcher.handleMessage(
            'vk',
            userId,
            '',
            payload
        );

        logger.info({ userId, payload }, 'VK event processed');

    } catch (error) {
        logger.error({ err: error, event }, 'Error handling VK event');
    }
}

// ОТПРАВКА СООБЩЕНИЙ ЧЕРЕЗ VK (для использования из других частей системы)
async function sendVkMessage(userId, text, parseMode = 'html') {
    const vkApi = new VKAPI();
    return vkApi.sendMessage({ userId, text, parseMode });
}

async function sendVkKeyboard(userId, text, buttons, parseMode = 'html') {
    const vkApi = new VKAPI();
    return vkApi.sendKeyboard({ userId, text, buttons, parseMode });
}

module.exports = {
    VKAPI,
    webhookHandler,
    sendVkMessage,
    sendVkKeyboard,
};
