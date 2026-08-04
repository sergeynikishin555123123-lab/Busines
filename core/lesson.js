const database = require('../database');
const logger = require('../logger');

class LessonService {
  async getLessonById(lessonId) {
    const lessons = database.readTable('lessons');
    const courses = database.readTable('courses');
    const lesson = lessons.find(l => l.id === lessonId);
    if (!lesson) return null;
    
    const course = courses.find(c => c.id === lesson.course_id);
    return {
      ...lesson,
      course_title: course ? course.title : '',
    };
  }

  async getLessonWithFiles(lessonId) {
    const lesson = await this.getLessonById(lessonId);
    if (!lesson) return null;

    const files = database.readTable('lesson_files').filter(f => f.lesson_id === lessonId);
    const test = await this.getLessonTest(lessonId);

    return {
      ...lesson,
      files,
      test,
    };
  }

  async getLessonTest(lessonId) {
    const tests = database.readTable('tests');
    const answers = database.readTable('test_answers');
    
    const test = tests.find(t => t.lesson_id === lessonId);
    if (!test) return null;

    return {
      ...test,
      answers: answers
        .filter(a => a.test_id === test.id)
        .map(a => ({
          id: a.id,
          answer: a.answer,
          is_correct: a.is_correct,
        })),
    };
  }

  async checkTestAnswer(lessonId, answerId, userId) {
    const answers = database.readTable('test_answers');
    const answer = answers.find(a => a.id === answerId);

    if (!answer) {
      throw new Error('Ответ не найден');
    }

    if (answer.is_correct) {
      const progress = database.readTable('progress');
      const existing = progress.find(p => p.user_id === userId && p.lesson_id === lessonId);

      if (existing) {
        existing.status = 'completed';
        existing.test_passed = true;
        existing.completed_at = database.now();
      } else {
        progress.push({
          id: database.generateId(),
          user_id: userId,
          lesson_id: lessonId,
          status: 'completed',
          test_passed: true,
          last_position: 0,
          completed_at: database.now(),
        });
      }

      database.writeTable('progress', progress);
    }

    return {
      correct: answer.is_correct,
      answerId: answer.id,
    };
  }

  async recordLessonView(userId, lessonId) {
    const views = database.readTable('lesson_views');
    const existing = views.find(v => v.user_id === userId && v.lesson_id === lessonId);

    if (existing) {
      existing.view_count += 1;
      existing.last_viewed_at = database.now();
    } else {
      views.push({
        id: database.generateId(),
        user_id: userId,
        lesson_id: lessonId,
        view_count: 1,
        first_viewed_at: database.now(),
        last_viewed_at: database.now(),
      });
    }

    database.writeTable('lesson_views', views);

    const progress = database.readTable('progress');
    const progExists = progress.find(p => p.user_id === userId && p.lesson_id === lessonId);
    
    if (!progExists) {
      progress.push({
        id: database.generateId(),
        user_id: userId,
        lesson_id: lessonId,
        status: 'started',
        test_passed: false,
        last_position: 0,
        completed_at: null,
      });
      database.writeTable('progress', progress);
    }
  }

  async createLesson(data) {
    const lessons = database.readTable('lessons');
    
    const lesson = {
      id: database.generateId(),
      course_id: data.courseId,
      title: data.title,
      description: data.description || '',
      video_url: data.videoUrl || '',
      order_number: data.orderNumber || 0,
      is_free: data.isFree || false,
      created_at: database.now(),
      updated_at: database.now(),
    };

    lessons.push(lesson);
    database.writeTable('lessons', lessons);

    return lesson;
  }

  async updateLesson(lessonId, data) {
    const lessons = database.readTable('lessons');
    const index = lessons.findIndex(l => l.id === lessonId);
    
    if (index === -1) return null;

    if (data.title !== undefined) lessons[index].title = data.title;
    if (data.description !== undefined) lessons[index].description = data.description;
    if (data.videoUrl !== undefined) lessons[index].video_url = data.videoUrl;
    if (data.orderNumber !== undefined) lessons[index].order_number = parseInt(data.orderNumber);
    if (data.isFree !== undefined) lessons[index].is_free = data.isFree;
    lessons[index].updated_at = database.now();

    database.writeTable('lessons', lessons);
    return lessons[index];
  }

  async deleteLesson(lessonId) {
    let lessons = database.readTable('lessons');
    let files = database.readTable('lesson_files');
    let tests = database.readTable('tests');
    let answers = database.readTable('test_answers');

    const lessonFiles = files.filter(f => f.lesson_id === lessonId);
    for (const file of lessonFiles) {
      const storageService = require('../services/storage');
      await storageService.deleteFile(file.url);
    }

    const test = tests.find(t => t.lesson_id === lessonId);
    if (test) {
      answers = answers.filter(a => a.test_id !== test.id);
      tests = tests.filter(t => t.id !== test.id);
    }

    files = files.filter(f => f.lesson_id !== lessonId);
    lessons = lessons.filter(l => l.id !== lessonId);

    database.writeTable('lessons', lessons);
    database.writeTable('lesson_files', files);
    database.writeTable('tests', tests);
    database.writeTable('test_answers', answers);

    return true;
  }

  async addLessonFile(lessonId, fileData) {
    const files = database.readTable('lesson_files');
    
    const file = {
      id: database.generateId(),
      lesson_id: lessonId,
      filename: fileData.filename,
      url: fileData.url,
      type: fileData.type,
      created_at: database.now(),
    };

    files.push(file);
    database.writeTable('lesson_files', files);

    return file;
  }

  async deleteLessonFile(fileId) {
    let files = database.readTable('lesson_files');
    const file = files.find(f => f.id === fileId);
    
    if (file) {
      const storageService = require('../services/storage');
      await storageService.deleteFile(file.url);
      files = files.filter(f => f.id !== fileId);
      database.writeTable('lesson_files', files);
    }

    return true;
  }

  async createTest(lessonId, testData) {
    let tests = database.readTable('tests');
    let answers = database.readTable('test_answers');

    const existingTest = tests.find(t => t.lesson_id === lessonId);
    if (existingTest) {
      answers = answers.filter(a => a.test_id !== existingTest.id);
      tests = tests.filter(t => t.id !== existingTest.id);
    }

    const test = {
      id: database.generateId(),
      lesson_id: lessonId,
      question: testData.question,
    };

    tests.push(test);

    for (const answer of testData.answers) {
      answers.push({
        id: database.generateId(),
        test_id: test.id,
        answer: answer.text,
        is_correct: answer.isCorrect || false,
      });
    }

    database.writeTable('tests', tests);
    database.writeTable('test_answers', answers);

    return test;
  }

  async updateProgressPosition(userId, lessonId, position) {
    const progress = database.readTable('progress');
    const item = progress.find(p => p.user_id === userId && p.lesson_id === lessonId);
    
    if (item) {
      item.last_position = position;
      database.writeTable('progress', progress);
    }
  }
}

module.exports = new LessonService();
