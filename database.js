// database.js - ПОЛНАЯ ПРОДАКШЕН ВЕРСИЯ С POSTGRESQL + VK ПОЛЯ + PLATFORM

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = process.env.DATA_DIR || '/tmp/data';

// PostgreSQL клиент
let pgClient = null;
let pgConnected = false;

// Создаём директорию для JSON (как fallback)
try {
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
} catch (error) {
    console.error(`[DB] Cannot create ${DATA_DIR}:`, error.message);
}

// ============================================================
// УСТАНОВКА POSTGRESQL КЛИЕНТА
// ============================================================

function setPGClient(client, connected) {
    pgClient = client;
    pgConnected = connected;
    console.log('[DB] PostgreSQL client set:', connected ? '✅ connected' : '⚠️ fallback');
}

// ============================================================
// БАЗОВЫЕ МЕТОДЫ
// ============================================================

function getTablePath(tableName) {
    return path.join(DATA_DIR, `${tableName}.json`);
}

function initDatabase() {
    const tables = {
        users: [],
        admins: [],
        bot_settings: [
            { key: 'bot_name', value: 'Обучающий бот' },
            { key: 'support_contact', value: '@support' },
        ],
        courses: [],
        lessons: [],
        lesson_files: [],
        tests: [],
        test_answers: [],
        progress: [],
        lesson_views: [],
        user_course_access: [],
        payments: [],
        notifications: [],
        user_actions: [],
    };

    for (const [tableName, defaultValue] of Object.entries(tables)) {
        const filePath = getTablePath(tableName);
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
        }
    }
}

function generateId() {
    return uuidv4();
}

function now() {
    return new Date().toISOString();
}

// ============================================================
// МАППИНГ ТАБЛИЦ
// ============================================================

const TABLE_MAP = {
    'users': 'users',
    'admins': 'admins',
    'courses': 'courses',
    'lessons': 'lessons',
    'lesson_files': 'lesson_files',
    'tests': 'tests',
    'test_answers': 'test_answers',
    'progress': 'progress',
    'lesson_views': 'lesson_views',
    'user_course_access': 'user_course_access',
    'payments': 'payments',
    'notifications': 'notifications',
    'user_actions': 'user_actions',
};

// ============================================================
// ПОЛУЧЕНИЕ КОЛОНОК ДЛЯ ТАБЛИЦЫ (для PostgreSQL)
// ============================================================

function getTableColumns(tableName) {
    // Определяем колонки для каждой таблицы
    const columns = {
        users: ['id', 'platform_user_id', 'platform', 'first_name', 'last_name', 'username', 'chat_id', 'email', 'phone', 'created_at', 'updated_at'],
        admins: ['id', 'login', 'password_hash', 'role', 'platform_user_id', 'created_at'],
        courses: ['id', 'title', 'description', 'price', 'image_url', 'is_active', 'order_number', 'platform', 'created_at', 'updated_at'],
        lessons: ['id', 'course_id', 'title', 'description', 'video_url', 'video_token', 'order_number', 'is_free', 'platform', 'created_at', 'updated_at'],
        lesson_files: ['id', 'lesson_id', 'type', 'filename', 'original_name', 'size', 'mime_type', 'path', 'url', 'token', 'vk_owner_id', 'vk_video_id', 'vk_access_key', 'is_max_uploaded', 'hash', 'duration', 'platform', 'created_at'],
        tests: ['id', 'lesson_id', 'question', 'created_at'],
        test_answers: ['id', 'test_id', 'answer', 'is_correct', 'created_at'],
        progress: ['id', 'user_id', 'lesson_id', 'status', 'test_passed', 'last_position', 'completed_at', 'created_at', 'updated_at'],
        lesson_views: ['id', 'user_id', 'lesson_id', 'view_count', 'first_viewed_at', 'last_viewed_at'],
        user_course_access: ['id', 'user_id', 'course_id', 'granted_at', 'expires_at'],
        payments: ['id', 'user_id', 'amount', 'currency', 'status', 'payment_gateway', 'gateway_payment_id', 'gateway_payment_url', 'meta_data', 'created_at', 'updated_at'],
        notifications: ['id', 'user_id', 'type', 'title', 'message', 'is_read', 'data', 'created_at'],
        user_actions: ['id', 'user_id', 'action', 'data', 'created_at'],
    };
    return columns[tableName] || [];
}

// ============================================================
// ЧТЕНИЕ ДАННЫХ (с приоритетом PostgreSQL)
// ============================================================

async function readTable(tableName) {
    // Если PostgreSQL доступен - читаем из него
    if (pgConnected && pgClient) {
        try {
            const realTable = TABLE_MAP[tableName] || tableName;
            const result = await pgClient.query(`SELECT * FROM ${realTable}`);
            return result.rows;
        } catch (error) {
            console.error(`[DB] PG read error ${tableName}:`, error.message);
            // Fallback на JSON
            return readTableJSON(tableName);
        }
    }
    return readTableJSON(tableName);
}

function readTableJSON(tableName) {
    const filePath = getTablePath(tableName);
    try {
        const data = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        console.error(`[DB] JSON read error ${tableName}:`, error.message);
        return [];
    }
}

// ============================================================
// ЗАПИСЬ ДАННЫХ (с приоритетом PostgreSQL)
// ============================================================

