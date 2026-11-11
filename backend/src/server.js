const config = require('./config');
const app = require('./app');
const pg = require('./db/postgres');
const mongo = require('./db/mongo');
const neo = require('./db/neo4j');

async function start() {
  try {
    await pg.ping();
    console.log('✔ PostgreSQL connected');
    await mongo.connectMongo();
    console.log('✔ MongoDB connected');
    await neo.ping();
    console.log('✔ Neo4j connected');
  } catch (e) {
    console.error('✖ Database connection failed:', e.message);
    console.error('  Are the containers running?  docker compose up -d');
    process.exit(1);
  }
  const server = app.listen(config.port, () => console.log(`Music Royalty API listening on http://localhost:${config.port}/api`));
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`✖ Port ${config.port} is already in use - another copy of the API is probably still running.`);
      console.error(`  Find it:  Get-NetTCPConnection -LocalPort ${config.port} -State Listen | Select-Object OwningProcess`);
      console.error('  Stop it:  Stop-Process -Id <OwningProcess>   (or change PORT in backend/.env)');
    } else {
      console.error('✖ Server error:', err.message);
    }
    process.exit(1);
  });
}

start();
