const { query, withTransaction } = require('../db/postgres');
const { ApiError } = require('../utils/errors');
const { requireString, requireRole } = require('../utils/validate');
const { hashPassword } = require('./authService');

async function list() {
  const { rows } = await query(
    `SELECT c.id, c.name, c.email, c.role, c.user_id AS "userId", u.username,
            (SELECT COUNT(*) FROM track_contributors tc WHERE tc.contributor_id = c.id) AS "trackCount",
            COALESCE((SELECT SUM(outstanding_balance) FROM advances a WHERE a.contributor_id = c.id), 0) AS "outstandingAdvance"
       FROM contributors c LEFT JOIN users u ON u.id = c.user_id
      ORDER BY c.name`
  );
  return rows;
}

async function get(id) {
  const c = (await list()).find((r) => r.id === Number(id));
  if (!c) throw new ApiError(404, 'Contributor not found');
  return c;
}

function parse(body) {
  const email = requireString(body.email, 'Email', { max: 160 }).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new ApiError(400, 'Email is not valid');
  return { name: requireString(body.name, 'Name', { max: 120 }), email, role: requireRole(body.role) };
}

/**
 * Resolve which login account to link:
 *  - body.userId           -> link an existing CONTRIBUTOR user
 *  - body.newUsername + newPassword -> create a new contributor login
 *  - neither               -> no login account
 */
async function resolveUser(client, body, fullName) {
  if (body.newUsername) {
    const username = requireString(body.newUsername, 'Username', { max: 50 }).toLowerCase();
    if (!/^[a-z0-9_.]{3,50}$/.test(username)) throw new ApiError(400, 'Username may contain a-z, 0-9, _ and . (min 3)');
    const pw = String(body.newPassword || '');
    if (pw.length < 6) throw new ApiError(400, 'Password must be at least 6 characters');
    const { rows } = await client.query(
      `INSERT INTO users (username, password_hash, full_name, role) VALUES ($1,$2,$3,'CONTRIBUTOR') RETURNING id`,
      [username, await hashPassword(pw), fullName]
    );
    return rows[0].id;
  }
  if (body.userId) {
    const { rows } = await client.query('SELECT role FROM users WHERE id=$1', [body.userId]);
    if (!rows[0]) throw new ApiError(400, 'Login account not found');
    if (rows[0].role !== 'CONTRIBUTOR') throw new ApiError(400, 'Only CONTRIBUTOR accounts can be linked to a contributor');
    return Number(body.userId);
  }
  return null;
}

async function create(body) {
  const input = parse(body);
  const id = await withTransaction(async (client) => {
    const userId = await resolveUser(client, body, input.name);
    const { rows } = await client.query(
      'INSERT INTO contributors (name, email, role, user_id) VALUES ($1,$2,$3,$4) RETURNING id',
      [input.name, input.email, input.role, userId]
    );
    return rows[0].id;
  });
  return get(id);
}

async function update(id, body) {
  const input = parse(body);
  await withTransaction(async (client) => {
    const cur = await client.query('SELECT user_id FROM contributors WHERE id=$1 FOR UPDATE', [id]);
    if (!cur.rows[0]) throw new ApiError(404, 'Contributor not found');
    let userId = cur.rows[0].user_id;
    if (body.newUsername || body.userId) userId = await resolveUser(client, body, input.name);
    else if (body.unlinkUser === true) userId = null;
    await client.query(
      'UPDATE contributors SET name=$1, email=$2, role=$3, user_id=$4, updated_at=now() WHERE id=$5',
      [input.name, input.email, input.role, userId, id]
    );
  });
  return get(id);
}

module.exports = { list, get, create, update };
