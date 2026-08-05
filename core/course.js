// core/course.js
// УПРАВЛЕНИЕ КУРСАМИ

const database = require('../database');
const logger = require('../logger');

class CourseService {
    async getAllCourses(activeOnly = false) {
        const courses = database.readTable('courses');
        const filtered = activeOnly ? courses.filter(c => c.is_active !== false) : courses;
        return filtered.sort((a, b) => (a.order_number || 0) - (b.order_number || 0));
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
            .filter(l => l.is_free === true)
            .map(l => {
                const course = courses.find(c => c.id === l.course_id);
                return {
                    ...l,
                    course_title: course ? course.title : '',
                };
            })
            .filter(l => {
                const course = courses.find(c => c.id === l.course_id);
                return course && course.is_active !== false;
            })
            .sort((a, b) => a.order_number - b.order_number);
    }

    async getPaidLessons() {
        const lessons = database.readTable('lessons');
        const courses = database.readTable('courses');

        return lessons
            .filter(l => l.is_free !== true)
            .map(l => {
                const course = courses.find(c => c.id === l.course_id);
                return {
                    ...l,
                    course_title: course ? course.title : '',
                };
            })
            .filter(l => {
                const course = courses.find(c => c.id === l.course_id);
                return course && course.is_active !== false;
            })
            .sort((a, b) => a.order_number - b.order_number);
    }

    async getUserFullCourseAccess(userId) {
        const access = database.readTable('user_course_access');
        const courses = database.readTable('courses');

        return access
            .filter(a => a.user_id === userId)
            .map(a => {
                const course = courses.find(c => c.id === a.course_id);
                if (!course || course.is_active === false) return null;
                return {
                    ...a,
                    title: course.title,
                    description: course.description,
                    price: course.price,
                };
            })
            .filter(Boolean);
    }

    async checkUserCourseAccess(userId, courseId) {
        const access = database.readTable('user_course_access');
        return access.some(a => a.user_id === userId && a.course_id === courseId);
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
            expires_at: null,
        };

        access.push(newAccess);
        database.writeTable('user_course_access', access);
        logger.info(`Course access granted: user=${userId}, course=${courseId}`);
        return newAccess;
    }

    async revokeCourseAccess(userId, courseId) {
        let access = database.readTable('user_course_access');
        access = access.filter(a => !(a.user_id === userId && a.course_id === courseId));
        database.writeTable('user_course_access', access);
        logger.info(`Course access revoked: user=${userId}, course=${courseId}`);
        return true;
    }

    async createCourse(data) {
        const courses = database.readTable('courses');

        const course = {
            id: database.generateId(),
            title: data.title,
            description: data.description || '',
            price: parseFloat(data.price) || 0,
            image_url: data.imageUrl || '',
            is_active: data.isActive !== undefined ? data.isActive : true,
            order_number: parseInt(data.orderNumber) || 0,
            created_at: database.now(),
            updated_at: database.now(),
        };

        courses.push(course);
        database.writeTable('courses', courses);
        logger.info(`Course created: ${course.id}, title: ${course.title}`);
        return course;
    }

    async updateCourse(courseId, data) {
        const courses = database.readTable('courses');
        const index = courses.findIndex(c => c.id === courseId);

        if (index === -1) return null;

        if (data.title !== undefined) courses[index].title = data.title;
        if (data.description !== undefined) courses[index].description = data.description;
        if (data.price !== undefined) courses[index].price = parseFloat(data.price);
        if (data.imageUrl !== undefined) courses[index].image_url = data.imageUrl;
        if (data.isActive !== undefined) courses[index].is_active = data.isActive;
        if (data.orderNumber !== undefined) courses[index].order_number = parseInt(data.orderNumber);

        courses[index].updated_at = database.now();
        database.writeTable('courses', courses);
        logger.info(`Course updated: ${courseId}`);
        return courses[index];
    }

    async deleteCourse(courseId) {
        let courses = database.readTable('courses');
        let lessons = database.readTable('lessons');
        let lessonFiles = database.readTable('lesson_files');
        let tests = database.readTable('tests');
        let testAnswers = database.readTable('test_answers');
        let access = database.readTable('user_course_access');

        // Находим уроки курса
        const courseLessons = lessons.filter(l => l.course_id === courseId);

        // Удаляем файлы уроков
        for (const lesson of courseLessons) {
            const files = lessonFiles.filter(f => f.lesson_id === lesson.id);
            for (const file of files) {
                try {
                    const storageService = require('../services/storage');
                    await storageService.deleteFile(file.url);
                } catch (e) {
                    logger.warn(`Failed to delete file: ${file.url}`, e.message);
                }
            }
            lessonFiles = lessonFiles.filter(f => f.lesson_id !== lesson.id);

            // Удаляем тесты уроков
            const test = tests.find(t => t.lesson_id === lesson.id);
            if (test) {
                testAnswers = testAnswers.filter(a => a.test_id !== test.id);
                tests = tests.filter(t => t.id !== test.id);
            }
        }

        // Удаляем уроки
        lessons = lessons.filter(l => l.course_id !== courseId);

        // Удаляем доступы к курсу
        access = access.filter(a => a.course_id !== courseId);

        // Удаляем курс
        courses = courses.filter(c => c.id !== courseId);

        database.writeTable('courses', courses);
        database.writeTable('lessons', lessons);
        database.writeTable('lesson_files', lessonFiles);
        database.writeTable('tests', tests);
        database.writeTable('test_answers', testAnswers);
        database.writeTable('user_course_access', access);

        logger.info(`Course deleted: ${courseId}`);
        return true;
    }

    async getPaidCourses() {
        const courses = database.readTable('courses');
        return courses
            .filter(c => c.price > 0 && c.is_active !== false)
            .sort((a, b) => (a.order_number || 0) - (b.order_number || 0));
    }

    async getFreeCourses() {
        const courses = database.readTable('courses');
        return courses
            .filter(c => c.price === 0 && c.is_active !== false)
            .sort((a, b) => (a.order_number || 0) - (b.order_number || 0));
    }

    async getCourseStats(courseId) {
        const lessons = await this.getCourseLessons(courseId);
        const views = database.readTable('lesson_views');
        const progress = database.readTable('progress');

        let totalViews = 0;
        let completedLessons = 0;

        for (const lesson of lessons) {
            const lessonViews = views.filter(v => v.lesson_id === lesson.id);
            totalViews += lessonViews.reduce((sum, v) => sum + (v.view_count || 0), 0);

            const completed = progress.filter(p => p.lesson_id === lesson.id && p.status === 'completed');
            completedLessons += completed.length;
        }

        const access = database.readTable('user_course_access');
        const purchasers = access.filter(a => a.course_id === courseId).length;

        return {
            totalLessons: lessons.length,
            totalViews,
            completedLessons,
            purchasers,
        };
    }
}

module.exports = new CourseService();
