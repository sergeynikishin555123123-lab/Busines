const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Используем /tmp для данных
const DATA_DIR = process.env.DATA_DIR || '/tmp/data';

try {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`[DB] Created: ${DATA_DIR}`);
  }
} catch (error) {
  console.error(`[DB] Cannot create ${DATA_DIR}:`, error.message);
  process.exit(1);
}

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
  };

  for (const [tableName, defaultValue] of Object.entries(tables)) {
    const filePath = getTablePath(tableName);
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, JSON.stringify(defaultValue, null, 2));
    }
  }
}

function readTable(tableName) {
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
  const filePath = getTablePath(tableName);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function generateId() {
  return uuidv4();
}

function now() {
  return new Date().toISOString();
}

async function query(sql, params = []) {
  return { rows: [], rowCount: 0 };
}

async function getClient() {
  return {
    query: async (sql, params) => ({ rows: [], rowCount: 0 }),
    release: () => {},
  };
}

async function closePool() {}

module.exports = {
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