async function writeTable(tableName, data) {
    // Если PostgreSQL доступен - пишем в него
    if (pgConnected && pgClient) {
        try {
            await writeTablePG(tableName, data);
            return true;
        } catch (error) {
            console.error(`[DB] PG write error ${tableName}:`, error.message);
            // Fallback на JSON
            writeTableJSON(tableName, data);
            return false;
        }
    }
    writeTableJSON(tableName, data);
    return true;
}

function writeTableJSON(tableName, data) {
    const filePath = getTablePath(tableName);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

// ============================================================
// ЗАПИСЬ В POSTGRESQL (с UPSERT)
// ============================================================

async function writeTablePG(tableName, data) {
    const realTable = TABLE_MAP[tableName] || tableName;
    
    if (!data || data.length === 0) {
        // Если данных нет - очищаем таблицу
        await pgClient.query(`TRUNCATE ${realTable} RESTART IDENTITY CASCADE`);
        return;
    }

    // Получаем колонки для этой таблицы
    const columns = getTableColumns(realTable);
    if (columns.length === 0) {
        // Если колонки не определены, используем ключи из первой записи
        const keys = Object.keys(data[0]);
        await writeTablePGFallback(realTable, data, keys);
        return;
    }

    // Фильтруем данные только по существующим колонкам
    const filteredData = data.map(row => {
        const filtered = {};
        for (const col of columns) {
            if (row[col] !== undefined) {
                filtered[col] = row[col];
            }
        }
        return filtered;
    });

    if (filteredData.length === 0) {
        await pgClient.query(`TRUNCATE ${realTable} RESTART IDENTITY CASCADE`);
        return;
    }

    const columnNames = columns.join(', ');
    
    // Создаем временную таблицу для данных
    const tempTable = `temp_${realTable}_${Date.now()}`;
    
    // Создаем временную таблицу с такой же структурой
    await pgClient.query(`CREATE TEMP TABLE ${tempTable} (LIKE ${realTable} INCLUDING ALL)`);
    
    // Вставляем данные во временную таблицу
    for (const row of filteredData) {
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
        const values = columns.map(col => row[col] !== undefined ? row[col] : null);
        await pgClient.query(
            `INSERT INTO ${tempTable} (${columnNames}) VALUES (${placeholders})`,
            values
        );
    }
    
    // Очищаем основную таблицу
    await pgClient.query(`TRUNCATE ${realTable} RESTART IDENTITY CASCADE`);
    
    // Копируем данные из временной таблицы в основную
    await pgClient.query(`
        INSERT INTO ${realTable} (${columnNames})
        SELECT ${columnNames} FROM ${tempTable}
    `);
    
    // Удаляем временную таблицу
    await pgClient.query(`DROP TABLE ${tempTable}`);
}

// ============================================================
// FALLBACK ЗАПИСЬ В POSTGRESQL (если колонки не определены)
// ============================================================

async function writeTablePGFallback(tableName, data, columns) {
    if (!data || data.length === 0) {
        await pgClient.query(`TRUNCATE ${tableName} RESTART IDENTITY CASCADE`);
        return;
    }

    const columnNames = columns.join(', ');
    const tempTable = `temp_${tableName}_${Date.now()}`;
    
    // Создаем временную таблицу
    const createColumns = columns.map(col => `${col} TEXT`).join(', ');
    await pgClient.query(`CREATE TEMP TABLE ${tempTable} (${createColumns})`);
    
    // Вставляем данные
    for (const row of data) {
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
        const values = columns.map(col => row[col] !== undefined ? String(row[col]) : null);
        await pgClient.query(
            `INSERT INTO ${tempTable} (${columnNames}) VALUES (${placeholders})`,
            values
        );
    }
    
    // Очищаем основную таблицу
    await pgClient.query(`TRUNCATE ${tableName} RESTART IDENTITY CASCADE`);
    
    // Копируем данные
    await pgClient.query(`
        INSERT INTO ${tableName} (${columnNames})
        SELECT ${columnNames} FROM ${tempTable}
    `);
    
    await pgClient.query(`DROP TABLE ${tempTable}`);
}

// ============================================================
// ПРЯМЫЕ SQL ЗАПРОСЫ (для сложных операций)
// ============================================================

async function query(sql, params = []) {
    if (pgConnected && pgClient) {
        try {
            const result = await pgClient.query(sql, params);
            return result;
        } catch (error) {
            console.error('[DB] Query error:', error.message);
            return { rows: [], rowCount: 0 };
        }
    }
    return { rows: [], rowCount: 0 };
}

async function getClient() {
    if (pgConnected && pgClient) {
        return {
            query: async (sql, params) => {
                try {
                    return await pgClient.query(sql, params);
                } catch (error) {
                    console.error('[DB] Client query error:', error.message);
                    return { rows: [], rowCount: 0 };
                }
            },
            release: () => {},
        };
    }
    return {
        query: async (sql, params) => ({ rows: [], rowCount: 0 }),
        release: () => {},
    };
}

async function closePool() {
    if (pgConnected && pgClient) {
        try {
            await pgClient.end();
        } catch (error) {
            console.error('[DB] Close error:', error.message);
        }
    }
}

// ============================================================
// ЭКСПОРТЫ
// ============================================================

module.exports = {
    setPGClient,
    query,
    getClient,
    closePool,
    pool: null,
    readTable,
    writeTable,
    generateId,
    now,
    initDatabase,
};
