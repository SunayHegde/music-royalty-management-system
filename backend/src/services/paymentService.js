// Simulated payouts (no real gateway). Payments are append-only and idempotent:
//  * the client sends an Idempotency-Key; a retry with the same key returns the original payment
//  * UNIQUE(run_id, contributor_id) guarantees a contributor is never paid twice for a run
const { query, withTransaction } = require('../db/postgres');
const { ApiError } = require('../utils/errors');
const { toPaise } = require('../utils/money');

const PAYMENT_SQL = `
  SELECT p.id, p.run_id AS "runId", to_char(r.period_month,'YYYY-MM') AS month, p.contributor_id AS "contributorId",
         c.name AS "contributorName", p.amount, p.idempotency_key AS "idempotencyKey",
         p.payment_reference AS "paymentReference", p.method, p.status, u.username AS "paidBy", p.paid_at AS "paidAt"
    FROM payments p
    JOIN royalty_runs r ON r.id = p.run_id
    JOIN contributors c ON c.id = p.contributor_id
    LEFT JOIN users u ON u.id = p.paid_by`;

async function list({ runId, contributorId } = {}) {
  const params = [];
  const where = [];
  if (runId) { params.push(runId); where.push(`p.run_id = $${params.length}`); }
  if (contributorId) { params.push(contributorId); where.push(`p.contributor_id = $${params.length}`); }
  const { rows } = await query(`${PAYMENT_SQL} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.paid_at DESC, p.id DESC`, params);
  return rows;
}

async function byKey(key) {
  return (await query(`${PAYMENT_SQL} WHERE p.idempotency_key = $1`, [key])).rows[0];
}

async function pay(body, idempotencyKey, user) {
  const runId = Number(body.runId);
  const contributorId = Number(body.contributorId);
  const key = String(idempotencyKey || body.idempotencyKey || '').trim();
  if (!Number.isInteger(runId) || !Number.isInteger(contributorId)) throw new ApiError(400, 'runId and contributorId are required');
  if (key.length < 8 || key.length > 100) throw new ApiError(400, 'An Idempotency-Key header (8-100 chars) is required');

  // Retry with the same key -> return the original result, never a second payment.
  const prior = await byKey(key);
  if (prior) {
    if (prior.runId !== runId || prior.contributorId !== contributorId) {
      throw new ApiError(409, 'This idempotency key was already used for a different payment');
    }
    return { payment: prior, idempotentReplay: true };
  }

  const paymentId = await withTransaction(async (client) => {
    const run = (await client.query('SELECT id, status FROM royalty_runs WHERE id=$1 FOR UPDATE', [runId])).rows[0];
    if (!run) throw new ApiError(404, 'Royalty run not found');
    if (run.status === 'PAID') throw new ApiError(409, 'All payments for this run have already been made');
    if (run.status !== 'APPROVED') throw new ApiError(409, `Run is ${run.status}; payments can only be recorded for APPROVED runs`);

    const due = (await client.query(
      'SELECT net_amount, payment_status FROM v_run_contributor_payables WHERE run_id=$1 AND contributor_id=$2',
      [runId, contributorId]
    )).rows[0];
    if (!due) throw new ApiError(404, 'This contributor has no royalties in this run');
    if (due.payment_status === 'PAID') throw new ApiError(409, 'This contributor has already been paid for this run');
    if (toPaise(due.net_amount) <= 0n) throw new ApiError(400, 'Nothing is payable to this contributor (fully recouped against advance)');

    const ins = await client.query(
      `INSERT INTO payments (run_id, contributor_id, amount, idempotency_key, payment_reference, paid_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [runId, contributorId, due.net_amount, key, body.paymentReference || `SIM-${runId}-${contributorId}-${Date.now()}`, user.id]
    );
    if (!ins.rows[0]) return null; // concurrent retry with the same key won the race

    const left = await client.query(
      `SELECT COUNT(*) AS n FROM v_run_contributor_payables WHERE run_id=$1 AND payment_status='PENDING'`, [runId]
    );
    if (left.rows[0].n === 0) await client.query(`UPDATE royalty_runs SET status='PAID' WHERE id=$1`, [runId]);
    return ins.rows[0].id;
  });

  const payment = await byKey(key);
  return { payment, idempotentReplay: paymentId === null };
}

module.exports = { list, pay };
