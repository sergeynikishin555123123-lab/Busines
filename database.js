const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

let DATA_DIR = path.join(__dirname, 'data');

const TABLES = {
  users: [],
  admins: [],
  bot_settings: [
    { key: 'bot_name', value: 'Обучающий бот' },
    { key: 'support_contact', value: '@support' },
    { key: 'main_menu_text', value: 'Добро пожаловать! Выберите раздел:' },
    { key: 'free_lessons_button', value: '📚 Бесплатные уроки' },
    { key: 'full_course_button', value: '🎓 Полный курс' },
    { key: 'progress_button', value: '📊 Мой прогресс' },
    { key: 'support_button', value: '💬 Поддержка' },
    { key: 'watched_button', value: '✅ Я просмотрел' },
    { key: 'complete_course_offer', value: 'Поздравляем! Вы прошли все бесплатные уроки. Хотите открыть полный курс?' },
    { key: 'wrong_answer_text', value: '❌ Неправильный ответ. Попробуйте еще раз.' },
    { key: 'correct_answer_text', value: '✅ Правильно! Урок завершен.' },
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

function initDatabase() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch (error) {
    console.warn('Cannot create data directory, using /tmp/data:', error.message);
    DATA_DIR = '/tmp/data';
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
    } catch (err) {
      console.error('Cannot create /tmp/data:', err.message);
    }
  }

  for (const tableName of Object.keys(TABLES)) {
    try {
      const filePath = path.join(DATA_DIR, `${tableName}.json`);
      if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, JSON.stringify(TABLES[tableName], null, 2));
      }
    } catch (error) {
      console.error(`Cannot write ${tableName}.json:`, error.message);
    }
  }
}

function readTable(tableName) {
  const filePath = path.join(DATA_DIR, `${tableName}.json`);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  const data = fs.readFileSync(filePath, 'utf-8');
  return JSON.parse(data);
}

function writeTable(tableName, data) {
  const filePath = path.join(DATA_DIR, `${tableName}.json`);
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
