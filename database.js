// database.js - ИСПРАВЛЕННАЯ ВЕРСИЯ

const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const DATA_DIR = process.env.DATA_DIR || '/tmp/data';

// PostgreSQL клиент (устанавливается из server.js)
let pgClient = null;
let pgConnected = false;

// Создаём директорию при загрузке
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
    console.log('[DB] PostgreSQL client set:', connected ? 'connected' : 'fallback');
}

// ============================================================
// БАЗОВЫЕ МЕТОДЫ (JSON)
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

function readTable(tableName) {
    // Если PostgreSQL доступен - используем его
    if (pgConnected && pgClient) {
        return readTablePG(tableName);
    }
    
    // Fallback на JSON
    const filePath = getTablePath(tableName);
    try {
        const data = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        console.error(`Error reading ${tableName}:`, error.message);
        return [];
    }
}

function writeTable(tableName, data) {
    // Если PostgreSQL доступен - используем его
    if (pgConnected && pgClient) {
        return writeTablePG(tableName, data);
    }
    
    // Fallback на JSON
    const filePath = getTablePath(tableName);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function generateId() {
    return uuidv4();
}

function now() {
    return new Date().toISOString();
}

// ============================================================
// POSTGRESQL МЕТОДЫ
// ============================================================

async function readTablePG(tableName) {
    try {
        // Маппинг таблиц
        const tableMap = {
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
        
        const realTable = tableMap[tableName] || tableName;
        const result = await pgClient.query(`SELECT * FROM ${realTable}`);
        return result.rows;
    } catch (error) {
        console.error(`[DB] PG read error ${tableName}:`, error.message);
        // Fallback на JSON
        return readTableJSON(tableName);
    }
}

async function writeTablePG(tableName, data) {
    try {
        // Для простоты - пока используем JSON как основной
        // В будущем можно реализовать полноценную запись в PG
        const filePath = getTablePath(tableName);
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
        return true;
    } catch (error) {
        console.error(`[DB] PG write error ${tableName}:`, error.message);
        return false;
    }
}

function readTableJSON(tableName) {
    const filePath = getTablePath(tableName);
    try {
        const data = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(data);
    } catch (error) {
        console.error(`Error reading ${tableName}:`, error.message);
        return [];
    }
}

// ============================================================
// SQL QUERY (для прямых запросов)
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
