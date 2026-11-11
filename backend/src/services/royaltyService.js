// Royalty calculation engine.
//
// Sampling policy (one level, no recursion):
//   For every track T with matched revenue R in the month, and every (T)-[:SAMPLES {p}]->(S)
//   relationship in Neo4j, T owes S  round(R * p).  The obligation is deducted from T's
//   distributable amount and credited to S's distributable amount. Credits received by S are
//   NOT re-sampled (no recursive chains).
//
//   distributable(T) = own revenue - sampling owed + sampling credits received
//   gross(contributor) = distributable * share_bp / 10000   (remainder paise -> largest shares)
//   advance deduction = min(total gross of contributor, outstanding advance balance)
//   net = gross - advance deduction
//
// All arithmetic is exact BigInt paise. Results are persisted in NUMERIC(18,2) columns.
const { query, withTransaction } = require('../db/postgres');
const { ApiError } = require('../utils/errors');
const { toPaise, fromPaise, percentOf, minBig } = require('../utils/money');
const { toMonthStart } = require('../utils/validate');
const samplingService = require('./samplingService');
const splitService = require('./splitService');
const advanceService = require('./advanceService');

const SCOPE = 'ALL_TRACKS';

async function existingRun(client, periodMonth) {
  const { rows } = await client.query(
    `SELECT id, status FROM royalty_runs WHERE period_month=$1 AND scope=$2 AND status <> 'REJECTED'`,
    [periodMonth, SCOPE]
  );
  return rows[0];
}

