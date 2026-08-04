// register-webhook.js
const config = require('./config');
const MaxAPI = require('./platforms/max');

async function registerWebhook() {
    try {
        const maxApi = new MaxAPI();
        const webhookUrl = `${config.server.publicUrl}/webhook/max`;
        
        console.log(`[REGISTER] Registering webhook at: ${webhookUrl}`);
        
        // Проверяем текущие подписки
        console.log('[REGISTER] Getting current subscriptions...');
        const current = await maxApi.getWebhookInfo();
        console.log('[REGISTER] Current subscriptions:', JSON.stringify(current, null, 2));
        
        // Если есть подписки, удаляем их
        if (current && current.length > 0) {
            console.log('[REGISTER] Deleting existing subscriptions...');
            await maxApi.deleteWebhook();
        }
        
        // Регистрируем новую подписку
        console.log('[REGISTER] Registering new webhook...');
        const result = await maxApi.registerWebhook(webhookUrl);
        console.log('[REGISTER] Webhook registered successfully!');
        console.log('[REGISTER] Result:', JSON.stringify(result, null, 2));
        
        // Проверяем информацию о боте
        console.log('[REGISTER] Getting bot info...');
        const botInfo = await maxApi.getMe();
        console.log('[REGISTER] Bot info:', JSON.stringify(botInfo, null, 2));
        
        // Регистрируем команды
        console.log('[REGISTER] Registering commands...');
        await maxApi.registerCommands([
            { name: 'start', description: 'Начать работу с ботом' },
            { name: 'help', description: 'Показать справку' },
            { name: 'courses', description: 'Показать список курсов' },
        ]);
        console.log('[REGISTER] Commands registered!');
        
        console.log('[REGISTER] ✅ All done!');
    } catch (error) {
        console.error('[REGISTER] Error:', error.message);
        if (error.response) {
            console.error('[REGISTER] Response data:', error.response.data);
            console.error('[REGISTER] Response status:', error.response.status);
        }
        process.exit(1);
    }
}

registerWebhook();
