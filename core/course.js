// core/course.js - ИСПРАВЛЕННАЯ ВЕРСИЯ

const database = require('../database');
const logger = require('../logger');

class CourseService {

    async getAllCourses(activeOnly = false) {
        try {
            let courses = await database.readTable('courses');
            
            // Убеждаемся что courses - это массив
            if (!Array.isArray(courses)) {
                courses = [];
            }
            
            const filtered = activeOnly ? courses.filter(c => c.is_active !== false) : courses;
            
            // Убеждаемся что filtered - массив перед сортировкой
            if (!Array.isArray(filtered)) {
                return [];
            }
            
            return filtered.sort((a, b) => (a.order_number || 0) - (b.order_number || 0));
        } catch (error) {
            console.error('[COURSE] Error in getAllCourses:', error);
            return [];
        }
    }

    async getCourseById(courseId) {
        try {
            const courses = await database.readTable('courses');
            if (!Array.isArray(courses)) return null;
            return courses.find(c => c.id === courseId) || null;
        } catch (error) {
            console.error('[COURSE] Error in getCourseById:', error);
            return null;
        }
    }

    async getCourseLessons(courseId) {
        try {
            const lessons = await database.readTable('lessons');
            if (!Array.isArray(lessons)) return [];
            return lessons
                .filter(l => l.course_id === courseId)
                .sort((a, b) => (a.order_number || 0) - (b.order_number || 0));
        } catch (error) {
            console.error('[COURSE] Error in getCourseLessons:', error);
            return [];
        }
    }

    async getFreeLessons() {
        try {
            const lessons = await database.readTable('lessons');
            const courses = await database.readTable('courses');
            
            if (!Array.isArray(lessons)) return [];
            if (!Array.isArray(courses)) return [];
            
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
                .sort((a, b) => (a.order_number || 0) - (b.order_number || 0));
        } catch (error) {
            console.error('[COURSE] Error in getFreeLessons:', error);
            return [];
        }
    }

    async getPaidLessons() {
        try {
            const lessons = await database.readTable('lessons');
            const courses = await database.readTable('courses');
            
            if (!Array.isArray(lessons)) return [];
            if (!Array.isArray(courses)) return [];
            
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
                .sort((a, b) => (a.order_number || 0) - (b.order_number || 0));
        } catch (error) {
            console.error('[COURSE] Error in getPaidLessons:', error);
            return [];
        }
    }

    async getUserFullCourseAccess(userId) {
        try {
            const access = await database.readTable('user_course_access');
            const courses = await database.readTable('courses');
            
            if (!Array.isArray(access)) return [];
            if (!Array.isArray(courses)) return [];
            
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
        } catch (error) {
            console.error('[COURSE] Error in getUserFullCourseAccess:', error);
            return [];
        }
    }

    async checkUserCourseAccess(userId, courseId) {
        try {
            const access = await database.readTable('user_course_access');
            if (!Array.isArray(access)) return false;
            return access.some(a => a.user_id === userId && a.course_id === courseId);
        } catch (error) {
            console.error('[COURSE] Error in checkUserCourseAccess:', error);
            return false;
        }
    }

    async grantCourseAccess(userId, courseId) {
        try {
            const access = await database.readTable('user_course_access');
            if (!Array.isArray(access)) {
                // Если не массив, создаем новый
                const newAccess = [{
                    id: database.generateId(),
                    user_id: userId,
                    course_id: courseId,
                    granted_at: database.now(),
                    expires_at: null,
                }];
                await database.writeTable('user_course_access', newAccess);
                return newAccess[0];
            }
            
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
            await database.writeTable('user_course_access', access);
            
            logger.info(`Course access granted: user=${userId}, course=${courseId}`);
            return newAccess;
        } catch (error) {
            console.error('[COURSE] Error in grantCourseAccess:', error);
            throw error;
        }
    }

    async revokeCourseAccess(userId, courseId) {
        try {
            let access = await database.readTable('user_course_access');
            if (!Array.isArray(access)) return true;
            access = access.filter(a => !(a.user_id === userId && a.course_id === courseId));
            await database.writeTable('user_course_access', access);
            logger.info(`Course access revoked: user=${userId}, course=${courseId}`);
            return true;
        } catch (error) {
            console.error('[COURSE] Error in revokeCourseAccess:', error);
            throw error;
        }
    }

    async createCourse(data) {
        try {
            const courses = await database.readTable('courses');
            if (!Array.isArray(courses)) {
                // Если не массив, создаем новый
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
                await database.writeTable('courses', [course]);
                logger.info(`Course created: ${course.id}, title: ${course.title}`);
                return course;
            }
            
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
            await database.writeTable('courses', courses);
            
            logger.info(`Course created: ${course.id}, title: ${course.title}`);
            return course;
        } catch (error) {
            console.error('[COURSE] Error in createCourse:', error);
            throw error;
        }
    }

