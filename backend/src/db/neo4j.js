// Neo4j connection module - (:Track)-[:SAMPLES {percentageBp}]->(:Track) graph.
const neo4j = require('neo4j-driver');
const config = require('../config');

const driver = neo4j.driver(
  config.neo4j.uri,
  neo4j.auth.basic(config.neo4j.user, config.neo4j.password),
  { disableLosslessIntegers: true } // return Neo4j integers as JS numbers
);

/** Run a Cypher statement and return plain objects. */
async function run(cypher, params = {}, mode = 'WRITE') {
  const session = driver.session({
    defaultAccessMode: mode === 'READ' ? neo4j.session.READ : neo4j.session.WRITE,
  });
  try {
    const res = await session.run(cypher, params);
    return res.records.map((r) => r.toObject());
  } finally {
    await session.close();
  }
}

const int = (n) => neo4j.int(n);

async function ensureNeo4jConstraints() {
  await run('CREATE CONSTRAINT track_pg_id IF NOT EXISTS FOR (t:Track) REQUIRE t.pgId IS UNIQUE');
}

async function ping() {
  await driver.verifyConnectivity();
}

async function closeNeo4j() {
  await driver.close();
}

module.exports = { driver, run, int, ensureNeo4jConstraints, ping, closeNeo4j };
