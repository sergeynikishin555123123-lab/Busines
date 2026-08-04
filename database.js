const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const Joi = require('joi');

let DATA_DIR = null;

function getDataDir() {
  if (DATA_DIR) return DATA_DIR;
  const dir = path.join(__dirname, 'data');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  DATA_DIR = dir;
  return DATA_DIR;
}

function getTablePath(tableName) {
  return path.join(getDataDir(), `${tableName}.json`);
}

// Определение схем для валидации
const schemas = {
  admins: Joi.array().items(Joi.object({
    id: Joi.string().required(),
    login: Joi.string().required(),
    password_hash: Joi.string().required(),
    role: Joi.string().valid('superadmin', 'admin').required(),
    created_at: Joi.string().isoDate().required(),
  })),
  users: Joi.array().items(Joi.object({
    id: Joi.string().required(),
    platform: Joi.string().valid('vk', 'max').required(),
    platformId: Joi.string().required(),
    firstName: Joi.string().allow(''),
    lastName: Joi.string().allow(''),
    username: Joi.string().allow(''),
    registeredAt: Joi.string().isoDate().required(),
  })),
  // ... другие схемы
};

function initDatabase() {
  getDataDir();
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
    const parsed = JSON.parse(data);
    // Валидация при чтении
    if (schemas[tableName]) {
      const { error } = schemas[tableName].validate(parsed);
      if (error) {
        console.error(`Validation error for table ${tableName}:`, error.message);
        return [];
      }
    }
    return parsed;
  } catch (error) {
    console.error(`Error reading table ${tableName}:`, error.message);
    return [];
  }
}

function writeTable(tableName, data) {
  // Валидация перед записью
  if (schemas[tableName]) {
    const { error } = schemas[tableName].validate(data);
    if (error) {
      throw new Error(`Data validation failed for ${tableName}: ${error.message}`);
    }
  }
  const filePath = getTablePath(tableName);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function generateId() {
  return uuidv4();
}

function now() {
  return new Date().toISOString();
}

// Заглушки для совместимости с предыдущим кодом
async function query(sql, params = []) {
  console.warn('query() called with SQL:', sql);
  return { rows: [], rowCount: 0 };
}

async function getClient() {
  return {
    query: async (sql, params) => {
      console.warn('getClient().query() called with SQL:', sql);
      return { rows: [], rowCount: 0 };
    },
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