/** Pure calculation. Reads PostgreSQL (+ Neo4j obligations); writes nothing. */
async function compute(client, periodMonth, { lock = false } = {}) {
  const existing = await existingRun(client, periodMonth);
  if (existing) {
    throw new ApiError(409, `Royalty run #${existing.id} already exists for ${periodMonth.slice(0, 7)} (${existing.status}). Duplicate runs are not allowed.`);
  }

  // Only matched + not-yet-consumed records; unmatched rows live in MongoDB and are excluded until mapped.
  const recs = await client.query(
    `SELECT id, track_id, streams, revenue FROM streaming_records
      WHERE period_month = $1 AND royalty_run_id IS NULL
      ORDER BY id ${lock ? 'FOR UPDATE' : ''}`,
    [periodMonth]
  );
  if (!recs.rowCount) {
    throw new ApiError(422, `No matched streaming revenue found for ${periodMonth.slice(0, 7)}. Upload reports (and map unmatched rows) first.`);
  }

  const trackMap = new Map(); // trackId -> accumulator
  const ensure = (id) => {
    if (!trackMap.has(id)) {
      trackMap.set(id, { trackId: id, streams: 0, ownRevenue: 0n, samplingDeduction: 0n, samplingCredit: 0n, recordCount: 0, obligations: [] });
    }
    return trackMap.get(id);
  };
  for (const r of recs.rows) {
    const t = ensure(r.track_id);
    t.streams += Number(r.streams);
    t.ownRevenue += toPaise(r.revenue);
    t.recordCount += 1;
  }

  // ---- sampling obligations (Neo4j), one level only ----
  const revenueTrackIds = [...trackMap.keys()];
  const rels = await samplingService.obligationsFor(revenueTrackIds);
  const obligations = [];
  for (const rel of rels) {
    const src = trackMap.get(rel.sourceTrackId);
    if (!src || src.ownRevenue === 0n) continue;
    const amount = percentOf(src.ownRevenue, rel.percentageBp);
    const ob = { sourceTrackId: rel.sourceTrackId, sampledTrackId: rel.sampledTrackId, percentageBp: rel.percentageBp, baseRevenue: src.ownRevenue, amount };
    obligations.push(ob);
    src.samplingDeduction += amount;
    ensure(rel.sampledTrackId).samplingCredit += amount;
  }

  const allTrackIds = [...trackMap.keys()];
  const titles = await client.query('SELECT id, title, isrc FROM tracks WHERE id = ANY($1)', [allTrackIds]);
  const trackInfo = new Map(titles.rows.map((t) => [t.id, t]));

  // ---- applicable approved split version per track ----
  const splits = await splitService.applicableVersions(client, allTrackIds, periodMonth);
  const missing = allTrackIds.filter((id) => !splits.has(id)).map((id) => trackInfo.get(id));
  if (missing.length) {
    throw new ApiError(422, `Calculation blocked: no approved split agreement for ${missing.map((t) => `${t.title} (${t.isrc})`).join(', ')}`, {
      tracksWithoutApprovedSplit: missing,
    });
  }

  // ---- distribute per track ----
  const lines = [];
  for (const t of trackMap.values()) {
    t.distributable = t.ownRevenue - t.samplingDeduction + t.samplingCredit;
    const split = splits.get(t.trackId);
    t.splitVersionId = split.splitVersionId;
    t.versionNo = split.versionNo;
    let allocated = 0n;
    const tl = split.shares.map((s) => {
      const gross = (t.distributable * BigInt(s.shareBp)) / 10000n; // floor
      allocated += gross;
      return { trackId: t.trackId, contributorId: s.contributorId, name: s.name, shareBp: s.shareBp, splitVersionId: split.splitVersionId, gross };
    });
    // give leftover paise (from flooring) one by one to the largest shares -> exact total
    let rem = t.distributable - allocated;
    for (let i = 0; rem > 0n; i = (i + 1) % tl.length, rem -= 1n) tl[i].gross += 1n;
    lines.push(...tl);
  }

  // ---- advances: deduct up to the outstanding balance, carry forward the rest ----
  const contributorIds = [...new Set(lines.map((l) => l.contributorId))];
  const outstanding = await advanceService.outstandingByContributor(client, contributorIds);
  const contributors = [];
  for (const cid of contributorIds) {
    const cl = lines.filter((l) => l.contributorId === cid).sort((a, b) => a.trackId - b.trackId);
    const gross = cl.reduce((a, l) => a + l.gross, 0n);
    const bal = outstanding.get(cid) || 0n;
    const deduction = minBig(gross, bal);
    let left = deduction;
    for (const l of cl) {
      l.advanceDeduction = minBig(l.gross, left);
      left -= l.advanceDeduction;
      l.net = l.gross - l.advanceDeduction;
    }
    contributors.push({
      contributorId: cid, name: cl[0].name, gross, outstandingAdvance: bal,
      advanceDeduction: deduction, net: gross - deduction, advanceCarryForward: bal - deduction,
    });
  }
  contributors.sort((a, b) => a.name.localeCompare(b.name));

  const sum = (arr, k) => arr.reduce((a, x) => a + x[k], 0n);
  const tracks = [...trackMap.values()].sort((a, b) => trackInfo.get(a.trackId).title.localeCompare(trackInfo.get(b.trackId).title));
  return {
    periodMonth,
    recordIds: recs.rows.map((r) => r.id),
    tracks: tracks.map((t) => ({ ...t, title: trackInfo.get(t.trackId).title, isrc: trackInfo.get(t.trackId).isrc })),
    obligations: obligations.map((o) => ({ ...o, sourceTitle: trackInfo.get(o.sourceTrackId).title, sampledTitle: trackInfo.get(o.sampledTrackId).title })),
    lines,
    contributors,
    totals: {
      recordCount: recs.rowCount,
      streams: tracks.reduce((a, t) => a + t.streams, 0),
      revenue: sum(tracks, 'ownRevenue'),
      sampling: sum(obligations, 'amount'),
      gross: sum(contributors, 'gross'),
      advanceDeduction: sum(contributors, 'advanceDeduction'),
      net: sum(contributors, 'net'),
    },
  };
}

/** Convert BigInt fields to '0.00' strings for JSON. */
function serialize(calc) {
  const m = (v) => (typeof v === 'bigint' ? fromPaise(v) : v);
  const conv = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, m(v)]));
  return {
    month: calc.periodMonth.slice(0, 7),
    scope: SCOPE,
    totals: conv(calc.totals),
    tracks: calc.tracks.map((t) => ({
      ...conv(t),
      obligations: undefined,
      lines: calc.lines.filter((l) => l.trackId === t.trackId).map(conv),
    })),
    obligations: calc.obligations.map(conv),
    contributors: calc.contributors.map(conv),
  };
}

async function preview(month) {
  const periodMonth = toMonthStart(month);
  const client = await require('../db/postgres').pool.connect();
  try {
    return serialize(await compute(client, periodMonth));
  } finally {
    client.release();
  }
}

