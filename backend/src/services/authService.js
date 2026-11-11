const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { query } = require('../db/postgres');
const { ApiError } = require('../utils/errors');

async function login(username, password) {
  if (!username || !password) throw new ApiError(400, 'Username and password are required');
  const { rows } = await query(
    `SELECT u.id, u.username, u.password_hash, u.full_name, u.role, u.is_active, c.id AS contributor_id
       FROM users u LEFT JOIN contributors c ON c.user_id = u.id
      WHERE u.username = $1`,
    [String(username).trim().toLowerCase()]
  );
  const user = rows[0];
  // same message for unknown user / wrong password (no user enumeration)
  if (!user || !user.is_active || !(await bcrypt.compare(String(password), user.password_hash))) {
    throw new ApiError(401, 'Invalid username or password');
  }
  const profile = {
    id: user.id,
    username: user.username,
    fullName: user.full_name,
    role: user.role,
    contributorId: user.contributor_id,
  };
  const token = jwt.sign(
    { sub: user.id, username: user.username, role: user.role, contributorId: user.contributor_id, fullName: user.full_name },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
  return { token, user: profile };
}

async function me(userId) {
  const { rows } = await query(
    `SELECT u.id, u.username, u.full_name AS "fullName", u.role, c.id AS "contributorId"
       FROM users u LEFT JOIN contributors c ON c.user_id = u.id WHERE u.id = $1`,
    [userId]
  );
  if (!rows[0]) throw new ApiError(404, 'User not found');
  return rows[0];
}

async function listUsers({ role, unlinked } = {}) {
  const params = [];
  const where = [];
  if (role) { params.push(role); where.push(`u.role = $${params.length}`); }
  if (unlinked) where.push('c.id IS NULL');
  const { rows } = await query(
    `SELECT u.id, u.username, u.full_name AS "fullName", u.role, c.id AS "contributorId", c.name AS "contributorName"
       FROM users u LEFT JOIN contributors c ON c.user_id = u.id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY u.role, u.username`,
    params
  );
  return rows;
}

const hashPassword = (pw) => bcrypt.hash(pw, 10);

module.exports = { login, me, listUsers, hashPassword };
