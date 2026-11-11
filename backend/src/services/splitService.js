const { query, withTransaction } = require('../db/postgres');
const { ApiError } = require('../utils/errors');
const { toMonthStart } = require('../utils/validate');

const VERSION_SQL = `
  SELECT sv.id, sv.track_id AS "trackId", t.title AS "trackTitle", t.isrc,
         sv.version_no AS "versionNo", sv.status, sv.effective_from AS "effectiveFrom", sv.notes,
         sv.created_at AS "createdAt", sv.activated_at AS "activatedAt", sv.closed_at AS "closedAt",
         u.full_name AS "createdBy",
         (SELECT json_agg(json_build_object(
                    'contributorId', ts.contributor_id, 'name', c.name, 'role', c.role, 'shareBp', ts.share_bp,
                    'approvalStatus', sa.status, 'comment', sa.comment, 'decidedAt', sa.decided_at)
                  ORDER BY ts.share_bp DESC, c.name)
            FROM track_splits ts
            JOIN contributors c ON c.id = ts.contributor_id
            JOIN split_approvals sa ON sa.split_version_id = ts.split_version_id AND sa.contributor_id = ts.contributor_id
           WHERE ts.split_version_id = sv.id) AS shares
    FROM split_versions sv
    JOIN tracks t ON t.id = sv.track_id
    LEFT JOIN users u ON u.id = sv.created_by`;

async function assertTrackAccess(trackId, user) {
  if (user.role !== 'CONTRIBUTOR') return;
  const { rowCount } = await query(
    `SELECT 1 FROM track_contributors WHERE track_id=$1 AND contributor_id=$2
     UNION SELECT 1 FROM track_splits ts JOIN split_versions sv ON sv.id = ts.split_version_id
           WHERE sv.track_id=$1 AND ts.contributor_id=$2`,
    [trackId, user.contributorId]
  );
  if (!rowCount) throw new ApiError(403, 'You can only view agreements for your own tracks');
}

async function listForTrack(trackId, user) {
  await assertTrackAccess(trackId, user);
  const { rows } = await query(`${VERSION_SQL} WHERE sv.track_id = $1 ORDER BY sv.version_no DESC`, [trackId]);
  return rows;
}

async function listAll({ status } = {}) {
  const params = [];
  let where = '';
  if (status) { params.push(status); where = 'WHERE sv.status = $1'; }
  const { rows } = await query(`${VERSION_SQL} ${where} ORDER BY sv.created_at DESC`, params);
  return rows;
}

/** All versions a contributor is party to (their agreements + pending approvals). */
async function listForContributor(contributorId) {
  const { rows } = await query(
    `${VERSION_SQL}
      WHERE EXISTS (SELECT 1 FROM track_splits x WHERE x.split_version_id = sv.id AND x.contributor_id = $1)
      ORDER BY (sv.status = 'PENDING_APPROVAL') DESC, sv.created_at DESC`,
    [contributorId]
  );
  return rows;
}

/**
 * Create a new split version. Previous versions are never touched - they stay in
 * history with their approvals. The new version becomes ACTIVE only after every
 * contributor in it has approved.
 */
async function create(trackId, body, user) {
  const shares = Array.isArray(body.shares) ? body.shares : [];
  if (shares.length === 0) throw new ApiError(400, 'At least one contributor share is required');

  const seen = new Set();
  let total = 0;
  const clean = shares.map((s, i) => {
    const contributorId = Number(s.contributorId);
    const shareBp = Number(s.shareBp);
    if (!Number.isInteger(contributorId)) throw new ApiError(400, `Row ${i + 1}: contributor is required`);
    if (seen.has(contributorId)) throw new ApiError(400, 'A contributor can appear only once in a split');
    if (!Number.isInteger(shareBp) || shareBp <= 0 || shareBp > 10000) {
      throw new ApiError(400, `Row ${i + 1}: share must be between 0.01% and 100% (1-10000 basis points)`);
    }
    seen.add(contributorId);
    total += shareBp;
    return { contributorId, shareBp };
  });
  if (total !== 10000) {
    throw new ApiError(400, `Split total must be exactly 100.00% (10000 bp). Current total: ${(total / 100).toFixed(2)}%`, { totalBp: total });
  }

  const effectiveFrom = toMonthStart(body.effectiveFrom || new Date().toISOString().slice(0, 7), 'Effective month');

  const versionId = await withTransaction(async (client) => {
    const t = await client.query('SELECT id FROM tracks WHERE id=$1 FOR UPDATE', [trackId]);
    if (!t.rows[0]) throw new ApiError(404, 'Track not found');

    const pending = await client.query(
      `SELECT version_no FROM split_versions WHERE track_id=$1 AND status='PENDING_APPROVAL'`, [trackId]
    );
    if (pending.rows[0]) {
      throw new ApiError(409, `Version ${pending.rows[0].version_no} is still awaiting approval. It must be approved or rejected before a new version can be created.`);
    }
    const latestApproved = await client.query(
      `SELECT MAX(effective_from) AS m FROM split_versions WHERE track_id=$1 AND status IN ('ACTIVE','SUPERSEDED')`, [trackId]
    );
    if (latestApproved.rows[0].m && effectiveFrom < latestApproved.rows[0].m) {
      throw new ApiError(400, `Effective month cannot be earlier than the current agreement (${latestApproved.rows[0].m.slice(0, 7)})`);
    }

    const contribs = await client.query('SELECT id, role FROM contributors WHERE id = ANY($1)', [clean.map((s) => s.contributorId)]);
    if (contribs.rowCount !== clean.length) throw new ApiError(400, 'One or more contributors do not exist');

    const next = await client.query('SELECT COALESCE(MAX(version_no),0)+1 AS v FROM split_versions WHERE track_id=$1', [trackId]);
    const { rows } = await client.query(
      `INSERT INTO split_versions (track_id, version_no, effective_from, notes, created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [trackId, next.rows[0].v, effectiveFrom, body.notes || null, user.id]
    );
    const vid = rows[0].id;
    for (const s of clean) {
      await client.query('INSERT INTO track_splits (split_version_id, contributor_id, share_bp) VALUES ($1,$2,$3)', [vid, s.contributorId, s.shareBp]);
      await client.query('INSERT INTO split_approvals (split_version_id, contributor_id) VALUES ($1,$2)', [vid, s.contributorId]);
      const role = contribs.rows.find((c) => c.id === s.contributorId).role;
      await client.query(
        `INSERT INTO track_contributors (track_id, contributor_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [trackId, s.contributorId, role]
      );
    }
    return vid; // deferred trigger re-checks the 100% total at COMMIT
  });
  return getVersion(versionId);
}

