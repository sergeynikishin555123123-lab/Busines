const database = require('./database');
const logger = require('./logger');
const bcrypt = require('bcrypt');
const config = require('./config');

const migrationSQL = `
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform VARCHAR(10) NOT NULL CHECK (platform IN ('vk', 'max')),
    platform_user_id VARCHAR(255) NOT NULL,
    first_name VARCHAR(255),
    last_name VARCHAR(255),
    username VARCHAR(255),
    language_code VARCHAR(10) DEFAULT 'ru',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(platform, platform_user_id)
);

CREATE INDEX IF NOT EXISTS idx_users_platform_id ON users(platform, platform_user_id);

CREATE TABLE IF NOT EXISTS admins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    login VARCHAR(100) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(20) DEFAULT 'admin' CHECK (role IN ('admin', 'superadmin')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS bot_settings (
    key VARCHAR(100) PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS courses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    description TEXT,
    price NUMERIC(10, 2) DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lessons (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    description TEXT,
    video_url TEXT,
    order_number INTEGER NOT NULL DEFAULT 0,
    is_free BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lessons_course_order ON lessons(course_id, order_number);

CREATE TABLE IF NOT EXISTS lesson_files (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id UUID REFERENCES lessons(id) ON DELETE CASCADE,
    filename VARCHAR(255) NOT NULL,
    url TEXT NOT NULL,
    type VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS tests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    lesson_id UUID REFERENCES lessons(id) ON DELETE CASCADE UNIQUE,
    question TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS test_answers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_id UUID REFERENCES tests(id) ON DELETE CASCADE,
    answer TEXT NOT NULL,
    is_correct BOOLEAN DEFAULT false
);

CREATE TABLE IF NOT EXISTS progress (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    lesson_id UUID REFERENCES lessons(id) ON DELETE CASCADE,
    status VARCHAR(20) DEFAULT 'started' CHECK (status IN ('started', 'completed')),
    test_passed BOOLEAN DEFAULT false,
    last_position INTEGER DEFAULT 0,
    completed_at TIMESTAMPTZ,
    UNIQUE(user_id, lesson_id)
);

CREATE INDEX IF NOT EXISTS idx_progress_user_lesson ON progress(user_id, lesson_id);

CREATE TABLE IF NOT EXISTS lesson_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    lesson_id UUID REFERENCES lessons(id) ON DELETE CASCADE,
    view_count INTEGER DEFAULT 1,
    first_viewed_at TIMESTAMPTZ DEFAULT NOW(),
    last_viewed_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_course_access (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    course_id UUID REFERENCES courses(id) ON DELETE CASCADE,
    granted_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, course_id)
);

CREATE TABLE IF NOT EXISTS payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    amount NUMERIC(10, 2) NOT NULL,
    currency VARCHAR(3) DEFAULT 'RUB',
    status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'success', 'failed', 'refunded')),
    payment_gateway VARCHAR(50),
    gateway_payment_id VARCHAR(255) UNIQUE,
    meta_data JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL,
    title VARCHAR(255),
    message TEXT NOT NULL,
    is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO bot_settings (key, value) VALUES
    ('bot_name', 'Обучающий бот'),
    ('support_contact', '@support'),
    ('main_menu_text', 'Добро пожаловать! Выберите раздел:'),
    ('free_lessons_button', '📚 Бесплатные уроки'),
    ('full_course_button', '🎓 Полный курс'),
    ('progress_button', '📊 Мой прогресс'),
    ('support_button', '💬 Поддержка'),
    ('watched_button', '✅ Я просмотрел'),
    ('complete_course_offer', 'Поздравляем! Вы прошли все бесплатные уроки. Хотите открыть полный курс?'),
    ('wrong_answer_text', '❌ Неправильный ответ. Попробуйте еще раз.'),
    ('correct_answer_text', '✅ Правильно! Урок завершен.')
ON CONFLICT (key) DO NOTHING;
`;

async function migrate() {
  const client = await database.getClient();
  
  try {
    await client.query('BEGIN');
    await client.query(migrationSQL);
    await client.query('COMMIT');
    
    logger.info('Migration completed successfully');
    
    const adminCheck = await database.query(
      'SELECT id FROM admins WHERE login = $1',
      [config.admin.defaultLogin]
    );
    
    if (adminCheck.rows.length === 0) {
      if (config.admin.defaultPassword === 'change_this_password') {
        logger.warn('ADMIN PASSWORD IS SET TO DEFAULT. PLEASE CHANGE DEFAULT_ADMIN_PASSWORD IN .env');
      }
      
      const passwordHash = await bcrypt.hash(config.admin.defaultPassword, 12);
      await database.query(
        'INSERT INTO admins (login, password_hash, role) VALUES ($1, $2, $3)',
        [config.admin.defaultLogin, passwordHash, 'superadmin']
      );
      logger.info(`Default admin created with login: ${config.admin.defaultLogin}`);
    } else {
      logger.info('Admin user already exists, skipping creation');
    }
    
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  migrate()
    .then(() => {
      console.log('Migration finished successfully');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration error:', err);
      process.exit(1);
    });
}

module.exports = migrate;
