// core/user.js - ИСПРАВЛЕННАЯ ВЕРСИЯ

const database = require('../database');
const logger = require('../logger');

class UserService {
    
    async registerUser(data) {
        try {
            const users = await database.readTable('users');
            
            const existing = users.find(u => 
                u.platform_user_id === data.platform_user_id && 
                u.platform === data.platform
            );
            
            if (existing) {
                existing.first_name = data.first_name || existing.first_name;
                existing.last_name = data.last_name || existing.last_name;
                existing.username = data.username || existing.username;
                existing.chat_id = data.chat_id || existing.chat_id;
                existing.updated_at = database.now();
                await database.writeTable('users', users);
                return existing;
            }
            
            const user = {
                id: database.generateId(),
                platform_user_id: String(data.platform_user_id),
                platform: data.platform || 'max',
                first_name: data.first_name || 'Пользователь',
                last_name: data.last_name || '',
                username: data.username || '',
                chat_id: String(data.chat_id || data.platform_user_id),
                email: data.email || null,
                phone: data.phone || null,
                created_at: database.now(),
                updated_at: database.now(),
            };
            
            users.push(user);
            await database.writeTable('users', users);
            
            logger.info({ userId: user.id, platform: user.platform }, 'User registered');
            return user;
        } catch (error) {
            logger.error({ err: error, data }, 'Failed to register user');
            throw error;
        }
    }
    
    async getUserByPlatformId(platformUserId) {
        try {
            const users = await database.readTable('users');
            return users.find(u => String(u.platform_user_id) === String(platformUserId)) || null;
        } catch (error) {
            logger.error({ err: error, platformUserId }, 'Failed to get user');
            return null;
        }
    }
    
    async getUserById(userId) {
        try {
            const users = await database.readTable('users');
            return users.find(u => u.id === userId) || null;
        } catch (error) {
            logger.error({ err: error, userId }, 'Failed to get user');
            return null;
        }
    }
    
    async getOrCreateUser(platform, platformUserId, data = {}) {
        try {
            let user = await this.getUserByPlatformId(platformUserId);
            if (user) {
                if (data.firstName) user.first_name = data.firstName;
                if (data.lastName) user.last_name = data.lastName;
                if (data.username) user.username = data.username;
                user.updated_at = database.now();
                const users = await database.readTable('users');
                const index = users.findIndex(u => u.id === user.id);
                if (index !== -1) {
                    users[index] = user;
                    await database.writeTable('users', users);
                }
                return user;
            }
            
            return await this.registerUser({
                platform_user_id: platformUserId,
                platform: platform,
                first_name: data.firstName || 'Пользователь',
                last_name: data.lastName || '',
                username: data.username || '',
                chat_id: platformUserId,
            });
        } catch (error) {
            logger.error({ err: error, platform, platformUserId }, 'Failed to get or create user');
            throw error;
        }
    }
    
    async updateUser(userId, data) {
        try {
            const users = await database.readTable('users');
            const index = users.findIndex(u => u.id === userId);
            if (index === -1) return null;
            
            if (data.first_name !== undefined) users[index].first_name = data.first_name;
            if (data.last_name !== undefined) users[index].last_name = data.last_name;
            if (data.username !== undefined) users[index].username = data.username;
            if (data.email !== undefined) users[index].email = data.email;
            if (data.phone !== undefined) users[index].phone = data.phone;
            
            users[index].updated_at = database.now();
            await database.writeTable('users', users);
            
            return users[index];
        } catch (error) {
            logger.error({ err: error, userId }, 'Failed to update user');
            throw error;
        }
    }
    
    async getUsersCount() {
        try {
            const users = await database.readTable('users');
            return users.length;
        } catch (error) {
            logger.error({ err: error }, 'Failed to get users count');
            return 0;
        }
    }
    
    async getUsersByPlatform(platform) {
        try {
            const users = await database.readTable('users');
            return users.filter(u => u.platform === platform);
        } catch (error) {
            logger.error({ err: error, platform }, 'Failed to get users by platform');
            return [];
        }
    }
}

module.exports = new UserService();
