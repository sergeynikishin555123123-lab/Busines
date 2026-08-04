// register-webhook.js
const config = require('./config');
const MaxAPI = require('./platforms/max');

async function registerWebhook() {
    try {
        const maxApi = new MaxAPI();
        const webhookUrl = `${config.server.publicUrl}/webhook/max`;
        
        console.log(`[REGISTER] Webhook URL: ${webhookUrl}`);
        console.log(`[REGISTER] MAX API URL: ${config.max.baseUrl}`);
        console.log(`[REGISTER] Bot Token: ${config.max.token ? '✅ Set' : '❌ Not set'}`);
        
        // Проверяем, что токен установлен
        if (!config.max.token) {
            console.error('[REGISTER] ❌ MAX_BOT_TOKEN is not set in .env!');
            console.log('[REGISTER] Please set MAX_BOT_TOKEN in .env file');
            process.exit(1);
        }

        // 1. Получаем информацию о боте
        console.log('[REGISTER] Getting bot info...');
        try {
            const botInfo = await maxApi.getMe();
            console.log('[REGISTER] ✅ Bot info:', JSON.stringify(botInfo, null, 2));
        } catch (error) {
            console.error('[REGISTER] ❌ Failed to get bot info:', error.message);
            if (error.response) {
                console.error('[REGISTER] Status:', error.response.status);
                console.error('[REGISTER] Data:', error.response.data);
            }
            throw error;
        }

        // 2. Проверяем текущие подписки
        console.log('[REGISTER] Checking current subscriptions...');
        try {
            const current = await maxApi.getWebhookInfo();
            console.log('[REGISTER] Current subscriptions:', JSON.stringify(current, null, 2));
            
            // Если есть подписки, удаляем их
            if (current && current.length > 0) {
                console.log('[REGISTER] Deleting existing subscriptions...');
                await maxApi.deleteWebhook();
                console.log('[REGISTER] ✅ Deleted existing subscriptions');
            }
        } catch (error) {
            if (error.response && error.response.status === 404) {
                console.log('[REGISTER] ℹ️ No existing subscriptions (404)');
            } else {
                console.log('[REGISTER] ℹ️ No existing subscriptions or error checking');
            }
        }
        
        // 3. Регистрируем новую подписку
        console.log('[REGISTER] Registering webhook...');
        console.log(`[REGISTER] Webhook URL: ${webhookUrl}`);
        console.log(`[REGISTER] Secret: ${config.max.webhookSecret ? '✅ Set' : '❌ Not set'}`);
        
        const result = await maxApi.registerWebhook(webhookUrl);
        console.log('[REGISTER] ✅ Webhook registered successfully!');
        console.log('[REGISTER] Result:', JSON.stringify(result, null, 2));
        
        // 4. Регистрируем команды
        console.log('[REGISTER] Registering commands...');
        try {
            await maxApi.registerCommands([
                { name: 'start', description: 'Начать работу с ботом' },
                { name: 'help', description: 'Показать справку' },
                { name: 'courses', description: 'Показать список курсов' },
            ]);
            console.log('[REGISTER] ✅ Commands registered!');
        } catch (error) {
            console.warn('[REGISTER] ⚠️ Could not register commands:', error.message);
        }
        
        console.log('[REGISTER] 🎉 All done!');
        console.log(`[REGISTER] Webhook set to: ${webhookUrl}`);
        
        console.log('\n[REGISTER] To test your bot:');
        console.log('[REGISTER] 1. Open MAX messenger');
        console.log('[REGISTER] 2. Find your bot by username');
        console.log('[REGISTER] 3. Send /start command');
        console.log('\n[REGISTER] Or test webhook:');
        console.log(`curl -X POST ${webhookUrl} \\`);
        console.log(`  -H "X-Max-Bot-Api-Secret: ${config.max.webhookSecret}" \\`);
        console.log(`  -d '{"update_type":"bot_started","chat_id":123,"user":{"user_id":456}}'`);

    } catch (error) {
        console.error('[REGISTER] ❌ Error:', error.message);
        if (error.response) {
            console.error('[REGISTER] Response status:', error.response.status);
            console.error('[REGISTER] Response data:', error.response.data);
        }
        console.error('[REGISTER] Stack:', error.stack);
        process.exit(1);
    }
}

registerWebhook();
