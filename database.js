// database.js - ПОЛНАЯ ПРОДАКШЕН ВЕРСИЯ С POSTGRESQL

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

    // Получаем колонки из первой записи
    const columns = Object.keys(data[0]);
    const columnNames = columns.join(', ');
    
    // Создаем временную таблицу для данных
    const tempTable = `temp_${realTable}_${Date.now()}`;
    
    // Создаем временную таблицу с такой же структурой
    await pgClient.query(`CREATE TEMP TABLE ${tempTable} (LIKE ${realTable} INCLUDING ALL)`);
    
    // Вставляем данные во временную таблицу
    for (const row of data) {
        const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
        const values = columns.map(col => row[col]);
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
