// core/user.js - УПРАВЛЕНИЕ ПОЛЬЗОВАТЕЛЯМИ

const database = require('../database');
const logger = require('../logger');

class UserService {
    
    async registerUser(data) {
        try {
            const users = database.readTable('users');
            
            let user = users.find(u => String(u.platform_user_id) === String(data.platform_user_id));
            
            if (user) {
                // Обновляем информацию
                if (data.first_name) user.first_name = data.first_name;
                if (data.last_name) user.last_name = data.last_name;
                if (data.username) user.username = data.username;
                if (data.chat_id) user.chat_id = data.chat_id;
                user.updated_at = database.now();
                
                database.writeTable('users', users);
                return user;
            }
            
            // Создаем нового пользователя
            user = {
                id: database.generateId(),
                platform_user_id: String(data.platform_user_id),
                platform: data.platform || 'max',
                first_name: data.first_name || 'Пользователь',
                last_name: data.last_name || '',
                username: data.username || '',
                chat_id: data.chat_id ? String(data.chat_id) : String(data.platform_user_id),
                email: data.email || null,
                phone: data.phone || null,
                created_at: database.now(),
                updated_at: database.now(),
            };
            
            users.push(user);
            database.writeTable('users', users);
            
            logger.info(`User registered: ${user.id} (${user.platform_user_id})`);
            return user;
        } catch (error) {
            logger.error('Error registering user:', error);
            throw error;
        }
    }
    
    async getUserByPlatformId(platformUserId) {
        const users = database.readTable('users');
        return users.find(u => String(u.platform_user_id) === String(platformUserId)) || null;
    }
    
    async getUserById(userId) {
        const users = database.readTable('users');
        return users.find(u => u.id === userId) || null;
    }
    
    async getAllUsers(page = 1, limit = 50) {
        const users = database.readTable('users');
        const offset = (page - 1) * limit;
        
        return {
            users: users.slice(offset, offset + limit),
            total: users.length,
            page,
            limit,
        };
    }
    
    async getUserStats() {
        const users = database.readTable('users');
        const payments = database.readTable('payments');
        const progress = database.readTable('progress');
        
        const successfulPayments = payments.filter(p => p.status === 'success');
        const uniquePayers = new Set(successfulPayments.map(p => p.user_id));
        
        return {
            total_users: users.length,
            paying_users: uniquePayers.size,
            active_users: progress.filter(p => p.status === 'completed').length,
        };
    }
}

module.exports = new UserService();
