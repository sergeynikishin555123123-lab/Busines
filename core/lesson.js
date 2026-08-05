// core/lesson.js
// УПРАВЛЕНИЕ УРОКАМИ

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

   // core/lesson.js - ИСПРАВЛЕННЫЙ МЕТОД getLessonWithFiles

async getLessonWithFiles(lessonId) {
    try {
        const lesson = await this.getLessonById(lessonId);
        if (!lesson) return null;

        // Получаем все файлы урока
        const allFiles = database.readTable('lesson_files');
        const files = allFiles.filter(f => f.lesson_id === lessonId);
        
        console.log(`[LESSON] Found ${files.length} files for lesson ${lessonId}`);

        // Получаем тест
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
        const tests = database.readTable('tests');
        const answers = database.readTable('test_answers');

        // Если передан lessonId, ищем тест для урока
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

    // НОВЫЙ МЕТОД - получение теста по ID
    async getTestById(testId) {
        const tests = database.readTable('tests');
        const answers = database.readTable('test_answers');

        const test = tests.find(t => t.id === testId);
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

    async checkTestAnswer(testId, answerId, userId) {
        const answers = database.readTable('test_answers');
        const tests = database.readTable('tests');

        const answer = answers.find(a => a.id === answerId);
        if (!answer) {
            throw new Error('Ответ не найден');
        }

        const test = tests.find(t => t.id === testId);
        if (!test) {
            throw new Error('Тест не найден');
        }

        const isCorrect = answer.is_correct === true;

        if (isCorrect) {
            const progress = database.readTable('progress');
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
            database.writeTable('progress', progress);
        }

        return {
            correct: isCorrect,
            answerId: answer.id,
        };
    }

    async recordLessonView(userId, lessonId) {
        const views = database.readTable('lesson_views');
        const existing = views.find(v => v.user_id === userId && v.lesson_id === lessonId);

        if (existing) {
            existing.view_count = (existing.view_count || 0) + 1;
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

        // Обновляем прогресс
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
            video_token: data.videoToken || '',
            order_number: parseInt(data.orderNumber) || 0,
            is_free: data.isFree || false,
            created_at: database.now(),
            updated_at: database.now(),
        };

        lessons.push(lesson);
        database.writeTable('lessons', lessons);
        logger.info(`Lesson created: ${lesson.id}, course: ${data.courseId}`);
        return lesson;
    }

    async updateLesson(lessonId, data) {
        const lessons = database.readTable('lessons');
        const index = lessons.findIndex(l => l.id === lessonId);

        if (index === -1) return null;

        if (data.title !== undefined) lessons[index].title = data.title;
        if (data.description !== undefined) lessons[index].description = data.description;
        if (data.videoUrl !== undefined) lessons[index].video_url = data.videoUrl;
        if (data.videoToken !== undefined) lessons[index].video_token = data.videoToken;
        if (data.orderNumber !== undefined) lessons[index].order_number = parseInt(data.orderNumber);
        if (data.isFree !== undefined) lessons[index].is_free = data.isFree;

        lessons[index].updated_at = database.now();
        database.writeTable('lessons', lessons);
        logger.info(`Lesson updated: ${lessonId}`);
        return lessons[index];
    }

    async deleteLesson(lessonId) {
        let lessons = database.readTable('lessons');
        let files = database.readTable('lesson_files');
        let tests = database.readTable('tests');
        let answers = database.readTable('test_answers');
        let progress = database.readTable('progress');
        let views = database.readTable('lesson_views');

        // Удаляем файлы
        const lessonFiles = files.filter(f => f.lesson_id === lessonId);
        for (const file of lessonFiles) {
            try {
                const storageService = require('../services/storage');
                await storageService.deleteFile(file.url);
            } catch (e) {
                logger.warn(`Failed to delete file: ${file.url}`, e.message);
            }
        }

        // Удаляем тест
        const test = tests.find(t => t.lesson_id === lessonId);
        if (test) {
            answers = answers.filter(a => a.test_id !== test.id);
            tests = tests.filter(t => t.id !== test.id);
        }

        // Удаляем связанные данные
        files = files.filter(f => f.lesson_id !== lessonId);
        progress = progress.filter(p => p.lesson_id !== lessonId);
        views = views.filter(v => v.lesson_id !== lessonId);
        lessons = lessons.filter(l => l.id !== lessonId);

        database.writeTable('lessons', lessons);
        database.writeTable('lesson_files', files);
        database.writeTable('tests', tests);
        database.writeTable('test_answers', answers);
        database.writeTable('progress', progress);
        database.writeTable('lesson_views', views);

        logger.info(`Lesson deleted: ${lessonId}`);
        return true;
    }

    async addLessonFile(lessonId, fileData) {
        const files = database.readTable('lesson_files');

        const file = {
            id: database.generateId(),
            lesson_id: lessonId,
            filename: fileData.filename,
            url: fileData.url,
            type: fileData.type || 'application/octet-stream',
            size: fileData.size || 0,
            created_at: database.now(),
        };

        files.push(file);
        database.writeTable('lesson_files', files);
        logger.info(`File added to lesson: ${lessonId}, file: ${fileData.filename}`);
        return file;
    }

    async deleteLessonFile(fileId) {
        let files = database.readTable('lesson_files');
        const file = files.find(f => f.id === fileId);

        if (file) {
            try {
                const storageService = require('../services/storage');
                await storageService.deleteFile(file.url);
            } catch (e) {
                logger.warn(`Failed to delete file: ${file.url}`, e.message);
            }
            files = files.filter(f => f.id !== fileId);
            database.writeTable('lesson_files', files);
            logger.info(`File deleted: ${fileId}`);
        }
        return true;
    }

    async createTest(lessonId, testData) {
        let tests = database.readTable('tests');
        let answers = database.readTable('test_answers');

        // Удаляем существующий тест
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

        for (const answer of testData.answers || []) {
            if (answer.text && answer.text.trim()) {
                answers.push({
                    id: database.generateId(),
                    test_id: test.id,
                    answer: answer.text.trim(),
                    is_correct: answer.isCorrect || false,
                });
            }
        }

        database.writeTable('tests', tests);
        database.writeTable('test_answers', answers);
        logger.info(`Test created for lesson: ${lessonId}, answers: ${answers.length}`);
        return test;
    }

    async updateTest(testId, testData) {
        let tests = database.readTable('tests');
        let answers = database.readTable('test_answers');

        const testIndex = tests.findIndex(t => t.id === testId);
        if (testIndex === -1) return null;

        // Обновляем вопрос
        if (testData.question !== undefined) {
            tests[testIndex].question = testData.question;
        }

        // Обновляем ответы
        if (testData.answers) {
            // Удаляем старые ответы
            answers = answers.filter(a => a.test_id !== testId);

            // Добавляем новые
            for (const answer of testData.answers) {
                if (answer.text && answer.text.trim()) {
                    answers.push({
                        id: database.generateId(),
                        test_id: testId,
                        answer: answer.text.trim(),
                        is_correct: answer.isCorrect || false,
                    });
                }
            }
        }

        database.writeTable('tests', tests);
        database.writeTable('test_answers', answers);
        logger.info(`Test updated: ${testId}`);
        return tests[testIndex];
    }

    async deleteTest(testId) {
        let tests = database.readTable('tests');
        let answers = database.readTable('test_answers');

        const test = tests.find(t => t.id === testId);
        if (!test) return false;

        answers = answers.filter(a => a.test_id !== testId);
        tests = tests.filter(t => t.id !== testId);

        database.writeTable('tests', tests);
        database.writeTable('test_answers', answers);
        logger.info(`Test deleted: ${testId}`);
        return true;
    }

    async updateProgressPosition(userId, lessonId, position) {
        const progress = database.readTable('progress');
        const item = progress.find(p => p.user_id === userId && p.lesson_id === lessonId);

        if (item) {
            item.last_position = position;
            database.writeTable('progress', progress);
            return true;
        }
        return false;
    }

    async getLessonViewsStats(lessonId) {
        const views = database.readTable('lesson_views');
        const lessonViews = views.filter(v => v.lesson_id === lessonId);

        return {
            totalViews: lessonViews.reduce((sum, v) => sum + (v.view_count || 1), 0),
            uniqueViewers: lessonViews.length,
            lastViewed: lessonViews.length > 0
                ? lessonViews.sort((a, b) => new Date(b.last_viewed_at) - new Date(a.last_viewed_at))[0].last_viewed_at
                : null,
        };
    }

    async getLessonsByCourse(courseId) {
        const lessons = database.readTable('lessons');
        return lessons
            .filter(l => l.course_id === courseId)
            .sort((a, b) => a.order_number - b.order_number);
    }

    // Получение следующего и предыдущего урока
    async getAdjacentLessons(lessonId) {
        const lesson = await this.getLessonById(lessonId);
        if (!lesson) return { prev: null, next: null };

        const lessons = await this.getLessonsByCourse(lesson.course_id);
        const currentIndex = lessons.findIndex(l => l.id === lessonId);

        return {
            prev: currentIndex > 0 ? lessons[currentIndex - 1] : null,
            next: currentIndex < lessons.length - 1 ? lessons[currentIndex + 1] : null,
        };
    }
    
 // ============================================================
    // СОХРАНЕНИЕ ИНФОРМАЦИИ О ФАЙЛЕ
    // ============================================================
    async addLessonFile(lessonId, fileData) {
        try {
            const files = database.readTable('lesson_files');

            // Вычисляем хэш файла
            let fileHash = '';
            if (fileData.path && fs.existsSync(fileData.path)) {
                const fileBuffer = fs.readFileSync(fileData.path);
                fileHash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
            }

            // Определяем тип файла
            let fileType = 'file';
            if (fileData.mimetype && fileData.mimetype.startsWith('video/')) {
                fileType = 'video';
            } else if (fileData.mimetype && fileData.mimetype.startsWith('image/')) {
                fileType = 'image';
            }

            // Получаем длительность видео (если это видео)
            let duration = null;
            if (fileType === 'video' && fileData.path && fs.existsSync(fileData.path)) {
                try {
                    // Используем ffprobe для получения длительности
                    const { execSync } = require('child_process');
                    const result = execSync(`ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${fileData.path}"`, {
                        timeout: 10000
                    });
                    duration = parseFloat(result.toString().trim());
                } catch (e) {
                    console.warn('[LESSON] Could not get video duration:', e.message);
                }
            }

            const file = {
                id: database.generateId(),
                lesson_id: lessonId,
                type: fileType,
                filename: fileData.filename,
                original_name: fileData.originalname || fileData.filename,
                size: fileData.size || 0,
                mime_type: fileData.mimetype || 'application/octet-stream',
                path: fileData.path || fileData.url,
                url: fileData.url,
                hash: fileHash,
                duration: duration,
                created_at: database.now(),
            };

            files.push(file);
            database.writeTable('lesson_files', files);
            logger.info(`[LESSON] File added: ${fileData.filename} (${fileType}) to lesson ${lessonId}`);
            return file;

        } catch (error) {
            logger.error({ err: error, lessonId, fileData }, 'Failed to add lesson file');
            throw error;
        }
    }

    // ============================================================
    // ПОЛУЧЕНИЕ ФАЙЛОВ УРОКА
    // ============================================================
    async getLessonFiles(lessonId) {
        try {
            const files = database.readTable('lesson_files');
            return files.filter(f => f.lesson_id === lessonId);
        } catch (error) {
            logger.error({ err: error, lessonId }, 'Failed to get lesson files');
            return [];
        }
    }

    // ============================================================
    // УДАЛЕНИЕ ФАЙЛА
    // ============================================================
    async deleteLessonFile(fileId) {
        try {
            let files = database.readTable('lesson_files');
            const file = files.find(f => f.id === fileId);

            if (file) {
                // Удаляем физический файл
                if (file.path && fs.existsSync(file.path)) {
                    try {
                        fs.unlinkSync(file.path);
                        logger.info(`[LESSON] Deleted file: ${file.path}`);
                    } catch (e) {
                        logger.warn(`[LESSON] Could not delete file: ${file.path}`, e.message);
                    }
                }

                files = files.filter(f => f.id !== fileId);
                database.writeTable('lesson_files', files);
                logger.info(`[LESSON] File record deleted: ${fileId}`);
                return true;
            }

            return false;

        } catch (error) {
            logger.error({ err: error, fileId }, 'Failed to delete lesson file');
            throw error;
        }
    }

    // ============================================================
    // ОТПРАВКА УРОКА ПОЛЬЗОВАТЕЛЮ (ВИДЕО + ФАЙЛЫ + ТЕСТ)
    // ============================================================
    async sendLessonToUser(lessonId, userId, maxApi) {
        try {
            const lesson = await this.getLessonWithFiles(lessonId);
            if (!lesson) {
                throw new Error('Lesson not found');
            }

            const chatId = userId;

            // 1. Отправляем видео (если есть)
            const videoFile = lesson.files?.find(f => f.type === 'video');
            if (videoFile && videoFile.path && fs.existsSync(videoFile.path)) {
                try {
                    console.log(`[LESSON] Sending video to ${userId}...`);
                    await maxApi.sendVideo({
                        chatId: chatId,
                        videoPath: videoFile.path,
                        caption: `🎬 **${lesson.title}**\n\n${lesson.description || ''}`,
                        parseMode: 'markdown',
                    });
                    console.log(`[LESSON] Video sent to ${userId}`);
                } catch (error) {
                    console.error(`[LESSON] Failed to send video to ${userId}:`, error.message);
                    // Отправляем сообщение об ошибке
                    await maxApi.sendMessage({
                        chatId: chatId,
                        text: `⚠️ Не удалось отправить видео. Пожалуйста, попробуйте позже.`,
                        parseMode: 'markdown',
                    });
                }
            }

            // 2. Отправляем файлы (кроме видео)
            const otherFiles = lesson.files?.filter(f => f.type !== 'video') || [];
            for (const file of otherFiles) {
                if (file.path && fs.existsSync(file.path)) {
                    try {
                        console.log(`[LESSON] Sending file to ${userId}: ${file.original_name}`);
                        await maxApi.sendFile({
                            chatId: chatId,
                            filePath: file.path,
                            caption: `📎 **${file.original_name}**\n\nФайл к уроку: ${lesson.title}`,
                            parseMode: 'markdown',
                        });
                        console.log(`[LESSON] File sent to ${userId}`);
                    } catch (error) {
                        console.error(`[LESSON] Failed to send file to ${userId}:`, error.message);
                    }
                }
            }

            // 3. Отправляем описание урока (если нет видео)
            if (!videoFile) {
                await maxApi.sendMessage({
                    chatId: chatId,
                    text: `📖 **${lesson.title}**\n\n${lesson.description || 'Нет описания'}`,
                    parseMode: 'markdown',
                });
            }

            // 4. Отправляем кнопку "Проверить себя" (если есть тест)
            const test = await this.getLessonTest(lessonId);
            if (test) {
                const buttons = [
                    [
                        { type: 'callback', text: '✅ Проверить себя', payload: `test_${test.id}` },
                        { type: 'callback', text: '📚 Назад к курсу', payload: `course_${lesson.course_id}` },
                    ]
                ];

                await maxApi.sendKeyboard({
                    chatId: chatId,
                    text: `📝 **Готов проверить знания?**\n\nПройти тест по уроку "${lesson.title}"`,
                    buttons: buttons,
                    parseMode: 'markdown',
                });
            } else {
                // Если теста нет - просто кнопка назад
                const buttons = [
                    [
                        { type: 'callback', text: '📚 Назад к курсу', payload: `course_${lesson.course_id}` },
                    ]
                ];

                await maxApi.sendKeyboard({
                    chatId: chatId,
                    text: `✅ Урок завершён!`,
                    buttons: buttons,
                    parseMode: 'markdown',
                });
            }

            return true;

        } catch (error) {
            logger.error({ err: error, lessonId, userId }, 'Failed to send lesson to user');
            throw error;
        }
    }
}

module.exports = new LessonService();