/** Calculate and persist a run (status PENDING_APPROVAL) atomically. */
async function createRun(month, user) {
  const periodMonth = toMonthStart(month);
  const runId = await withTransaction(async (client) => {
    // serialise run creation for the same period (prevents two admins racing)
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`royalty-run:${periodMonth}:${SCOPE}`]);
    const calc = await compute(client, periodMonth, { lock: true });
    const t = calc.totals;
    const { rows } = await client.query(
      `INSERT INTO royalty_runs (period_month, scope, record_count, total_streams, total_revenue, total_sampling,
                                 total_gross, total_advance_deduction, total_net, calculated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [periodMonth, SCOPE, t.recordCount, t.streams, fromPaise(t.revenue), fromPaise(t.sampling),
        fromPaise(t.gross), fromPaise(t.advanceDeduction), fromPaise(t.net), user.id]
    );
    const id = rows[0].id;
    for (const tr of calc.tracks) {
      await client.query(
        `INSERT INTO royalty_run_tracks (run_id, track_id, split_version_id, streams, own_revenue, sampling_deduction, sampling_credit, distributable)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, tr.trackId, tr.splitVersionId, tr.streams, fromPaise(tr.ownRevenue), fromPaise(tr.samplingDeduction), fromPaise(tr.samplingCredit), fromPaise(tr.distributable)]
      );
    }
    for (const o of calc.obligations) {
      await client.query(
        `INSERT INTO royalty_sampling_obligations (run_id, source_track_id, sampled_track_id, percentage_bp, base_revenue, amount)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, o.sourceTrackId, o.sampledTrackId, o.percentageBp, fromPaise(o.baseRevenue), fromPaise(o.amount)]
      );
    }
    for (const l of calc.lines) {
      await client.query(
        `INSERT INTO royalty_details (run_id, track_id, contributor_id, split_version_id, share_bp, gross_amount, advance_deduction, net_amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, l.trackId, l.contributorId, l.splitVersionId, l.shareBp, fromPaise(l.gross), fromPaise(l.advanceDeduction), fromPaise(l.net)]
      );
    }
    // mark records as consumed -> they can never be counted twice
    const upd = await client.query(
      'UPDATE streaming_records SET royalty_run_id=$1 WHERE id = ANY($2) AND royalty_run_id IS NULL',
      [id, calc.recordIds]
    );
    if (upd.rowCount !== calc.recordIds.length) throw new ApiError(409, 'Streaming records changed during calculation; please retry');
    return id;
  });
  return getRun(runId);
}

async function listRuns() {
  const { rows } = await query(
    `SELECT r.id, to_char(r.period_month,'YYYY-MM') AS month, r.scope, r.status, r.record_count AS "recordCount",
            r.total_streams AS "totalStreams", r.total_revenue AS "totalRevenue", r.total_sampling AS "totalSampling",
            r.total_gross AS "totalGross", r.total_advance_deduction AS "totalAdvanceDeduction", r.total_net AS "totalNet",
            cu.username AS "calculatedBy", r.calculated_at AS "calculatedAt",
            au.username AS "approvedBy", r.approved_at AS "approvedAt",
            ru.username AS "rejectedBy", r.rejected_at AS "rejectedAt", r.rejection_reason AS "rejectionReason",
            (SELECT COUNT(*) FROM v_run_contributor_payables v WHERE v.run_id = r.id AND v.payment_status = 'PENDING') AS "pendingPayments",
            (SELECT COUNT(*) FROM payments p WHERE p.run_id = r.id) AS "paymentsMade"
       FROM royalty_runs r
       LEFT JOIN users cu ON cu.id = r.calculated_by
       LEFT JOIN users au ON au.id = r.approved_by
       LEFT JOIN users ru ON ru.id = r.rejected_by
      ORDER BY r.period_month DESC, r.id DESC`
  );
  return rows;
}

async function getRun(id) {
  const run = (await listRuns()).find((r) => r.id === Number(id));
  if (!run) throw new ApiError(404, 'Royalty run not found');
  const tracks = await query(
    `SELECT rt.track_id AS "trackId", t.title, t.isrc, rt.split_version_id AS "splitVersionId", sv.version_no AS "versionNo",
            rt.streams, rt.own_revenue AS "ownRevenue", rt.sampling_deduction AS "samplingDeduction",
            rt.sampling_credit AS "samplingCredit", rt.distributable,
            (SELECT json_agg(json_build_object('contributorId', d.contributor_id, 'name', c.name, 'shareBp', d.share_bp,
                    -- ::text keeps NUMERIC money exact (JSON numbers would become JS floats)
                    'gross', d.gross_amount::text, 'advanceDeduction', d.advance_deduction::text, 'net', d.net_amount::text) ORDER BY d.share_bp DESC)
               FROM royalty_details d JOIN contributors c ON c.id = d.contributor_id
              WHERE d.run_id = rt.run_id AND d.track_id = rt.track_id) AS lines
       FROM royalty_run_tracks rt JOIN tracks t ON t.id = rt.track_id JOIN split_versions sv ON sv.id = rt.split_version_id
      WHERE rt.run_id = $1 ORDER BY t.title`,
    [id]
  );
  const obligations = await query(
    `SELECT o.source_track_id AS "sourceTrackId", s.title AS "sourceTitle", o.sampled_track_id AS "sampledTrackId",
            d.title AS "sampledTitle", o.percentage_bp AS "percentageBp", o.base_revenue AS "baseRevenue", o.amount
       FROM royalty_sampling_obligations o JOIN tracks s ON s.id = o.source_track_id JOIN tracks d ON d.id = o.sampled_track_id
      WHERE o.run_id = $1 ORDER BY s.title`,
    [id]
  );
  const contributors = await query(
    `SELECT v.contributor_id AS "contributorId", v.contributor_name AS name, v.gross_amount AS gross,
            v.advance_deduction AS "advanceDeduction", v.net_amount AS net, v.payment_status AS "paymentStatus",
            v.payment_id AS "paymentId", v.paid_at AS "paidAt", v.payment_reference AS "paymentReference"
       FROM v_run_contributor_payables v WHERE v.run_id = $1 ORDER BY v.contributor_name`,
    [id]
  );
  return { ...run, tracks: tracks.rows, obligations: obligations.rows, contributors: contributors.rows };
}

