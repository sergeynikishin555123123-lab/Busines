// core/course.js - ИСПРАВЛЕННАЯ ВЕРСИЯ С ПОДДЕРЖКОЙ PLATFORM

const database = require('../database');
const logger = require('../logger');

class CourseService {

    async _ensureArray(tableName) {
        let data = await database.readTable(tableName);
        if (!Array.isArray(data)) {
            console.log(`[COURSE] ${tableName} is not an array, reinitializing...`);
            data = [];
            await database.writeTable(tableName, data);
        }
        return data;
    }

    async getAllCourses(activeOnly = false) {
        try {
            let courses = await this._ensureArray('courses');
            const filtered = activeOnly ? courses.filter(c => c.is_active !== false) : courses;
            return filtered.sort((a, b) => (a.order_number || 0) - (b.order_number || 0));
        } catch (error) {
            console.error('[COURSE] Error in getAllCourses:', error);
            return [];
        }
    }
    
    async getCourseById(courseId) {
        try {
            const courses = await this._ensureArray('courses');
            return courses.find(c => c.id === courseId) || null;
        } catch (error) {
            console.error('[COURSE] Error in getCourseById:', error);
            return null;
        }
    }

    async getCourseLessons(courseId) {
        try {
            const lessons = await this._ensureArray('lessons');
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
            const lessons = await this._ensureArray('lessons');
            const courses = await this._ensureArray('courses');
            
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
            const lessons = await this._ensureArray('lessons');
            const courses = await this._ensureArray('courses');
            
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
            const access = await this._ensureArray('user_course_access');
            const courses = await this._ensureArray('courses');
            
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
            const access = await this._ensureArray('user_course_access');
            return access.some(a => a.user_id === userId && a.course_id === courseId);
        } catch (error) {
            console.error('[COURSE] Error in checkUserCourseAccess:', error);
            return false;
        }
    }

    async grantCourseAccess(userId, courseId) {
        try {
            const access = await this._ensureArray('user_course_access');
            
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
            let access = await this._ensureArray('user_course_access');
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
            const courses = await this._ensureArray('courses');
            
            const course = {
                id: database.generateId(),
                title: data.title,
                description: data.description || '',
                price: parseFloat(data.price) || 0,
                image_url: data.imageUrl || '',
                is_active: data.isActive !== undefined ? data.isActive : true,
                order_number: parseInt(data.orderNumber) || 0,
                platform: data.platform || 'max',
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
            const courses = await this._ensureArray('courses');
            
            const index = courses.findIndex(c => c.id === courseId);
            if (index === -1) return null;
            
            if (data.title !== undefined) courses[index].title = data.title;
            if (data.description !== undefined) courses[index].description = data.description;
            if (data.price !== undefined) courses[index].price = parseFloat(data.price);
            if (data.imageUrl !== undefined) courses[index].image_url = data.imageUrl;
            if (data.isActive !== undefined) courses[index].is_active = data.isActive;
            if (data.orderNumber !== undefined) courses[index].order_number = parseInt(data.orderNumber);
            if (data.platform !== undefined) courses[index].platform = data.platform;
            
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
            let courses = await this._ensureArray('courses');
            let lessons = await this._ensureArray('lessons');
            let lessonFiles = await this._ensureArray('lesson_files');
            let tests = await this._ensureArray('tests');
            let testAnswers = await this._ensureArray('test_answers');
            let access = await this._ensureArray('user_course_access');
            
            const courseLessons = lessons.filter(l => l.course_id === courseId);
            
            for (const lesson of courseLessons) {
                const files = lessonFiles.filter(f => f.lesson_id === lesson.id);
                lessonFiles = lessonFiles.filter(f => f.lesson_id !== lesson.id);
                
                const test = tests.find(t => t.lesson_id === lesson.id);
                if (test) {
                    testAnswers = testAnswers.filter(a => a.test_id !== test.id);
                    tests = tests.filter(t => t.id !== test.id);
                }
            }
            
            lessons = lessons.filter(l => l.course_id !== courseId);
            access = access.filter(a => a.course_id !== courseId);
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
            const courses = await this._ensureArray('courses');
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
            const courses = await this._ensureArray('courses');
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
            const views = await this._ensureArray('lesson_views');
            const progress = await this._ensureArray('progress');
            
            let totalViews = 0;
            let completedLessons = 0;
            
            for (const lesson of lessons) {
                const lessonViews = views.filter(v => v.lesson_id === lesson.id);
                totalViews += lessonViews.reduce((sum, v) => sum + (v.view_count || 0), 0);
                const completed = progress.filter(p => p.lesson_id === lesson.id && p.status === 'completed');
                completedLessons += completed.length;
            }
            
            const access = await this._ensureArray('user_course_access');
            const purchasers = access.filter(a => a.course_id === courseId).length;
            
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
