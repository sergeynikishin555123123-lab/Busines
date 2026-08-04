const database = require('./database');
const bcrypt = require('bcryptjs');
const config = require('./config');
const logger = require('./logger');

async function migrate() {
  database.initDatabase();

  const admins = database.readTable('admins');
  
  if (admins.length === 0) {
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
    logger.info('Admin user already exists, skipping creation');
  }

  logger.info('Migration completed successfully');
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