/** Finance approval: recoup advances (FIFO, never below zero) and lock the run. */
async function approveRun(id, user) {
  await withTransaction(async (client) => {
    const run = (await client.query('SELECT id, status FROM royalty_runs WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!run) throw new ApiError(404, 'Royalty run not found');
    if (run.status !== 'PENDING_APPROVAL') throw new ApiError(409, `Run is ${run.status}; only runs pending approval can be approved`);

    const deductions = await client.query(
      `SELECT contributor_id, SUM(advance_deduction) AS amount FROM royalty_details
        WHERE run_id=$1 GROUP BY contributor_id HAVING SUM(advance_deduction) > 0`, [id]
    );
    for (const d of deductions.rows) {
      let remaining = toPaise(d.amount);
      const advs = await client.query(
        `SELECT id, outstanding_balance FROM advances WHERE contributor_id=$1 AND outstanding_balance > 0
          ORDER BY issued_on, id FOR UPDATE`, [d.contributor_id]
      );
      const available = advs.rows.reduce((a, r) => a + toPaise(r.outstanding_balance), 0n);
      if (available < remaining) {
        throw new ApiError(409, 'Advance balances changed after this run was calculated. Reject the run and recalculate.');
      }
      for (const a of advs.rows) {
        if (remaining === 0n) break;
        const bal = toPaise(a.outstanding_balance);
        const take = minBig(bal, remaining);
        remaining -= take;
        await client.query('UPDATE advances SET outstanding_balance = outstanding_balance - $1 WHERE id=$2', [fromPaise(take), a.id]);
        await client.query(
          `INSERT INTO advance_transactions (advance_id, txn_type, amount, balance_after, royalty_run_id, note, created_by)
           VALUES ($1,'RECOUPED',$2,$3,$4,$5,$6)`,
          [a.id, fromPaise(take), fromPaise(bal - take), id, `Recouped from royalty run #${id}`, user.id]
        );
      }
    }
    const due = await client.query('SELECT COUNT(*) AS n FROM v_run_contributor_payables WHERE run_id=$1 AND payment_status=$2', [id, 'PENDING']);
    await client.query(
      `UPDATE royalty_runs SET status=$1, approved_by=$2, approved_at=now() WHERE id=$3`,
      [due.rows[0].n === 0 ? 'PAID' : 'APPROVED', user.id, id]
    );
  });
  return getRun(id);
}

async function rejectRun(id, user, reason) {
  if (!String(reason || '').trim()) throw new ApiError(400, 'A rejection reason is required');
  await withTransaction(async (client) => {
    const run = (await client.query('SELECT status FROM royalty_runs WHERE id=$1 FOR UPDATE', [id])).rows[0];
    if (!run) throw new ApiError(404, 'Royalty run not found');
    if (run.status !== 'PENDING_APPROVAL') throw new ApiError(409, `Run is ${run.status}; only runs pending approval can be rejected`);
    await client.query(
      `UPDATE royalty_runs SET status='REJECTED', rejected_by=$1, rejected_at=now(), rejection_reason=$2 WHERE id=$3`,
      [user.id, reason, id]
    );
    // release the streaming records so a corrected run can include them (details stay as history)
    await client.query('UPDATE streaming_records SET royalty_run_id = NULL WHERE royalty_run_id = $1', [id]);
  });
  return getRun(id);
}

module.exports = { preview, createRun, listRuns, getRun, approveRun, rejectRun, compute, serialize };
