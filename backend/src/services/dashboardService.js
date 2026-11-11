const { query } = require('../db/postgres');
const { collections } = require('../db/mongo');
const neo = require('../db/neo4j');
const splitService = require('./splitService');
const trackService = require('./trackService');
const statementService = require('./statementService');

async function admin() {
  const counts = (await query(
    `SELECT (SELECT COUNT(*) FROM tracks) AS tracks,
            (SELECT COUNT(*) FROM contributors) AS contributors,
            (SELECT COUNT(*) FROM split_versions WHERE status='PENDING_APPROVAL') AS "pendingSplitVersions",
            (SELECT COUNT(*) FROM split_approvals sa JOIN split_versions sv ON sv.id = sa.split_version_id
              WHERE sa.status='PENDING' AND sv.status='PENDING_APPROVAL') AS "pendingApprovals",
            (SELECT COUNT(*) FROM streaming_reports) AS reports,
            (SELECT COUNT(*) FROM royalty_runs WHERE status='PENDING_APPROVAL') AS "runsAwaitingFinance",
            (SELECT COALESCE(SUM(outstanding_balance),0) FROM advances) AS "outstandingAdvances"`
  )).rows[0];

  const monthly = (await query(
    `SELECT to_char(sr.period_month,'YYYY-MM') AS month, p.code AS platform, SUM(sr.revenue) AS revenue, SUM(sr.streams) AS streams
       FROM streaming_records sr JOIN platforms p ON p.id = sr.platform_id
      GROUP BY sr.period_month, p.code ORDER BY sr.period_month, p.code`
  )).rows;
  const latest = (await query(
    `SELECT to_char(period_month,'YYYY-MM') AS month, SUM(revenue) AS revenue FROM streaming_records
      WHERE period_month = (SELECT MAX(period_month) FROM streaming_records) GROUP BY period_month`
  )).rows[0];

  let unmatched = 0;
  let samplingLinks = 0;
  try { unmatched = await collections.unmatched().countDocuments({ status: 'UNMATCHED' }); } catch { /* mongo down */ }
  try { samplingLinks = (await neo.run('MATCH ()-[r:SAMPLES]->() RETURN count(r) AS n', {}, 'READ'))[0].n; } catch { /* neo down */ }

  const pendingSplits = await splitService.listAll({ status: 'PENDING_APPROVAL' });
  return {
    counts: { ...counts, unmatchedRows: unmatched, samplingLinks },
    latestMonth: latest ? latest.month : null,
    latestMonthRevenue: latest ? latest.revenue : '0.00',
    monthlyRevenue: monthly,
    pendingSplits,
  };
}

async function contributor(user) {
  const cid = user.contributorId;
  const agreements = await splitService.listForContributor(cid);
  const pending = agreements.filter((a) => a.status === 'PENDING_APPROVAL'
    && a.shares.some((s) => s.contributorId === cid && s.approvalStatus === 'PENDING'));
  return {
    pendingApprovals: pending,
    agreements,
    tracks: await trackService.list({ contributorId: cid }),
    statement: await statementService.forContributor(cid),
  };
}

async function finance() {
  const counts = (await query(
    `SELECT (SELECT COUNT(*) FROM royalty_runs WHERE status='PENDING_APPROVAL') AS "awaitingApproval",
            (SELECT COUNT(*) FROM royalty_runs WHERE status='APPROVED') AS "awaitingPayment",
            (SELECT COALESCE(SUM(net_amount),0) FROM v_run_contributor_payables v JOIN royalty_runs r ON r.id=v.run_id
              WHERE v.payment_status='PENDING' AND r.status='APPROVED') AS "outstandingPayable",
            (SELECT COALESCE(SUM(amount),0) FROM payments) AS "totalPaid",
            (SELECT COUNT(*) FROM payments) AS "paymentCount"`
  )).rows[0];
  return { counts };
}

module.exports = { admin, contributor, finance };
