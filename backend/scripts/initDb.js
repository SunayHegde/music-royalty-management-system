// Creates the PostgreSQL schema, MongoDB indexes and Neo4j constraints.
// Safe to re-run (idempotent).
const fs = require('fs');
const path = require('path');
const pg = require('../src/db/postgres');
const mongo = require('../src/db/mongo');
const neo = require('../src/db/neo4j');

async function initDatabases({ quiet = false } = {}) {
  const log = quiet ? () => {} : console.log;
  const sql = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'schema.sql'), 'utf8');
  await pg.query(sql);
  log('✔ PostgreSQL schema ready');
  await mongo.ensureMongoIndexes();
  log('✔ MongoDB collections & indexes ready (streaming_reports, unmatched_reports)');
  await neo.ensureNeo4jConstraints();
  log('✔ Neo4j constraints ready (Track.pgId unique)');
}

if (require.main === module) {
  initDatabases()
    .then(() => console.log('All three databases initialised.'))
    .catch((e) => { console.error('Initialisation failed:', e.message); process.exitCode = 1; })
    .finally(async () => { await pg.pool.end(); await mongo.closeMongo(); await neo.closeNeo4j(); });
}

module.exports = { initDatabases };
