const { query, withTransaction } = require('../db/postgres');
const { ApiError } = require('../utils/errors');
const { toPaise, fromPaise } = require('../utils/money');
const { optionalDate } = require('../utils/validate');

async function list({ contributorId } = {}) {
  const params = [];
  let where = '';
  if (contributorId) { params.push(contributorId); where = 'WHERE a.contributor_id = $1'; }
  const { rows } = await query(
    `SELECT a.id, a.contributor_id AS "contributorId", c.name AS "contributorName",
            a.original_amount AS "originalAmount", a.outstanding_balance AS "outstandingBalance",
            (a.original_amount - a.outstanding_balance) AS "recoupedAmount",
            a.description, a.issued_on AS "issuedOn", a.created_at AS "createdAt"
       FROM advances a JOIN contributors c ON c.id = a.contributor_id
      ${where}
      ORDER BY a.issued_on DESC, a.id DESC`,
    params
  );
  return rows;
}

async function transactions({ advanceId, contributorId } = {}) {
  const params = [];
  const where = [];
  if (advanceId) { params.push(advanceId); where.push(`t.advance_id = $${params.length}`); }
  if (contributorId) { params.push(contributorId); where.push(`a.contributor_id = $${params.length}`); }
  const { rows } = await query(
    `SELECT t.id, t.advance_id AS "advanceId", c.name AS "contributorName", t.txn_type AS "type",
            t.amount, t.balance_after AS "balanceAfter", t.royalty_run_id AS "royaltyRunId",
            to_char(r.period_month, 'YYYY-MM') AS "runMonth", t.note, t.created_at AS "createdAt"
       FROM advance_transactions t
       JOIN advances a ON a.id = t.advance_id
       JOIN contributors c ON c.id = a.contributor_id
       LEFT JOIN royalty_runs r ON r.id = t.royalty_run_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY t.created_at DESC, t.id DESC`,
    params
  );
  return rows;
}

async function create(body, user) {
  const contributorId = Number(body.contributorId);
  if (!Number.isInteger(contributorId)) throw new ApiError(400, 'Contributor is required');
  const paise = toPaise(body.amount, 'Advance amount');
  if (paise <= 0n) throw new ApiError(400, 'Advance amount must be greater than zero');
  const amount = fromPaise(paise);
  const issuedOn = optionalDate(body.issuedOn, 'Issue date') || new Date().toISOString().slice(0, 10);

  const id = await withTransaction(async (client) => {
    const c = await client.query('SELECT id FROM contributors WHERE id=$1', [contributorId]);
    if (!c.rows[0]) throw new ApiError(404, 'Contributor not found');
    const { rows } = await client.query(
      `INSERT INTO advances (contributor_id, original_amount, outstanding_balance, description, issued_on, created_by)
       VALUES ($1,$2,$2,$3,$4,$5) RETURNING id`,
      [contributorId, amount, body.description || null, issuedOn, user.id]
    );
    await client.query(
      `INSERT INTO advance_transactions (advance_id, txn_type, amount, balance_after, note, created_by)
       VALUES ($1,'ISSUED',$2,$2,$3,$4)`,
      [rows[0].id, amount, body.description || 'Advance issued', user.id]
    );
    return rows[0].id;
  });
  return (await list()).find((a) => a.id === id);
}

/** Current outstanding balance per contributor (as BigInt paise). */
async function outstandingByContributor(client, contributorIds) {
  const map = new Map();
  if (!contributorIds.length) return map;
  const { rows } = await client.query(
    `SELECT contributor_id, SUM(outstanding_balance) AS total FROM advances
      WHERE contributor_id = ANY($1) GROUP BY contributor_id`,
    [contributorIds]
  );
  for (const r of rows) map.set(r.contributor_id, toPaise(r.total));
  return map;
}

module.exports = { list, transactions, create, outstandingByContributor };
