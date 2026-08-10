// register-webhook.js
const config = require('./config');
const MaxAPI = require('./platforms/max');

async function registerWebhook() {
    try {
        const maxApi = new MaxAPI();
        const webhookUrl = `${config.server.publicUrl}/webhook/max`;
        
        console.log(`[REGISTER] Webhook URL: ${webhookUrl}`);
        console.log(`[REGISTER] Using secret: ${config.max.webhookSecret}`);
        
        // Удаляем старые подписки
        try {
            const current = await maxApi.getWebhookInfo();
            if (current && current.subscriptions) {
                for (const sub of current.subscriptions) {
                    await maxApi.deleteWebhook(sub.url);
                }
            }
        } catch (e) {
            console.log('[REGISTER] No existing subscriptions to delete');
        }
        
        // Регистрируем с секретом
        const result = await maxApi.registerWebhook(
            webhookUrl,
            config.max.webhookSecret
        );
        
        console.log('[REGISTER] ✅ Webhook registered!');
        console.log('[REGISTER] Result:', JSON.stringify(result, null, 2));
        
        // Проверяем, что секрет сохранен
        const info = await maxApi.getWebhookInfo();
        console.log('[REGISTER] Current subscriptions:', JSON.stringify(info, null, 2));
        
    } catch (error) {
        console.error('[REGISTER] ❌ Error:', error.message);
        if (error.response) {
            console.error('[REGISTER] Response:', error.response.data);
        }
    }
}

registerWebhook();
