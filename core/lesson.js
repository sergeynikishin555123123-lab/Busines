const database = require('../database');
const logger = require('../logger');

class LessonService {
  async getLessonById(lessonId) {
    const result = await database.query(
      'SELECT l.*, c.title as course_title FROM lessons l JOIN courses c ON l.course_id = c.id WHERE l.id = $1',
      [lessonId]
    );
    return result.rows[0] || null;
  }

  async getLessonWithFiles(lessonId) {
    const lesson = await this.getLessonById(lessonId);
    if (!lesson) return null;

    const files = await database.query(
      'SELECT * FROM lesson_files WHERE lesson_id = $1 ORDER BY created_at ASC',
      [lessonId]
    );

    const test = await this.getLessonTest(lessonId);

    return {
      ...lesson,
      files: files.rows,
      test: test,
    };
  }

  async getLessonTest(lessonId) {
    const testResult = await database.query(
      'SELECT * FROM tests WHERE lesson_id = $1',
      [lessonId]
    );

    if (testResult.rows.length === 0) return null;

    const test = testResult.rows[0];
    const answers = await database.query(
      'SELECT * FROM test_answers WHERE test_id = $1 ORDER BY id ASC',
      [test.id]
    );

    return {
      ...test,
      answers: answers.rows.map(a => ({
        id: a.id,
        answer: a.answer,
      })),
    };
  }

  async checkTestAnswer(lessonId, answerId, userId) {
    const answer = await database.query(
      `SELECT ta.* FROM test_answers ta 
       JOIN tests t ON ta.test_id = t.id 
       WHERE t.lesson_id = $1 AND ta.id = $2`,
      [lessonId, answerId]
    );

    if (answer.rows.length === 0) {
      throw new Error('Ответ не найден');
    }

    const isCorrect = answer.rows[0].is_correct;

    if (isCorrect) {
      await database.query(
        `INSERT INTO progress (user_id, lesson_id, status, test_passed, completed_at)
         VALUES ($1, $2, 'completed', true, NOW())
         ON CONFLICT (user_id, lesson_id) 
         DO UPDATE SET status = 'completed', test_passed = true, completed_at = NOW()`,
        [userId, lessonId]
      );
    }

    return {
      correct: isCorrect,
      answerId: answer.rows[0].id,
    };
  }

  async recordLessonView(userId, lessonId) {
    const existing = await database.query(
      'SELECT * FROM lesson_views WHERE user_id = $1 AND lesson_id = $2',
      [userId, lessonId]
    );

    if (existing.rows.length > 0) {
      await database.query(
        `UPDATE lesson_views 
         SET view_count = view_count + 1, last_viewed_at = NOW() 
         WHERE user_id = $1 AND lesson_id = $2`,
        [userId, lessonId]
      );
    } else {
      await database.query(
        'INSERT INTO lesson_views (user_id, lesson_id) VALUES ($1, $2)',
        [userId, lessonId]
      );
    }

    await database.query(
      `INSERT INTO progress (user_id, lesson_id, status)
       VALUES ($1, $2, 'started')
       ON CONFLICT (user_id, lesson_id) DO NOTHING`,
      [userId, lessonId]
    );
  }

  async updateProgressPosition(userId, lessonId, position) {
    await database.query(
      `UPDATE progress SET last_position = $1 WHERE user_id = $2 AND lesson_id = $3`,
      [position, userId, lessonId]
    );
  }

  async createLesson(data) {
    const result = await database.query(
      `INSERT INTO lessons (course_id, title, description, video_url, order_number, is_free) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [data.courseId, data.title, data.description || '', data.videoUrl || '', data.orderNumber || 0, data.isFree || false]
    );
    return result.rows[0];
  }

  async updateLesson(lessonId, data) {
    const result = await database.query(
      `UPDATE lessons 
       SET title = COALESCE($1, title),
           description = COALESCE($2, description),
           video_url = COALESCE($3, video_url),
           order_number = COALESCE($4, order_number),
           is_free = COALESCE($5, is_free),
           updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [data.title, data.description, data.videoUrl, data.orderNumber, data.isFree, lessonId]
    );
    return result.rows[0];
  }

  async deleteLesson(lessonId) {
    const files = await database.query('SELECT * FROM lesson_files WHERE lesson_id = $1', [lessonId]);
    
    for (const file of files.rows) {
      const storageService = require('../services/storage');
      await storageService.deleteFile(file.url);
    }

    await database.query('DELETE FROM lessons WHERE id = $1', [lessonId]);
    return true;
  }

  async addLessonFile(lessonId, fileData) {
    const result = await database.query(
      'INSERT INTO lesson_files (lesson_id, filename, url, type) VALUES ($1, $2, $3, $4) RETURNING *',
      [lessonId, fileData.filename, fileData.url, fileData.type]
    );
    return result.rows[0];
  }

  async deleteLessonFile(fileId) {
    const file = await database.query('SELECT * FROM lesson_files WHERE id = $1', [fileId]);
    if (file.rows.length > 0) {
      const storageService = require('../services/storage');
      await storageService.deleteFile(file.rows[0].url);
      await database.query('DELETE FROM lesson_files WHERE id = $1', [fileId]);
    }
    return true;
  }

  async createTest(lessonId, testData) {
    const existingTest = await database.query('SELECT * FROM tests WHERE lesson_id = $1', [lessonId]);
    if (existingTest.rows.length > 0) {
      await database.query('DELETE FROM test_answers WHERE test_id = $1', [existingTest.rows[0].id]);
      await database.query('DELETE FROM tests WHERE lesson_id = $1', [lessonId]);
    }

    const testResult = await database.query(
      'INSERT INTO tests (lesson_id, question) VALUES ($1, $2) RETURNING *',
      [lessonId, testData.question]
    );

    const testId = testResult.rows[0].id;

    for (const answer of testData.answers) {
      await database.query(
        'INSERT INTO test_answers (test_id, answer, is_correct) VALUES ($1, $2, $3)',
        [testId, answer.text, answer.isCorrect || false]
      );
    }

    return testResult.rows[0];
  }
}

module.exports = new LessonService();
