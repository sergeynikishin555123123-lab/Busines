const database = require('../database');
const logger = require('../logger');

class UserService {
  async getOrCreateUser(platform, platformUserId, userData = {}) {
    const existingUser = await database.query(
      'SELECT * FROM users WHERE platform = $1 AND platform_user_id = $2',
      [platform, platformUserId]
    );

    if (existingUser.rows.length > 0) {
      await database.query(
        'UPDATE users SET first_name = $1, last_name = $2, username = $3, updated_at = NOW() WHERE id = $4',
        [
          userData.firstName || existingUser.rows[0].first_name,
          userData.lastName || existingUser.rows[0].last_name,
          userData.username || existingUser.rows[0].username,
          existingUser.rows[0].id,
        ]
      );
      return existingUser.rows[0];
    }

    const newUser = await database.query(
      'INSERT INTO users (platform, platform_user_id, first_name, last_name, username) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [
        platform,
        platformUserId,
        userData.firstName || '',
        userData.lastName || '',
        userData.username || '',
      ]
    );

    logger.info(`New user created: ${platform}:${platformUserId}`);
    return newUser.rows[0];
  }

  async getUserById(userId) {
    const result = await database.query('SELECT * FROM users WHERE id = $1', [userId]);
    return result.rows[0] || null;
  }

  async getUserByPlatform(platform, platformUserId) {
    const result = await database.query(
      'SELECT * FROM users WHERE platform = $1 AND platform_user_id = $2',
      [platform, platformUserId]
    );
    return result.rows[0] || null;
  }

  async getAllUsers(page = 1, limit = 50) {
    const offset = (page - 1) * limit;
    const result = await database.query(
      'SELECT * FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2',
      [limit, offset]
    );
    const countResult = await database.query('SELECT COUNT(*) as total FROM users');
    
    return {
      users: result.rows,
      total: parseInt(countResult.rows[0].total),
      page,
      limit,
    };
  }

  async getUserStats(userId) {
    const progress = await database.query(
      `SELECT p.*, l.title as lesson_title, l.course_id 
       FROM progress p 
       JOIN lessons l ON p.lesson_id = l.id 
       WHERE p.user_id = $1`,
      [userId]
    );

    const access = await database.query(
      `SELECT uca.*, c.title as course_title 
       FROM user_course_access uca 
       JOIN courses c ON uca.course_id = c.id 
       WHERE uca.user_id = $1`,
      [userId]
    );

    const views = await database.query(
      `SELECT lv.*, l.title as lesson_title 
       FROM lesson_views lv 
       JOIN lessons l ON lv.lesson_id = l.id 
       WHERE lv.user_id = $1`,
      [userId]
    );

    return {
      progress: progress.rows,
      courseAccess: access.rows,
      lessonViews: views.rows,
    };
  }
}

module.exports = new UserService();
