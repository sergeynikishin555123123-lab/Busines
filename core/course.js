const database = require('../database');
const logger = require('../logger');

class CourseService {
  async getAllCourses(activeOnly = false) {
    const courses = database.readTable('courses');
    if (activeOnly) {
      return courses.filter(c => c.is_active);
    }
    return courses.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }

  async getCourseById(courseId) {
    const courses = database.readTable('courses');
    return courses.find(c => c.id === courseId) || null;
  }

  async getCourseLessons(courseId) {
    const lessons = database.readTable('lessons');
    return lessons
      .filter(l => l.course_id === courseId)
      .sort((a, b) => a.order_number - b.order_number);
  }

  async getFreeLessons() {
    const lessons = database.readTable('lessons');
    const courses = database.readTable('courses');
    
    return lessons
      .filter(l => l.is_free)
      .map(l => {
        const course = courses.find(c => c.id === l.course_id);
        return {
          ...l,
          course_title: course ? course.title : '',
        };
      })
      .filter(l => {
        const course = courses.find(c => c.id === l.course_id);
        return course && course.is_active;
      })
      .sort((a, b) => a.order_number - b.order_number);
  }

  async getUserFreeLessonsProgress(userId) {
    const freeLessons = await this.getFreeLessons();
    const progress = database.readTable('progress');

    return freeLessons.map(lesson => {
      const userProgress = progress.find(p => p.user_id === userId && p.lesson_id === lesson.id);
      return {
        id: lesson.id,
        title: lesson.title,
        order_number: lesson.order_number,
        status: userProgress ? userProgress.status : 'started',
        test_passed: userProgress ? userProgress.test_passed : false,
        completed_at: userProgress ? userProgress.completed_at : null,
      };
    });
  }

  async hasUserCompletedAllFreeLessons(userId) {
    const freeLessons = database.readTable('lessons').filter(l => l.is_free);
    const progress = database.readTable('progress');
    
    const total = freeLessons.length;
    const completed = freeLessons.filter(lesson => {
      const p = progress.find(pr => pr.user_id === userId && pr.lesson_id === lesson.id);
      return p && p.status === 'completed';
    }).length;
    
    return total > 0 && total === completed;
  }

  async getUserFullCourseAccess(userId) {
    const access = database.readTable('user_course_access');
    const courses = database.readTable('courses');
    
    return access
      .filter(a => a.user_id === userId)
      .map(a => {
        const course = courses.find(c => c.id === a.course_id);
        if (!course || !course.is_active) return null;
        return {
          ...a,
          title: course.title,
          description: course.description,
        };
      })
      .filter(Boolean);
  }

  async grantCourseAccess(userId, courseId) {
    const access = database.readTable('user_course_access');
    
    const existing = access.find(a => a.user_id === userId && a.course_id === courseId);
    if (existing) return existing;

    const newAccess = {
      id: database.generateId(),
      user_id: userId,
      course_id: courseId,
      granted_at: database.now(),
    };

    access.push(newAccess);
    database.writeTable('user_course_access', access);

    logger.info(`Course access granted: user=${userId}, course=${courseId}`);
    return newAccess;
  }

  async createCourse(data) {
    const courses = database.readTable('courses');
    
    const course = {
      id: database.generateId(),
      title: data.title,
      description: data.description || '',
      price: parseFloat(data.price) || 0,
      is_active: true,
      created_at: database.now(),
      updated_at: database.now(),
    };

    courses.push(course);
    database.writeTable('courses', courses);

    return course;
  }

  async updateCourse(courseId, data) {
    const courses = database.readTable('courses');
    const index = courses.findIndex(c => c.id === courseId);
    
    if (index === -1) return null;

    if (data.title !== undefined) courses[index].title = data.title;
    if (data.description !== undefined) courses[index].description = data.description;
    if (data.price !== undefined) courses[index].price = parseFloat(data.price);
    if (data.isActive !== undefined) courses[index].is_active = data.isActive;
    courses[index].updated_at = database.now();

    database.writeTable('courses', courses);
    return courses[index];
  }

  async deleteCourse(courseId) {
    let courses = database.readTable('courses');
    let lessons = database.readTable('lessons');
    let lessonFiles = database.readTable('lesson_files');
    let tests = database.readTable('tests');
    let testAnswers = database.readTable('test_answers');

    const courseLessons = lessons.filter(l => l.course_id === courseId);
    
    for (const lesson of courseLessons) {
      const files = lessonFiles.filter(f => f.lesson_id === lesson.id);
      for (const file of files) {
        const storageService = require('../services/storage');
        await storageService.deleteFile(file.url);
      }
      
      lessonFiles = lessonFiles.filter(f => f.lesson_id !== lesson.id);
      
      const test = tests.find(t => t.lesson_id === lesson.id);
      if (test) {
        testAnswers = testAnswers.filter(a => a.test_id !== test.id);
        tests = tests.filter(t => t.id !== test.id);
      }
    }

    lessons = lessons.filter(l => l.course_id !== courseId);
    courses = courses.filter(c => c.id !== courseId);

    database.writeTable('courses', courses);
    database.writeTable('lessons', lessons);
    database.writeTable('lesson_files', lessonFiles);
    database.writeTable('tests', tests);
    database.writeTable('test_answers', testAnswers);

    return true;
  }

  async getPaidCourses() {
    const courses = database.readTable('courses');
    return courses.filter(c => c.price > 0 && c.is_active).sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  }
}

module.exports = new CourseService();
