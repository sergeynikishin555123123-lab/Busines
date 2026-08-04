const database = require('../database');

class ProgressService {
  async getUserProgress(userId) {
    const result = await database.query(
      `SELECT p.*, l.title as lesson_title, l.course_id, c.title as course_title
       FROM progress p
       JOIN lessons l ON p.lesson_id = l.id
       JOIN courses c ON l.course_id = c.id
       WHERE p.user_id = $1
       ORDER BY p.completed_at DESC`,
      [userId]
    );
    return result.rows;
  }

  async getCompletedLessons(userId) {
    const result = await database.query(
      `SELECT l.*, c.title as course_title, p.completed_at
       FROM progress p
       JOIN lessons l ON p.lesson_id = l.id
       JOIN courses c ON l.course_id = c.id
       WHERE p.user_id = $1 AND p.status = 'completed'
       ORDER BY p.completed_at ASC`,
      [userId]
    );
    return result.rows;
  }

  async getProgressSummary(userId) {
    const totalLessons = await database.query(
      'SELECT COUNT(*) as count FROM lessons'
    );
    
    const completedLessons = await database.query(
      `SELECT COUNT(*) as count FROM progress 
       WHERE user_id = $1 AND status = 'completed'`,
      [userId]
    );

    const freeLessons = await database.query(
      'SELECT COUNT(*) as count FROM lessons WHERE is_free = true'
    );

    const completedFreeLessons = await database.query(
      `SELECT COUNT(*) as count 
       FROM progress p 
       JOIN lessons l ON p.lesson_id = l.id 
       WHERE p.user_id = $1 AND l.is_free = true AND p.status = 'completed'`,
      [userId]
    );

    return {
      totalLessons: parseInt(totalLessons.rows[0].count),
      completedLessons: parseInt(completedLessons.rows[0].count),
      totalFreeLessons: parseInt(freeLessons.rows[0].count),
      completedFreeLessons: parseInt(completedFreeLessons.rows[0].count),
    };
  }

  async getLastActivity(userId) {
    const result = await database.query(
      `SELECT MAX(completed_at) as last_activity FROM progress WHERE user_id = $1`,
      [userId]
    );
    return result.rows[0]?.last_activity || null;
  }
}

module.exports = new ProgressService();
