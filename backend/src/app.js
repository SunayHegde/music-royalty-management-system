const express = require('express');
const cors = require('cors');
const config = require('./config');
const routes = require('./routes');
const { errorHandler } = require('./middleware/errorHandler');
const pg = require('./db/postgres');
const mongo = require('./db/mongo');
const neo = require('./db/neo4j');

const app = express();
app.use(cors({ origin: config.corsOrigin.split(','), allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key'] }));
app.use(express.json({ limit: '1mb' }));

// health of all three databases
app.get('/api/health', async (_req, res) => {
  const check = async (fn) => { try { await fn(); return 'up'; } catch (e) { return `down: ${e.message}`; } };
  const status = {
    postgres: await check(pg.ping),
    mongodb: await check(async () => mongo.getDb().command({ ping: 1 })),
    neo4j: await check(neo.ping),
  };
  const ok = Object.values(status).every((s) => s === 'up');
  res.status(ok ? 200 : 503).json({ ok, ...status });
});

app.use('/api', routes);
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));
app.use(errorHandler);

module.exports = app;