    async updateCourse(courseId, data) {
        try {
            const courses = await database.readTable('courses');
            if (!Array.isArray(courses)) return null;
            
            const index = courses.findIndex(c => c.id === courseId);
            if (index === -1) return null;
            
            if (data.title !== undefined) courses[index].title = data.title;
            if (data.description !== undefined) courses[index].description = data.description;
            if (data.price !== undefined) courses[index].price = parseFloat(data.price);
            if (data.imageUrl !== undefined) courses[index].image_url = data.imageUrl;
            if (data.isActive !== undefined) courses[index].is_active = data.isActive;
            if (data.orderNumber !== undefined) courses[index].order_number = parseInt(data.orderNumber);
            
            courses[index].updated_at = database.now();
            await database.writeTable('courses', courses);
            
            logger.info(`Course updated: ${courseId}`);
            return courses[index];
        } catch (error) {
            console.error('[COURSE] Error in updateCourse:', error);
            throw error;
        }
    }

    async deleteCourse(courseId) {
        try {
            let courses = await database.readTable('courses');
            let lessons = await database.readTable('lessons');
            let lessonFiles = await database.readTable('lesson_files');
            let tests = await database.readTable('tests');
            let testAnswers = await database.readTable('test_answers');
            let access = await database.readTable('user_course_access');
            
            if (!Array.isArray(courses)) courses = [];
            if (!Array.isArray(lessons)) lessons = [];
            if (!Array.isArray(lessonFiles)) lessonFiles = [];
            if (!Array.isArray(tests)) tests = [];
            if (!Array.isArray(testAnswers)) testAnswers = [];
            if (!Array.isArray(access)) access = [];
            
            // Находим уроки курса
            const courseLessons = lessons.filter(l => l.course_id === courseId);
            
            // Удаляем файлы уроков
            for (const lesson of courseLessons) {
                const files = lessonFiles.filter(f => f.lesson_id === lesson.id);
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
            
            await database.writeTable('courses', courses);
            await database.writeTable('lessons', lessons);
            await database.writeTable('lesson_files', lessonFiles);
            await database.writeTable('tests', tests);
            await database.writeTable('test_answers', testAnswers);
            await database.writeTable('user_course_access', access);
            
            logger.info(`Course deleted: ${courseId}`);
            return true;
        } catch (error) {
            console.error('[COURSE] Error in deleteCourse:', error);
            throw error;
        }
    }

    async getPaidCourses() {
        try {
            const courses = await database.readTable('courses');
            if (!Array.isArray(courses)) return [];
            return courses
                .filter(c => c.price > 0 && c.is_active !== false)
                .sort((a, b) => (a.order_number || 0) - (b.order_number || 0));
        } catch (error) {
            console.error('[COURSE] Error in getPaidCourses:', error);
            return [];
        }
    }

    async getFreeCourses() {
        try {
            const courses = await database.readTable('courses');
            if (!Array.isArray(courses)) return [];
            return courses
                .filter(c => c.price === 0 && c.is_active !== false)
                .sort((a, b) => (a.order_number || 0) - (b.order_number || 0));
        } catch (error) {
            console.error('[COURSE] Error in getFreeCourses:', error);
            return [];
        }
    }

    async getCourseStats(courseId) {
        try {
            const lessons = await this.getCourseLessons(courseId);
            const views = await database.readTable('lesson_views');
            const progress = await database.readTable('progress');
            
            if (!Array.isArray(views)) return { totalLessons: 0, totalViews: 0, completedLessons: 0, purchasers: 0 };
            if (!Array.isArray(progress)) return { totalLessons: 0, totalViews: 0, completedLessons: 0, purchasers: 0 };
            
            let totalViews = 0;
            let completedLessons = 0;
            
            for (const lesson of lessons) {
                const lessonViews = views.filter(v => v.lesson_id === lesson.id);
                totalViews += lessonViews.reduce((sum, v) => sum + (v.view_count || 0), 0);
                const completed = progress.filter(p => p.lesson_id === lesson.id && p.status === 'completed');
                completedLessons += completed.length;
            }
            
            const access = await database.readTable('user_course_access');
            const purchasers = Array.isArray(access) ? access.filter(a => a.course_id === courseId).length : 0;
            
            return {
                totalLessons: lessons.length,
                totalViews,
                completedLessons,
                purchasers,
            };
        } catch (error) {
            console.error('[COURSE] Error in getCourseStats:', error);
            return { totalLessons: 0, totalViews: 0, completedLessons: 0, purchasers: 0 };
        }
    }
}

module.exports = new CourseService();
