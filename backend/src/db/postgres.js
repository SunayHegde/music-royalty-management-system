// PostgreSQL connection module - the authoritative financial database.
const { Pool, types } = require('pg');
const config = require('../config');

// DATE -> keep as 'YYYY-MM-DD' string (avoid timezone shifts).
types.setTypeParser(1082, (v) => v);
// BIGINT (COUNT/SUM of integers) -> JS number (safe for our counts / streams).
types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
// NUMERIC stays a string by default - money is never converted to float.

const pool = new Pool(config.pg);
pool.on('error', (err) => console.error('[postgres] idle client error', err.message));

const query = (text, params) => pool.query(text, params);

/**
 * Runs fn(client) inside a single transaction. Commits on success,
 * rolls back on any thrown error and re-throws it.
 */
async function withTransaction(fn, { isolation } = {}) {
  const client = await pool.connect();
  try {
    await client.query(isolation ? `BEGIN ISOLATION LEVEL ${isolation}` : 'BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

async function ping() {
  await pool.query('SELECT 1');
}

module.exports = { pool, query, withTransaction, ping };
