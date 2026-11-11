const { ApiError } = require('./errors');

/** 'YYYY-MM' or 'YYYY-MM-DD' -> 'YYYY-MM-01' */
function toMonthStart(value, field = 'month') {
  const s = String(value ?? '').trim();
  const m = /^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/.exec(s);
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) {
    throw new ApiError(400, `${field} must be in YYYY-MM format`);
  }
  return `${m[1]}-${String(m[2]).padStart(2, '0')}-01`;
}

/** 'YYYY-MM' or null if not parseable (used when validating CSV rows) */
function tryMonth(value) {
  try { return toMonthStart(value).slice(0, 7); } catch { return null; }
}

function requireString(value, field, { max = 200, optional = false } = {}) {
  const s = typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim();
  if (!s) {
    if (optional) return null;
    throw new ApiError(400, `${field} is required`);
  }
  if (s.length > max) throw new ApiError(400, `${field} must be at most ${max} characters`);
  return s;
}

function requireInt(value, field, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new ApiError(400, `${field} must be an integer between ${min} and ${max}`);
  }
  return n;
}

function optionalDate(value, field) {
  if (value == null || value === '') return null;
  const s = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || Number.isNaN(Date.parse(s))) {
    throw new ApiError(400, `${field} must be a date (YYYY-MM-DD)`);
  }
  return s;
}

const CONTRIBUTOR_ROLES = ['SINGER', 'PRODUCER', 'SONGWRITER', 'COMPOSER'];

function requireRole(value) {
  const r = String(value ?? '').trim().toUpperCase();
  if (!CONTRIBUTOR_ROLES.includes(r)) throw new ApiError(400, `role must be one of ${CONTRIBUTOR_ROLES.join(', ')}`);
  return r;
}

module.exports = { toMonthStart, tryMonth, requireString, requireInt, optionalDate, requireRole, CONTRIBUTOR_ROLES };
