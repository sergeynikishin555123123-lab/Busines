const axios = require('axios');
const config = require('./config');

async function checkScopes() {
    try {
        // Проверяем права через метод groups.getById с полями
        const response = await axios.get('https://api.vk.com/method/groups.getById', {
            params: {
                group_id: 240657037,
                fields: 'can_post,can_see_all_posts,can_upload_doc,can_upload_video,can_upload_photo',
                access_token: config.vk.groupToken,
                v: '5.131'
            }
        });
        
        console.log('📋 Права группы:');
        const group = response.data.response?.[0];
        if (group) {
            console.log(`  - Может постить: ${group.can_post ? '✅' : '❌'}`);
            console.log(`  - Может загружать документы: ${group.can_upload_doc ? '✅' : '❌'}`);
            console.log(`  - Может загружать видео: ${group.can_upload_video ? '✅' : '❌'}`);
            console.log(`  - Может загружать фото: ${group.can_upload_photo ? '✅' : '❌'}`);
        }
        
        // Проверяем возможность загрузки видео (простой тест)
        console.log('\n🔍 Тест загрузки видео (получение сервера)...');
        const videoTest = await axios.get('https://api.vk.com/method/video.save', {
            params: {
                group_id: 240657037,
                name: 'test',
                description: 'Test video upload',
                access_token: config.vk.groupToken,
                v: '5.131'
            }
        });
        
        if (videoTest.data.response) {
            console.log('✅ Видео-сервер получен! Загрузка возможна');
            console.log('  - upload_url:', videoTest.data.response.upload_url?.substring(0, 50) + '...');
        } else if (videoTest.data.error) {
            console.log('❌ Ошибка получения сервера:');
            console.log('  - Код:', videoTest.data.error.error_code);
            console.log('  - Сообщение:', videoTest.data.error.error_msg);
            
            if (videoTest.data.error.error_code === 5) {
                console.log('\n⚠️ Нужно создать НОВЫЙ токен с правами на видео!');
                console.log('Инструкция:');
                console.log('1. Зайдите в настройки сообщества → Работа с API');
                console.log('2. Нажмите "Создать ключ"');
                console.log('3. Обязательно отметьте ВСЕ пункты в списке');
                console.log('4. Особенно важно: "Управление сообществом" и "Видео"');
                console.log('5. Скопируйте новый токен и обновите .env');
            }
        }
        
    } catch (error) {
        console.error('❌ Ошибка:', error.response?.data || error.message);
    }
}

checkScopes();
