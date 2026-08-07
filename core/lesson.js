// core/lesson.js - ПОЛНАЯ ВЕРСИЯ С ПОДДЕРЖКОЙ VK

const database = require('../database');
const logger = require('../logger');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class LessonService {
    
    async getLessonById(lessonId) {
        const lessons = await database.readTable('lessons');
        const courses = await database.readTable('courses');
        const lesson = lessons.find(l => l.id === lessonId);
        if (!lesson) return null;
        const course = courses.find(c => c.id === lesson.course_id);
        return {
            ...lesson,
            course_title: course ? course.title : '',
        };
    }
    
    async getLessonWithFiles(lessonId) {
        try {
            const lesson = await this.getLessonById(lessonId);
            if (!lesson) return null;
            const allFiles = await database.readTable('lesson_files');
            const files = allFiles.filter(f => f.lesson_id === lessonId);
            const test = await this.getLessonTest(lessonId);
            return {
                ...lesson,
                files: files || [],
                test: test || null,
            };
        } catch (error) {
            console.error('[LESSON] getLessonWithFiles error:', error);
            return null;
        }
    }
    
    async getLessonTest(lessonId) {
        try {
            const tests = await database.readTable('tests');
            const answers = await database.readTable('test_answers');
            const test = tests.find(t => String(t.lesson_id) === String(lessonId));
            if (!test) return null;
            const testAnswers = answers
                .filter(a => String(a.test_id) === String(test.id))
                .map(a => ({
                    id: a.id,
                    answer: a.answer,
                    is_correct: a.is_correct === true,
                }));
            return {
                ...test,
                answers: testAnswers,
            };
        } catch (error) {
            console.error('[TEST] Error getting test:', error);
            return null;
        }
    }
    
    async getTestById(testId) {
        try {
            const tests = await database.readTable('tests');
            const answers = await database.readTable('test_answers');
            const test = tests.find(t => String(t.id) === String(testId));
            if (!test) return null;
            const testAnswers = answers
                .filter(a => String(a.test_id) === String(test.id))
                .map(a => ({
                    id: a.id,
                    answer: a.answer,
                    is_correct: a.is_correct === true,
                }));
            return {
                ...test,
                answers: testAnswers,
            };
        } catch (error) {
            console.error('[TEST] Error getting test by id:', error);
            return null;
        }
    }
    
    async checkTestAnswer(testId, answerId, userId) {
        try {
            const answers = await database.readTable('test_answers');
            const tests = await database.readTable('tests');
            const answer = answers.find(a => a.id === answerId);
            if (!answer) throw new Error('Ответ не найден');
            const test = tests.find(t => t.id === testId);
            if (!test) throw new Error('Тест не найден');
            const isCorrect = answer.is_correct === true;
            if (isCorrect) {
                const progress = await database.readTable('progress');
                const existing = progress.find(p => p.user_id === userId && p.lesson_id === test.lesson_id);
                if (existing) {
                    existing.status = 'completed';
                    existing.test_passed = true;
                    existing.completed_at = database.now();
                } else {
                    progress.push({
                        id: database.generateId(),
                        user_id: userId,
                        lesson_id: test.lesson_id,
                        status: 'completed',
                        test_passed: true,
                        last_position: 0,
                        completed_at: database.now(),
                    });
                }
                await database.writeTable('progress', progress);
            }
            return {
                correct: isCorrect,
                answerId: answer.id,
            };
        } catch (error) {
            console.error('[TEST] Error checking answer:', error);
            throw error;
        }
    }
    
    async createLesson(data) {
        const lessons = await database.readTable('lessons');
        const lesson = {
            id: database.generateId(),
            course_id: data.courseId,
            title: data.title,
            description: data.description || '',
            video_url: data.videoUrl || '',
            video_token: data.videoToken || '',
            order_number: parseInt(data.orderNumber) || 0,
            is_free: data.isFree || false,
            created_at: database.now(),
            updated_at: database.now(),
        };
        lessons.push(lesson);
        await database.writeTable('lessons', lessons);
        logger.info(`Lesson created: ${lesson.id}, course: ${data.courseId}`);
        return lesson;
    }
    
    async updateLesson(lessonId, data) {
        const lessons = await database.readTable('lessons');
        const index = lessons.findIndex(l => l.id === lessonId);
        if (index === -1) return null;
        if (data.title !== undefined) lessons[index].title = data.title;
        if (data.description !== undefined) lessons[index].description = data.description;
        if (data.videoUrl !== undefined) lessons[index].video_url = data.videoUrl;
        if (data.videoToken !== undefined) lessons[index].video_token = data.videoToken;
        if (data.orderNumber !== undefined) lessons[index].order_number = parseInt(data.orderNumber);
        if (data.isFree !== undefined) lessons[index].is_free = data.isFree;
        lessons[index].updated_at = database.now();
        await database.writeTable('lessons', lessons);
        logger.info(`Lesson updated: ${lessonId}`);
        return lessons[index];
    }
    
    async deleteLesson(lessonId) {
        let lessons = await database.readTable('lessons');
        let files = await database.readTable('lesson_files');
        let tests = await database.readTable('tests');
        let answers = await database.readTable('test_answers');
        let progress = await database.readTable('progress');
        let views = await database.readTable('lesson_views');
        
        const lessonFiles = files.filter(f => f.lesson_id === lessonId);
        for (const file of lessonFiles) {
            try {
                if (file.path && fs.existsSync(file.path) && !file.is_max_uploaded) {
                    fs.unlinkSync(file.path);
                }
            } catch (e) {
                logger.warn(`Failed to delete file: ${file.path}`, e.message);
            }
        }
        
        const test = tests.find(t => t.lesson_id === lessonId);
        if (test) {
            answers = answers.filter(a => a.test_id !== test.id);
            tests = tests.filter(t => t.id !== test.id);
        }
        
        files = files.filter(f => f.lesson_id !== lessonId);
        progress = progress.filter(p => p.lesson_id !== lessonId);
        views = views.filter(v => v.lesson_id !== lessonId);
        lessons = lessons.filter(l => l.id !== lessonId);
        
        await database.writeTable('lessons', lessons);
        await database.writeTable('lesson_files', files);
        await database.writeTable('tests', tests);
        await database.writeTable('test_answers', answers);
        await database.writeTable('progress', progress);
        await database.writeTable('lesson_views', views);
        
        logger.info(`Lesson deleted: ${lessonId}`);
        return true;
    }
    
    async getLessonsByCourse(courseId) {
        const lessons = await database.readTable('lessons');
        return lessons
            .filter(l => l.course_id === courseId)
            .sort((a, b) => a.order_number - b.order_number);
    }
    
    // ============================================================
    // ОБНОВЛЕННЫЙ МЕТОД addLessonFile С ПОДДЕРЖКОЙ VK
    // ============================================================
    
    async addLessonFile(lessonId, fileData) {
        try {
            const files = await database.readTable('lesson_files');
            
            let fileHash = '';
            if (fileData.path && !fileData.is_max_uploaded && fs.existsSync(fileData.path)) {
                try {
                    const fileBuffer = fs.readFileSync(fileData.path);
                    fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
                } catch (e) {
                    console.warn('[LESSON] Could not hash file:', e.message);
                }
            }
            
            let fileType = fileData.type || 'file';
            if (!fileType || fileType === 'file') {
                if (fileData.mimetype && fileData.mimetype.startsWith('video/')) fileType = 'video';
                else if (fileData.mimetype && fileData.mimetype.startsWith('image/')) fileType = 'image';
            }
            
            const isMaxUploaded = fileData.is_max_uploaded || !!fileData.token;
            
            // 👇 РАСШИРЕННЫЙ ОБЪЕКТ С ПОДДЕРЖКОЙ VK
            const file = {
                id: database.generateId(),
                lesson_id: lessonId,
                type: fileType,
                filename: fileData.filename || 'file',
                original_name: fileData.originalname || fileData.filename || 'file',
                size: fileData.size || 0,
                mime_type: fileData.mimetype || 'application/octet-stream',
                path: fileData.path || fileData.token || '',
                url: fileData.url || null,
                token: fileData.token || null,
                // 👇 НОВЫЕ ПОЛЯ ДЛЯ VK
                vk_owner_id: fileData.vk_owner_id || null,
                vk_video_id: fileData.vk_video_id || null,
                vk_access_key: fileData.vk_access_key || null,
                is_max_uploaded: isMaxUploaded,
                hash: fileHash,
                duration: fileData.duration || null,
                created_at: database.now(),
            };
            
            files.push(file);
            await database.writeTable('lesson_files', files);
            console.log(`[LESSON] ✅ File added: ${fileData.filename} (${fileType}) to lesson ${lessonId}`);
            return file;
        } catch (error) {
            console.error('[LESSON] Failed to add lesson file:', error);
            throw error;
        }
    }
    
    async getLessonFiles(lessonId) {
        try {
            const files = await database.readTable('lesson_files');
            return files.filter(f => f.lesson_id === lessonId);
        } catch (error) {
            logger.error({ err: error, lessonId }, 'Failed to get lesson files');
            return [];
        }
    }
    
    async deleteLessonFile(fileId) {
        try {
            let files = await database.readTable('lesson_files');
            const file = files.find(f => f.id === fileId);
            if (file) {
                if (file.path && fs.existsSync(file.path) && !file.is_max_uploaded) {
                    try { fs.unlinkSync(file.path); } catch (e) {}
                }
                files = files.filter(f => f.id !== fileId);
                await database.writeTable('lesson_files', files);
                return true;
            }
            return false;
        } catch (error) {
            logger.error({ err: error, fileId }, 'Failed to delete lesson file');
            throw error;
        }
    }
    
    async createTest(lessonId, testData) {
        let tests = await database.readTable('tests');
        let answers = await database.readTable('test_answers');
        
        const existingTest = tests.find(t => t.lesson_id === lessonId);
        if (existingTest) {
            answers = answers.filter(a => a.test_id !== existingTest.id);
            tests = tests.filter(t => t.id !== existingTest.id);
        }
        
        const test = {
            id: database.generateId(),
            lesson_id: lessonId,
            question: testData.question || 'Проверьте свои знания',
        };
        tests.push(test);
        
        let addedCount = 0;
        for (const answer of testData.answers || []) {
            if (answer.text && answer.text.trim()) {
                answers.push({
                    id: database.generateId(),
                    test_id: test.id,
                    answer: answer.text.trim(),
                    is_correct: answer.isCorrect || false,
                });
                addedCount++;
            }
        }
        
        await database.writeTable('tests', tests);
        await database.writeTable('test_answers', answers);
        logger.info(`Test created for lesson: ${lessonId}, answers: ${addedCount}`);
        return {
            ...test,
            answers: answers.filter(a => a.test_id === test.id),
        };
    }
    
    async updateTest(testId, testData) {
        try {
            let tests = await database.readTable('tests');
            let answers = await database.readTable('test_answers');
            
            const testIndex = tests.findIndex(t => t.id === testId);
            if (testIndex === -1) throw new Error('Test not found');
            
            tests[testIndex].question = testData.question || tests[testIndex].question;
            
            // Удаляем старые ответы
            answers = answers.filter(a => a.test_id !== testId);
            
            // Добавляем новые
            let addedCount = 0;
            for (const answer of testData.answers || []) {
                if (answer.text && answer.text.trim()) {
                    answers.push({
                        id: database.generateId(),
                        test_id: testId,
                        answer: answer.text.trim(),
                        is_correct: answer.isCorrect || false,
                    });
                    addedCount++;
                }
            }
            
            await database.writeTable('tests', tests);
            await database.writeTable('test_answers', answers);
            logger.info(`Test updated: ${testId}, answers: ${addedCount}`);
            return {
                ...tests[testIndex],
                answers: answers.filter(a => a.test_id === testId),
            };
        } catch (error) {
            logger.error({ err: error, testId }, 'Failed to update test');
            throw error;
        }
    }
    
    async deleteTest(testId) {
        try {
            let tests = await database.readTable('tests');
            let answers = await database.readTable('test_answers');
            
            answers = answers.filter(a => a.test_id !== testId);
            tests = tests.filter(t => t.id !== testId);
            
            await database.writeTable('tests', tests);
            await database.writeTable('test_answers', answers);
            logger.info(`Test deleted: ${testId}`);
            return true;
        } catch (error) {
            logger.error({ err: error, testId }, 'Failed to delete test');
            throw error;
        }
    }
    
    async getFreeLessons() {
        const lessons = await database.readTable('lessons');
        const files = await database.readTable('lesson_files');
        const freeLessons = lessons.filter(l => l.is_free === true);
        return freeLessons.map(l => ({
            ...l,
            files: files.filter(f => f.lesson_id === l.id),
        })).sort((a, b) => (a.order_number || 0) - (b.order_number || 0));
    }
    
    async getAllLessons() {
        const lessons = await database.readTable('lessons');
        const files = await database.readTable('lesson_files');
        return lessons.map(l => ({
            ...l,
            files: files.filter(f => f.lesson_id === l.id),
        })).sort((a, b) => (a.order_number || 0) - (b.order_number || 0));
    }
}

module.exports = new LessonService();
