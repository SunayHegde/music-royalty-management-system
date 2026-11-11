const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const env = (key, fallback) => (process.env[key] !== undefined && process.env[key] !== '' ? process.env[key] : fallback);

module.exports = {
  port: Number(env('PORT', 4000)),
  corsOrigin: env('CORS_ORIGIN', 'http://localhost:3000'),
  jwtSecret: env('JWT_SECRET', 'dev-only-secret-change-me'),
  jwtExpiresIn: env('JWT_EXPIRES_IN', '8h'),
  pg: {
    host: env('PG_HOST', 'localhost'),
    port: Number(env('PG_PORT', 5433)),
    database: env('PG_DATABASE', 'royalty_db'),
    user: env('PG_USER', 'royalty'),
    password: env('PG_PASSWORD', 'royalty_pw'),
    max: 10,
  },
  mongo: {
    uri: env('MONGO_URI', 'mongodb://royalty:royalty_pw@localhost:27018/?authSource=admin'),
    db: env('MONGO_DB', 'royalty_reports'),
  },
  neo4j: {
    uri: env('NEO4J_URI', 'bolt://localhost:7688'),
    user: env('NEO4J_USER', 'neo4j'),
    password: env('NEO4J_PASSWORD', 'royalty_neo4j_pw'),
  },
};
