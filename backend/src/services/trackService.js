const { query, withTransaction } = require('../db/postgres');
const neo = require('../db/neo4j');
const { ApiError } = require('../utils/errors');
const { requireString, optionalDate, requireRole } = require('../utils/validate');

const TRACK_COLS = `t.id, t.title, t.isrc, t.album, t.release_date AS "releaseDate", t.created_at AS "createdAt", t.updated_at AS "updatedAt"`;

async function list({ q, contributorId } = {}) {
  const params = [];
  const where = [];
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    where.push(`(lower(t.title) LIKE $${params.length} OR lower(t.isrc) LIKE $${params.length} OR lower(coalesce(t.album,'')) LIKE $${params.length})`);
  }
  if (contributorId) {
    params.push(contributorId);
    where.push(`EXISTS (SELECT 1 FROM track_contributors x WHERE x.track_id = t.id AND x.contributor_id = $${params.length})`);
  }
  const { rows } = await query(
    `SELECT ${TRACK_COLS},
            COALESCE((SELECT json_agg(json_build_object('id', c.id, 'name', c.name, 'role', tc.role) ORDER BY c.name)
                        FROM track_contributors tc JOIN contributors c ON c.id = tc.contributor_id
                       WHERE tc.track_id = t.id), '[]') AS contributors,
            COALESCE((SELECT json_agg(json_build_object('platform', p.code, 'platformName', p.name, 'externalId', ti.external_id) ORDER BY p.code)
                        FROM track_identifiers ti JOIN platforms p ON p.id = ti.platform_id
                       WHERE ti.track_id = t.id), '[]') AS identifiers,
            (SELECT json_build_object('id', sv.id, 'versionNo', sv.version_no)
               FROM split_versions sv WHERE sv.track_id = t.id AND sv.status = 'ACTIVE') AS "activeSplit",
            EXISTS (SELECT 1 FROM split_versions sv WHERE sv.track_id = t.id AND sv.status = 'PENDING_APPROVAL') AS "hasPendingSplit"
       FROM tracks t
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY t.title`,
    params
  );
  return rows;
}

async function get(id) {
  const rows = await list();
  const t = rows.find((r) => r.id === Number(id));
  if (!t) throw new ApiError(404, 'Track not found');
  return t;
}

function parseTrackInput(body) {
  const isrc = requireString(body.isrc, 'ISRC', { max: 15 }).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z0-9]{3,15}$/.test(isrc)) throw new ApiError(400, 'ISRC must be 3-15 letters/digits');
  return {
    title: requireString(body.title, 'Title'),
    isrc,
    album: requireString(body.album, 'Album', { optional: true }),
    releaseDate: optionalDate(body.releaseDate, 'Release date'),
    identifiers: Array.isArray(body.identifiers) ? body.identifiers : [],
    contributors: Array.isArray(body.contributors) ? body.contributors : null,
  };
}

async function writeIdentifiers(client, trackId, identifiers) {
  await client.query('DELETE FROM track_identifiers WHERE track_id = $1', [trackId]);
  for (const ident of identifiers) {
    const externalId = String(ident.externalId ?? '').trim();
    if (!externalId) continue;
    const p = await client.query('SELECT id FROM platforms WHERE code = $1', [String(ident.platform).toUpperCase()]);
    if (!p.rows[0]) throw new ApiError(400, `Unknown platform ${ident.platform}`);
    await client.query(
      'INSERT INTO track_identifiers (track_id, platform_id, external_id) VALUES ($1,$2,$3)',
      [trackId, p.rows[0].id, externalId]
    );
  }
}

async function writeContributors(client, trackId, contributors) {
  // Contributors that appear in a split version can never be removed from the track.
  const locked = await client.query(
    `SELECT DISTINCT ts.contributor_id FROM track_splits ts JOIN split_versions sv ON sv.id = ts.split_version_id
      WHERE sv.track_id = $1`, [trackId]
  );
  const keepIds = new Set(contributors.map((c) => Number(c.contributorId)));
  for (const r of locked.rows) {
    if (!keepIds.has(r.contributor_id)) {
      throw new ApiError(409, 'A contributor who is part of a split agreement cannot be removed from the track');
    }
  }
  await client.query('DELETE FROM track_contributors WHERE track_id = $1', [trackId]);
  const seen = new Set();
  for (const c of contributors) {
    const cid = Number(c.contributorId);
    if (!Number.isInteger(cid) || seen.has(cid)) continue;
    seen.add(cid);
    const role = c.role ? requireRole(c.role)
      : (await client.query('SELECT role FROM contributors WHERE id=$1', [cid])).rows[0]?.role;
    if (!role) throw new ApiError(400, `Contributor ${cid} does not exist`);
    await client.query(
      'INSERT INTO track_contributors (track_id, contributor_id, role) VALUES ($1,$2,$3)', [trackId, cid, role]
    );
  }
}

async function syncNeo4jTrack(track) {
  try {
    await neo.run(
      'MERGE (t:Track {pgId: $id}) SET t.title = $title, t.isrc = $isrc',
      { id: neo.int(track.id), title: track.title, isrc: track.isrc }
    );
  } catch (e) {
    // PostgreSQL is authoritative; the node is (re)created on demand when a sampling link is added.
    console.warn('[neo4j] track sync failed:', e.message);
  }
}

async function create(body) {
  const input = parseTrackInput(body);
  const id = await withTransaction(async (client) => {
    const { rows } = await client.query(
      'INSERT INTO tracks (title, isrc, album, release_date) VALUES ($1,$2,$3,$4) RETURNING id',
      [input.title, input.isrc, input.album, input.releaseDate]
    );
    await writeIdentifiers(client, rows[0].id, input.identifiers);
    if (input.contributors) await writeContributors(client, rows[0].id, input.contributors);
    return rows[0].id;
  });
  await syncNeo4jTrack({ id, ...input });
  return get(id);
}

async function update(id, body) {
  const input = parseTrackInput(body);
  await withTransaction(async (client) => {
    const { rowCount } = await client.query(
      `UPDATE tracks SET title=$1, isrc=$2, album=$3, release_date=$4, updated_at=now() WHERE id=$5`,
      [input.title, input.isrc, input.album, input.releaseDate, id]
    );
    if (!rowCount) throw new ApiError(404, 'Track not found');
    await writeIdentifiers(client, id, input.identifiers);
    if (input.contributors) await writeContributors(client, id, input.contributors);
  });
  await syncNeo4jTrack({ id: Number(id), ...input });
  return get(id);
}

async function listPlatforms() {
  const { rows } = await query('SELECT id, code, name FROM platforms ORDER BY id');
  return rows;
}

module.exports = { list, get, create, update, listPlatforms, syncNeo4jTrack };