async function getVersion(id) {
  const { rows } = await query(`${VERSION_SQL} WHERE sv.id = $1`, [id]);
  if (!rows[0]) throw new ApiError(404, 'Split version not found');
  return rows[0];
}

/** A contributor approves or rejects ONLY their own allocation. */
async function decide(versionId, user, decision, comment) {
  if (user.role !== 'CONTRIBUTOR' || !user.contributorId) {
    throw new ApiError(403, 'Only the contributor named in the split can approve or reject it');
  }
  const d = String(decision || '').toUpperCase();
  if (!['APPROVED', 'REJECTED'].includes(d)) throw new ApiError(400, 'decision must be APPROVED or REJECTED');
  if (d === 'REJECTED' && !String(comment || '').trim()) throw new ApiError(400, 'Please give a reason for rejecting');

  await withTransaction(async (client) => {
    const v = await client.query('SELECT id, track_id, status FROM split_versions WHERE id=$1 FOR UPDATE', [versionId]);
    if (!v.rows[0]) throw new ApiError(404, 'Split version not found');
    const a = await client.query(
      'SELECT status FROM split_approvals WHERE split_version_id=$1 AND contributor_id=$2 FOR UPDATE',
      [versionId, user.contributorId]
    );
    if (!a.rows[0]) throw new ApiError(403, 'You are not a party to this split agreement');
    if (v.rows[0].status !== 'PENDING_APPROVAL') throw new ApiError(409, `This version is ${v.rows[0].status} and can no longer be changed`);
    if (a.rows[0].status !== 'PENDING') throw new ApiError(409, `You already ${a.rows[0].status.toLowerCase()} this version`);

    await client.query(
      `UPDATE split_approvals SET status=$1, comment=$2, decided_by=$3, decided_at=now()
        WHERE split_version_id=$4 AND contributor_id=$5`,
      [d, comment || null, user.id, versionId, user.contributorId]
    );

    if (d === 'REJECTED') {
      await client.query(`UPDATE split_versions SET status='REJECTED', closed_at=now() WHERE id=$1`, [versionId]);
      return;
    }
    const remaining = await client.query(
      `SELECT COUNT(*) FILTER (WHERE status <> 'APPROVED') AS open FROM split_approvals WHERE split_version_id=$1`, [versionId]
    );
    if (remaining.rows[0].open === 0) {
      // all approved -> previous ACTIVE becomes SUPERSEDED (kept for history), this one becomes ACTIVE
      await client.query(
        `UPDATE split_versions SET status='SUPERSEDED', closed_at=now() WHERE track_id=$1 AND status='ACTIVE'`,
        [v.rows[0].track_id]
      );
      await client.query(`UPDATE split_versions SET status='ACTIVE', activated_at=now() WHERE id=$1`, [versionId]);
    }
  });
  return getVersion(versionId);
}

/**
 * Applicable approved split per track for a period: the latest version that was
 * approved (ACTIVE or SUPERSEDED) and whose effective month is on/before the period.
 */
async function applicableVersions(client, trackIds, periodMonth) {
  if (!trackIds.length) return new Map();
  const { rows } = await client.query(
    `SELECT DISTINCT ON (sv.track_id) sv.id, sv.track_id, sv.version_no
       FROM split_versions sv
      WHERE sv.track_id = ANY($1) AND sv.status IN ('ACTIVE','SUPERSEDED') AND sv.effective_from <= $2
      ORDER BY sv.track_id, sv.effective_from DESC, sv.version_no DESC`,
    [trackIds, periodMonth]
  );
  const shares = await client.query(
    `SELECT ts.split_version_id, ts.contributor_id, ts.share_bp, c.name
       FROM track_splits ts JOIN contributors c ON c.id = ts.contributor_id
      WHERE ts.split_version_id = ANY($1)
      ORDER BY ts.share_bp DESC, ts.contributor_id`,
    [rows.map((r) => r.id)]
  );
  const map = new Map();
  for (const r of rows) {
    map.set(r.track_id, {
      splitVersionId: r.id,
      versionNo: r.version_no,
      shares: shares.rows.filter((s) => s.split_version_id === r.id)
        .map((s) => ({ contributorId: s.contributor_id, name: s.name, shareBp: s.share_bp })),
    });
  }
  return map;
}

module.exports = { listForTrack, listAll, listForContributor, create, decide, getVersion, applicableVersions };
