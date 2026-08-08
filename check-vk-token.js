const axios = require('axios');
const config = require('./config');

async function checkToken() {
    try {
        const response = await axios.get('https://api.vk.com/method/groups.getById', {
            params: {
                access_token: config.vk.groupToken,
                v: '5.131'
            }
        });
        
        console.log('✅ Токен работает! Группа:', response.data.response?.[0]?.name);
        console.log('📋 Полный ответ:', JSON.stringify(response.data, null, 2));
        
        // Проверяем права
        const permissions = await axios.get('https://api.vk.com/method/account.getAppPermissions', {
            params: {
                access_token: config.vk.groupToken,
                v: '5.131'
            }
        });
        
        console.log('\n🔑 Права токена:', JSON.stringify(permissions.data, null, 2));
        
    } catch (error) {
        console.error('❌ Ошибка:', error.response?.data || error.message);
    }
}

checkToken();
