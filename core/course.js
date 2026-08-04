const database = require('../database');
const logger = require('../logger');

class CourseService {
  async getAllCourses(activeOnly = false) {
    let query = 'SELECT * FROM courses';
    const params = [];
    
    if (activeOnly) {
      query += ' WHERE is_active = true';
    }
    
    query += ' ORDER BY created_at DESC';
    
    const result = await database.query(query, params);
    return result.rows;
  }

  async getCourseById(courseId) {
    const result = await database.query('SELECT * FROM courses WHERE id = $1', [courseId]);
    return result.rows[0] || null;
  }

  async getCourseLessons(courseId) {
    const result = await database.query(
      'SELECT * FROM lessons WHERE course_id = $1 ORDER BY order_number ASC',
      [courseId]
    );
    return result.rows;
  }

  async getFreeLessons() {
    const result = await database.query(
      'SELECT l.*, c.title as course_title FROM lessons l JOIN courses c ON l.course_id = c.id WHERE l.is_free = true AND c.is_active = true ORDER BY l.order_number ASC'
    );
    return result.rows;
  }

  async getUserFreeLessonsProgress(userId) {
    const result = await database.query(
      `SELECT l.id, l.title, l.order_number, p.status, p.test_passed, p.completed_at
       FROM lessons l
       JOIN courses c ON l.course_id = c.id
       LEFT JOIN progress p ON l.id = p.lesson_id AND p.user_id = $1
       WHERE l.is_free = true AND c.is_active = true
       ORDER BY l.order_number ASC`,
      [userId]
    );
    return result.rows;
  }

  async hasUserCompletedAllFreeLessons(userId) {
    const totalFree = await database.query(
      'SELECT COUNT(*) as count FROM lessons WHERE is_free = true'
    );
    
    const completedFree = await database.query(
      `SELECT COUNT(*) as count 
       FROM progress p 
       JOIN lessons l ON p.lesson_id = l.id 
       WHERE p.user_id = $1 AND l.is_free = true AND p.status = 'completed'`,
      [userId]
    );

    const total = parseInt(totalFree.rows[0].count);
    const completed = parseInt(completedFree.rows[0].count);
    
    return total > 0 && total === completed;
  }

  async getUserFullCourseAccess(userId) {
    const result = await database.query(
      `SELECT uca.*, c.title, c.description 
       FROM user_course_access uca 
       JOIN courses c ON uca.course_id = c.id 
       WHERE uca.user_id = $1 AND c.is_active = true`,
      [userId]
    );
    return result.rows;
  }

  async grantCourseAccess(userId, courseId) {
    const existing = await database.query(
      'SELECT * FROM user_course_access WHERE user_id = $1 AND course_id = $2',
      [userId, courseId]
    );

    if (existing.rows.length > 0) {
      return existing.rows[0];
    }

    const result = await database.query(
      'INSERT INTO user_course_access (user_id, course_id) VALUES ($1, $2) RETURNING *',
      [userId, courseId]
    );

    logger.info(`Course access granted: user=${userId}, course=${courseId}`);
    return result.rows[0];
  }

  async createCourse(data) {
    const result = await database.query(
      'INSERT INTO courses (title, description, price) VALUES ($1, $2, $3) RETURNING *',
      [data.title, data.description || '', data.price || 0]
    );
    return result.rows[0];
  }

  async updateCourse(courseId, data) {
    const result = await database.query(
      `UPDATE courses 
       SET title = COALESCE($1, title), 
           description = COALESCE($2, description), 
           price = COALESCE($3, price),
           is_active = COALESCE($4, is_active),
           updated_at = NOW() 
       WHERE id = $5 
       RETURNING *`,
      [data.title, data.description, data.price, data.isActive, courseId]
    );
    return result.rows[0];
  }

  async deleteCourse(courseId) {
    await database.query('DELETE FROM courses WHERE id = $1', [courseId]);
    return true;
  }

  async getPaidCourses() {
    const result = await database.query(
      'SELECT * FROM courses WHERE price > 0 AND is_active = true ORDER BY created_at ASC'
    );
    return result.rows;
  }
}

module.exports = new CourseService();
