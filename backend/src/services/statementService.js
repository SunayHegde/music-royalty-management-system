const { query } = require('../db/postgres');
const { ApiError } = require('../utils/errors');
const advanceService = require('./advanceService');

/** Contributor-wise royalty statement across all (non-rejected) runs. */
async function forContributor(contributorId) {
  const c = (await query('SELECT id, name, email, role FROM contributors WHERE id=$1', [contributorId])).rows[0];
  if (!c) throw new ApiError(404, 'Contributor not found');

  const lines = await query(
    `SELECT d.run_id AS "runId", to_char(r.period_month,'YYYY-MM') AS month, r.status AS "runStatus",
            d.track_id AS "trackId", t.title, t.isrc, sv.version_no AS "splitVersion", d.split_version_id AS "splitVersionId",
            d.share_bp AS "shareBp", rt.distributable, d.gross_amount AS gross, d.advance_deduction AS "advanceDeduction", d.net_amount AS net
       FROM royalty_details d
       JOIN royalty_runs r ON r.id = d.run_id
       JOIN tracks t ON t.id = d.track_id
       JOIN split_versions sv ON sv.id = d.split_version_id
       JOIN royalty_run_tracks rt ON rt.run_id = d.run_id AND rt.track_id = d.track_id
      WHERE d.contributor_id = $1 AND r.status <> 'REJECTED'
      ORDER BY r.period_month DESC, t.title`,
    [contributorId]
  );
  const runs = await query(
    `SELECT v.run_id AS "runId", to_char(r.period_month,'YYYY-MM') AS month, r.status AS "runStatus",
            v.gross_amount AS gross, v.advance_deduction AS "advanceDeduction", v.net_amount AS net,
            v.payment_status AS "paymentStatus", v.paid_at AS "paidAt", v.payment_reference AS "paymentReference"
       FROM v_run_contributor_payables v JOIN royalty_runs r ON r.id = v.run_id
      WHERE v.contributor_id = $1 AND r.status <> 'REJECTED'
      ORDER BY r.period_month DESC`,
    [contributorId]
  );
  const totals = await query(
    `SELECT COALESCE(SUM(v.gross_amount),0) AS gross, COALESCE(SUM(v.advance_deduction),0) AS "advanceDeduction",
            COALESCE(SUM(v.net_amount),0) AS net,
            COALESCE(SUM(v.net_amount) FILTER (WHERE v.payment_status='PAID'),0) AS paid,
            COALESCE(SUM(v.net_amount) FILTER (WHERE v.payment_status='PENDING' AND r.status IN ('APPROVED','PAID')),0) AS "awaitingPayment",
            (SELECT COALESCE(SUM(outstanding_balance),0) FROM advances WHERE contributor_id = $1) AS "outstandingAdvance"
       FROM v_run_contributor_payables v JOIN royalty_runs r ON r.id = v.run_id
      WHERE v.contributor_id = $1 AND r.status <> 'REJECTED'`,
    [contributorId]
  );
  return {
    contributor: c,
    totals: totals.rows[0],
    runs: runs.rows.map((r) => ({ ...r, lines: lines.rows.filter((l) => l.runId === r.runId) })),
    advances: await advanceService.list({ contributorId }),
    advanceTransactions: await advanceService.transactions({ contributorId }),
  };
}

module.exports = { forContributor };
