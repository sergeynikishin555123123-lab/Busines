// platforms/max.js - ДОБАВЬТЕ ЕСЛИ НЕТ

class MaxAPI {
    // ... существующий код ...

    async sendVideoByToken({ chatId, token, caption, parseMode = 'markdown' }) {
        try {
            const url = `${this.baseUrl}/messages`;
            
            const payload = {
                chat_id: chatId,
                attachments: [
                    {
                        type: 'video',
                        payload: {
                            token: token,
                        }
                    }
                ],
                format: parseMode,
            };
            
            if (caption) {
                payload.text = caption;
            }
            
            const response = await axios.post(url, payload, {
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json',
                },
            });
            
            return response.data;
        } catch (error) {
            console.error('[MAX] Error sending video by token:', error.message);
            throw error;
        }
    }

    async sendFileByToken({ chatId, token, caption, parseMode = 'markdown' }) {
        try {
            const url = `${this.baseUrl}/messages`;
            
            const payload = {
                chat_id: chatId,
                attachments: [
                    {
                        type: 'file',
                        payload: {
                            token: token,
                        }
                    }
                ],
                format: parseMode,
            };
            
            if (caption) {
                payload.text = caption;
            }
            
            const response = await axios.post(url, payload, {
                headers: {
                    'Authorization': `Bearer ${this.token}`,
                    'Content-Type': 'application/json',
                },
            });
            
            return response.data;
        } catch (error) {
            console.error('[MAX] Error sending file by token:', error.message);
            throw error;
        }
    }
}
