const { Pool } = require('pg');
const config = require('./config');
const logger = require('./logger');

const pool = new Pool({
  connectionString: config.database.url,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  logger.error('Unexpected database pool error', err);
});

async function query(text, params) {
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;
  
  if (config.server.nodeEnv === 'development') {
    logger.debug('DB Query', {
      text: text.substring(0, 100),
      duration,
      rows: result.rowCount,
    });
  }
  
  return result;
}

async function getClient() {
  const client = await pool.connect();
  return client;
}

async function closePool() {
  await pool.end();
  logger.info('Database pool closed');
}

module.exports = {
  query,
  getClient,
  pool,
  closePool,
};
