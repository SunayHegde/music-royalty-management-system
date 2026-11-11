// MongoDB connection module - stores original uploaded report rows
// (one document per CSV line) and the unmatched rows awaiting manual mapping.
const { MongoClient } = require('mongodb');
const config = require('../config');

let client;
let db;

async function connectMongo() {
  if (db) return db;
  client = new MongoClient(config.mongo.uri, { serverSelectionTimeoutMS: 5000 });
  await client.connect();
  db = client.db(config.mongo.db);
  return db;
}

function getDb() {
  if (!db) throw new Error('MongoDB not connected');
  return db;
}

const collections = {
  reportRows: () => getDb().collection('streaming_reports'),
  unmatched: () => getDb().collection('unmatched_reports'),
};

async function ensureMongoIndexes() {
  const d = await connectMongo();
  const rows = d.collection('streaming_reports');
  await rows.createIndex({ source_row_id: 1 }, { unique: true, name: 'uq_source_row_id' });
  await rows.createIndex({ report_key: 1, row_number: 1 }, { name: 'ix_report_row' });
  await rows.createIndex({ status: 1 }, { name: 'ix_status' });
  const un = d.collection('unmatched_reports');
  await un.createIndex({ source_row_id: 1 }, { unique: true, name: 'uq_source_row_id' });
  await un.createIndex({ status: 1, month: 1 }, { name: 'ix_status_month' });
}

async function closeMongo() {
  if (client) await client.close();
  client = undefined;
  db = undefined;
}

module.exports = { connectMongo, getDb, collections, ensureMongoIndexes, closeMongo };
