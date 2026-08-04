const database = require('./database');
const bcrypt = require('bcryptjs');
const config = require('./config');
const logger = require('./logger');

async function migrate() {
  try {
    database.initDatabase();

    const admins = database.readTable('admins');
    
    if (admins.length === 0) {
      // Проверяем, что admin конфиг существует
      if (!config.admin || !config.admin.defaultLogin || !config.admin.defaultPassword) {
        logger.error('Admin configuration is missing. Please set ADMIN_LOGIN and ADMIN_PASSWORD in .env');
        throw new Error('Admin configuration missing');
      }

      const passwordHash = await bcrypt.hash(config.admin.defaultPassword, 12);
      
      admins.push({
        id: database.generateId(),
        login: config.admin.defaultLogin,
        password_hash: passwordHash,
        role: 'superadmin',
        created_at: database.now(),
      });

      database.writeTable('admins', admins);
      logger.info(`Default admin created with login: ${config.admin.defaultLogin}`);
    } else {
      logger.info('Admin user(s) already exist, skipping creation');
    }

    logger.info('Migration completed successfully');
    return true;
  } catch (error) {
    logger.error({ err: error }, 'Migration failed');
    throw error;
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
