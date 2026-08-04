const database = require('../database');

class ProgressService {
  async getUserProgress(userId) {
    const progress = database.readTable('progress');
    const lessons = database.readTable('lessons');
    const courses = database.readTable('courses');

    return progress
      .filter(p => p.user_id === userId)
      .map(p => {
        const lesson = lessons.find(l => l.id === p.lesson_id);
        const course = lesson ? courses.find(c => c.id === lesson.course_id) : null;
        return {
          ...p,
          lesson_title: lesson ? lesson.title : '',
          course_id: lesson ? lesson.course_id : '',
          course_title: course ? course.title : '',
        };
      })
      .sort((a, b) => new Date(b.completed_at || 0) - new Date(a.completed_at || 0));
  }

  async getCompletedLessons(userId) {
    const progress = database.readTable('progress');
    const lessons = database.readTable('lessons');
    const courses = database.readTable('courses');

    return progress
      .filter(p => p.user_id === userId && p.status === 'completed')
      .map(p => {
        const lesson = lessons.find(l => l.id === p.lesson_id);
        const course = lesson ? courses.find(c => c.id === lesson.course_id) : null;
        return {
          ...lesson,
          course_title: course ? course.title : '',
          completed_at: p.completed_at,
        };
      })
      .sort((a, b) => new Date(a.completed_at) - new Date(b.completed_at));
  }

  async getProgressSummary(userId) {
    const lessons = database.readTable('lessons');
    const progress = database.readTable('progress');
    const userProgress = progress.filter(p => p.user_id === userId);

    return {
      totalLessons: lessons.length,
      completedLessons: userProgress.filter(p => p.status === 'completed').length,
      totalFreeLessons: lessons.filter(l => l.is_free).length,
      completedFreeLessons: userProgress.filter(p => {
        const lesson = lessons.find(l => l.id === p.lesson_id);
        return lesson && lesson.is_free && p.status === 'completed';
      }).length,
    };
  }

  async getLastActivity(userId) {
    const progress = database.readTable('progress');
    const userProgress = progress.filter(p => p.user_id === userId && p.completed_at);
    
    if (userProgress.length === 0) return null;
    
    return userProgress.sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at))[0].completed_at;
  }
}

module.exports = new ProgressService();
