// Sampling relationships live in Neo4j:  (source:Track)-[:SAMPLES {percentageBp}]->(sampled:Track)
// "Midnight Drive SAMPLES Summer Nights at 10%" => Midnight Drive owes Summer Nights 10% of its revenue.
const neo = require('../db/neo4j');
const { query } = require('../db/postgres');
const { ApiError } = require('../utils/errors');
const { requireInt } = require('../utils/validate');

async function list() {
  const rels = await neo.run(
    `MATCH (s:Track)-[r:SAMPLES]->(t:Track)
     RETURN s.pgId AS sourceId, s.title AS sourceTitle, s.isrc AS sourceIsrc,
            t.pgId AS sampledId, t.title AS sampledTitle, t.isrc AS sampledIsrc,
            r.percentageBp AS percentageBp, r.createdAt AS createdAt, r.createdBy AS createdBy
     ORDER BY sourceTitle, sampledTitle`,
    {}, 'READ'
  );
  const nodes = await neo.run('MATCH (t:Track) RETURN t.pgId AS id, t.title AS title, t.isrc AS isrc ORDER BY t.title', {}, 'READ');
  return { relationships: rels, nodes };
}

async function create(body, user) {
  const sourceId = requireInt(body.sourceTrackId, 'Source track');
  const sampledId = requireInt(body.sampledTrackId, 'Sampled track');
  const percentageBp = requireInt(body.percentageBp, 'Sampling percentage (basis points)', { min: 1, max: 9999 });
  if (sourceId === sampledId) throw new ApiError(400, 'A track cannot sample itself');

  // Tracks must exist in PostgreSQL (source of truth); mirror them as Neo4j nodes.
  const { rows } = await query('SELECT id, title, isrc FROM tracks WHERE id = ANY($1)', [[sourceId, sampledId]]);
  if (rows.length !== 2) throw new ApiError(404, 'Both tracks must exist');
  for (const t of rows) {
    await neo.run('MERGE (t:Track {pgId: $id}) SET t.title = $title, t.isrc = $isrc', { id: neo.int(t.id), title: t.title, isrc: t.isrc });
  }

  const [check] = await neo.run(
    `MATCH (s:Track {pgId: $src}), (t:Track {pgId: $dst})
     RETURN EXISTS { (s)-[:SAMPLES]->(t) } AS duplicate,
            EXISTS { MATCH (t)-[:SAMPLES*1..25]->(s) } AS cycle,
            COALESCE([(s)-[r:SAMPLES]->() | r.percentageBp], []) AS existing`,
    { src: neo.int(sourceId), dst: neo.int(sampledId) }, 'READ'
  );
  if (check.duplicate) throw new ApiError(409, 'This sampling relationship already exists');
  if (check.cycle) throw new ApiError(409, 'Circular sampling is not allowed: the sampled track already (directly or indirectly) samples the source track');
  const existingTotal = check.existing.reduce((a, b) => a + Number(b), 0);
  if (existingTotal + percentageBp >= 10000) {
    throw new ApiError(400, `Total sampling obligations for this track would reach ${((existingTotal + percentageBp) / 100).toFixed(2)}%; it must stay below 100%`);
  }

  await neo.run(
    `MATCH (s:Track {pgId: $src}), (t:Track {pgId: $dst})
     CREATE (s)-[:SAMPLES {percentageBp: $bp, createdAt: datetime().epochMillis, createdBy: $by}]->(t)`,
    { src: neo.int(sourceId), dst: neo.int(sampledId), bp: neo.int(percentageBp), by: user.username }
  );
  return list();
}

async function remove(sourceId, sampledId) {
  const res = await neo.run(
    `MATCH (:Track {pgId: $src})-[r:SAMPLES]->(:Track {pgId: $dst}) DELETE r RETURN count(*) AS n`,
    { src: neo.int(Number(sourceId)), dst: neo.int(Number(sampledId)) }
  );
  if (!res[0] || res[0].n === 0) throw new ApiError(404, 'Relationship not found');
  return list();
}

/** One-level obligations for the given source tracks (used by the royalty engine). */
async function obligationsFor(trackIds) {
  if (!trackIds.length) return [];
  return neo.run(
    `MATCH (s:Track)-[r:SAMPLES]->(t:Track) WHERE s.pgId IN $ids
     RETURN s.pgId AS sourceTrackId, t.pgId AS sampledTrackId, r.percentageBp AS percentageBp`,
    { ids: trackIds.map((id) => neo.int(id)) }, 'READ'
  );
}

module.exports = { list, create, remove, obligationsFor };
