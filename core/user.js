const database = require('../database');
const logger = require('../logger');

class UserService {
  async getOrCreateUser(platform, platformUserId, userData = {}) {
    const users = database.readTable('users');
    
    let user = users.find(u => u.platform === platform && u.platform_user_id === platformUserId);
    
    if (user) {
      user.first_name = userData.firstName || user.first_name;
      user.last_name = userData.lastName || user.last_name;
      user.username = userData.username || user.username;
      user.updated_at = database.now();
      database.writeTable('users', users);
      return user;
    }

    user = {
      id: database.generateId(),
      platform,
      platform_user_id: platformUserId,
      first_name: userData.firstName || '',
      last_name: userData.lastName || '',
      username: userData.username || '',
      language_code: 'ru',
      created_at: database.now(),
      updated_at: database.now(),
    };

    users.push(user);
    database.writeTable('users', users);
    
    logger.info(`New user created: ${platform}:${platformUserId}`);
    return user;
  }

  async getUserById(userId) {
    const users = database.readTable('users');
    return users.find(u => u.id === userId) || null;
  }

  async getUserByPlatform(platform, platformUserId) {
    const users = database.readTable('users');
    return users.find(u => u.platform === platform && u.platform_user_id === platformUserId) || null;
  }

  async getAllUsers(page = 1, limit = 50) {
    const users = database.readTable('users');
    const sorted = users.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const offset = (page - 1) * limit;
    
    return {
      users: sorted.slice(offset, offset + limit),
      total: users.length,
      page,
      limit,
    };
  }

  async getUserStats(userId) {
    const progress = database.readTable('progress');
    const lessons = database.readTable('lessons');
    const access = database.readTable('user_course_access');
    const courses = database.readTable('courses');
    const views = database.readTable('lesson_views');

    const userProgress = progress
      .filter(p => p.user_id === userId)
      .map(p => {
        const lesson = lessons.find(l => l.id === p.lesson_id);
        return {
          ...p,
          lesson_title: lesson ? lesson.title : '',
          course_id: lesson ? lesson.course_id : '',
        };
      });

    const userAccess = access
      .filter(a => a.user_id === userId)
      .map(a => {
        const course = courses.find(c => c.id === a.course_id);
        return {
          ...a,
          course_title: course ? course.title : '',
        };
      });

    const userViews = views
      .filter(v => v.user_id === userId)
      .map(v => {
        const lesson = lessons.find(l => l.id === v.lesson_id);
        return {
          ...v,
          lesson_title: lesson ? lesson.title : '',
        };
      });

    return {
      progress: userProgress,
      courseAccess: userAccess,
      lessonViews: userViews,
    };
  }
}

module.exports = new UserService();
