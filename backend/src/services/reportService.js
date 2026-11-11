// Streaming report import.
//  * Every original CSV line is stored as its own MongoDB document (streaming_reports collection).
//  * Lines whose ISRC matches a PostgreSQL track are normalized into streaming_records.
//  * Lines that don't match go to the MongoDB unmatched_reports collection for manual mapping.
//  * Duplicate imports are blocked by the report identifier (PLATFORM-YYYY-MM), the file hash
//    and the per-line source_row_id (unique in PostgreSQL and in both Mongo collections).
const crypto = require('crypto');
const { parse } = require('csv-parse/sync');
const { query, withTransaction } = require('../db/postgres');
const { collections } = require('../db/mongo');
const { ApiError } = require('../utils/errors');
const { toPaiseRounded, fromPaise } = require('../utils/money');
const { tryMonth, toMonthStart } = require('../utils/validate');

const REQUIRED = ['isrc', 'track_name', 'streams', 'revenue', 'month'];

function parseCsv(buffer) {
  let records;
  try {
    records = parse(buffer, {
      columns: true, // keep the original header names so the raw row is stored exactly as received
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });
  } catch (e) {
    throw new ApiError(400, `Could not parse CSV: ${e.message}`);
  }
  if (!records.length) throw new ApiError(400, 'The CSV file has no data rows');
  // case-insensitive column lookup: 'ISRC' / 'isrc' / 'Isrc' all work
  const colOf = Object.fromEntries(Object.keys(records[0]).map((k) => [k.trim().toLowerCase(), k]));
  const missing = REQUIRED.filter((c) => !colOf[c]);
  if (missing.length) throw new ApiError(400, `CSV is missing required column(s): ${missing.join(', ')}. Expected: ${REQUIRED.join(', ')}`);

  const errors = [];
  const rows = records.map((original, idx) => {
    const rowNumber = idx + 1;
    const raw = Object.fromEntries(REQUIRED.map((c) => [c, original[colOf[c]]]));
    const isrc = String(raw.isrc || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const streams = String(raw.streams || '').replace(/,/g, '');
    const revenuePaise = toPaiseRounded(raw.revenue);
    const month = tryMonth(raw.month);
    if (!isrc) errors.push(`Row ${rowNumber}: ISRC is empty`);
    if (!/^\d+$/.test(streams)) errors.push(`Row ${rowNumber}: streams must be a whole number`);
    if (revenuePaise === null) errors.push(`Row ${rowNumber}: revenue must be a non-negative number`);
    if (!month) errors.push(`Row ${rowNumber}: month must be YYYY-MM`);
    return { rowNumber, raw: original, isrc, trackName: raw.track_name, streams: Number(streams), revenuePaise, month };
  });
  if (errors.length) throw new ApiError(400, 'The CSV contains invalid rows; nothing was imported', { errors: errors.slice(0, 25) });
  const months = [...new Set(rows.map((r) => r.month))];
  if (months.length > 1) throw new ApiError(400, `A report must cover a single month; found ${months.join(', ')}`);
  return { rows, month: months[0] };
}

async function upload({ file, platformCode }, user) {
  if (!file) throw new ApiError(400, 'Please choose a CSV file');
  if (!/\.csv$/i.test(file.originalname)) throw new ApiError(400, 'Only .csv files are accepted');
  const platform = (await query('SELECT id, code, name FROM platforms WHERE code=$1', [String(platformCode || '').toUpperCase()])).rows[0];
  if (!platform) throw new ApiError(400, 'Please choose a valid platform');

  const { rows, month } = parseCsv(file.buffer);
  const periodMonth = `${month}-01`;
  const reportKey = `${platform.code}-${month}`;
  const fileHash = crypto.createHash('sha256').update(file.buffer).digest('hex');

  const dup = await query(
    `SELECT report_key FROM streaming_reports WHERE report_key=$1 OR file_hash=$2 OR (platform_id=$3 AND period_month=$4)`,
    [reportKey, fileHash, platform.id, periodMonth]
  );
  if (dup.rows[0]) throw new ApiError(409, `Duplicate import: report ${dup.rows[0].report_key} has already been imported`);

  const isrcs = [...new Set(rows.map((r) => r.isrc))];
  const tracks = (await query('SELECT id, isrc FROM tracks WHERE isrc = ANY($1)', [isrcs])).rows;
  const trackByIsrc = new Map(tracks.map((t) => [t.isrc, t.id]));

  let mongoWritten = false;
  try {
    return await withTransaction(async (client) => {
      let totalStreams = 0;
      let totalRevenue = 0n;
      let matched = 0;
      const { rows: rep } = await client.query(
        `INSERT INTO streaming_reports (report_key, platform_id, period_month, file_name, file_hash, total_rows, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [reportKey, platform.id, periodMonth, file.originalname, fileHash, rows.length, user.id]
      );
      const reportId = rep[0].id;
      const now = new Date();
      const rowDocs = [];
      const unmatchedDocs = [];

      for (const r of rows) {
        const sourceRowId = `${reportKey}:${r.rowNumber}`;
        const trackId = trackByIsrc.get(r.isrc);
        totalStreams += r.streams;
        totalRevenue += r.revenuePaise;
        let pgRecordId = null;
        if (trackId) {
          const ins = await client.query(
            `INSERT INTO streaming_records (report_id, track_id, platform_id, period_month, source_row_id,
                                            reported_isrc, reported_title, streams, revenue, match_method)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'AUTO') RETURNING id`,
            [reportId, trackId, platform.id, periodMonth, sourceRowId, r.isrc, r.trackName, r.streams, fromPaise(r.revenuePaise)]
          );
          pgRecordId = Number(ins.rows[0].id);
          matched += 1;
        }
        const base = {
          source_row_id: sourceRowId,
          report_key: reportKey,
          pg_report_id: reportId,
          platform: platform.code,
          month,
          row_number: r.rowNumber,
          original_row: r.raw,          // exactly as received
          file_name: file.originalname,
        };
        rowDocs.push({ ...base, status: trackId ? 'MATCHED' : 'UNMATCHED', matched_track_id: trackId || null, pg_record_id: pgRecordId, created_at: now });
        if (!trackId) {
          unmatchedDocs.push({
            ...base,
            isrc: r.isrc,
            track_name: r.trackName,
            streams: r.streams,
            revenue: fromPaise(r.revenuePaise),
            reason: 'ISRC not found in catalogue',
            status: 'UNMATCHED',
            created_at: now,
          });
        }
      }

      await client.query(
        `UPDATE streaming_reports SET matched_rows=$1, unmatched_rows=$2, total_streams=$3, total_revenue=$4 WHERE id=$5`,
        [matched, rows.length - matched, totalStreams, fromPaise(totalRevenue), reportId]
      );

      // Write raw rows to MongoDB before COMMIT; if Mongo fails, PostgreSQL rolls back.
      mongoWritten = true;
      await collections.reportRows().insertMany(rowDocs, { ordered: true });
      if (unmatchedDocs.length) await collections.unmatched().insertMany(unmatchedDocs, { ordered: true });

      return {
        reportId, reportKey, platform: platform.code, month,
        totalRows: rows.length, matchedRows: matched, unmatchedRows: rows.length - matched,
        totalStreams, totalRevenue: fromPaise(totalRevenue),
      };
    });
  } catch (err) {
    // compensate: the PostgreSQL transaction rolled back, so remove any Mongo docs of this attempt
    if (mongoWritten) {
      await collections.reportRows().deleteMany({ report_key: reportKey, pg_report_id: { $exists: true } }).catch(() => {});
      await collections.unmatched().deleteMany({ report_key: reportKey }).catch(() => {});
    }
    throw err;
  }
}

async function list() {
  const { rows } = await query(
    `SELECT r.id, r.report_key AS "reportKey", p.code AS platform, p.name AS "platformName",
            to_char(r.period_month,'YYYY-MM') AS month, r.file_name AS "fileName",
            r.total_rows AS "totalRows", r.matched_rows AS "matchedRows", r.unmatched_rows AS "unmatchedRows",
            r.total_streams AS "totalStreams", r.total_revenue AS "totalRevenue",
            u.username AS "uploadedBy", r.uploaded_at AS "uploadedAt"
       FROM streaming_reports r JOIN platforms p ON p.id = r.platform_id
       LEFT JOIN users u ON u.id = r.uploaded_by
      ORDER BY r.period_month DESC, p.code`
  );
  return rows;
}

async function rows(reportId) {
  const rep = (await query('SELECT report_key FROM streaming_reports WHERE id=$1', [reportId])).rows[0];
  if (!rep) throw new ApiError(404, 'Report not found');
  return collections.reportRows().find({ report_key: rep.report_key }, { projection: { _id: 0 } }).sort({ row_number: 1 }).toArray();
}

// ---------------- Unmatched rows ----------------

async function listUnmatched({ status = 'UNMATCHED' } = {}) {
  const filter = status === 'ALL' ? {} : { status };
  return collections.unmatched().find(filter, { projection: { _id: 0 } }).sort({ month: -1, report_key: 1, row_number: 1 }).toArray();
}

/**
 * Manually map an unmatched row to a catalogue track. The normalized financial record is
 * inserted in PostgreSQL; the original Mongo row is kept and only marked MAPPED.
 */
async function mapUnmatched(sourceRowId, trackId, user) {
  const tid = Number(trackId);
  if (!Number.isInteger(tid)) throw new ApiError(400, 'Please choose a track');
  const doc = await collections.unmatched().findOne({ source_row_id: sourceRowId });
  if (!doc) throw new ApiError(404, 'Unmatched row not found');
  if (doc.status !== 'UNMATCHED') throw new ApiError(409, 'This row has already been mapped');

  let warning = null;
  let mongoUpdated = false;
  const result = await withTransaction(async (client) => {
    const track = (await client.query('SELECT id, title, isrc FROM tracks WHERE id=$1', [tid])).rows[0];
    if (!track) throw new ApiError(404, 'Track not found');
    const rep = (await client.query('SELECT id, platform_id, period_month FROM streaming_reports WHERE report_key=$1 FOR UPDATE', [doc.report_key])).rows[0];
    if (!rep) throw new ApiError(404, 'Parent report not found in PostgreSQL');

    const ins = await client.query(
      `INSERT INTO streaming_records (report_id, track_id, platform_id, period_month, source_row_id,
                                      reported_isrc, reported_title, streams, revenue, match_method, mapped_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'MANUAL',$10) RETURNING id`,
      [rep.id, tid, rep.platform_id, rep.period_month, sourceRowId, doc.isrc, doc.track_name, doc.streams, doc.revenue, user.id]
    );
    await client.query('UPDATE streaming_reports SET matched_rows = matched_rows + 1, unmatched_rows = unmatched_rows - 1 WHERE id=$1', [rep.id]);

    const run = await client.query(
      `SELECT id, status FROM royalty_runs WHERE period_month=$1 AND status <> 'REJECTED'`, [toMonthStart(doc.month)]
    );
    if (run.rows[0]) {
      warning = `Royalty run #${run.rows[0].id} for ${doc.month} already exists (${run.rows[0].status}); this record will be included only if that run is rejected and recalculated.`;
    }

    const upd = await collections.unmatched().updateOne(
      { source_row_id: sourceRowId, status: 'UNMATCHED' },
      { $set: { status: 'MAPPED', mapped_track_id: tid, mapped_track_title: track.title, mapped_track_isrc: track.isrc,
                pg_record_id: Number(ins.rows[0].id), mapped_by: user.username, mapped_at: new Date() } }
    );
    if (upd.modifiedCount !== 1) throw new ApiError(409, 'This row was mapped concurrently');
    mongoUpdated = true;
    await collections.reportRows().updateOne(
      { source_row_id: sourceRowId },
      { $set: { status: 'MAPPED', matched_track_id: tid, pg_record_id: Number(ins.rows[0].id) } }
    );
    return { sourceRowId, trackId: tid, trackTitle: track.title, streamingRecordId: Number(ins.rows[0].id) };
  }).catch(async (err) => {
    if (!mongoUpdated) throw err;
    // PostgreSQL failed after Mongo was updated (e.g. at COMMIT): put the Mongo row back to UNMATCHED
    await collections.unmatched().updateOne(
      { source_row_id: sourceRowId, status: 'MAPPED' },
      { $set: { status: 'UNMATCHED' }, $unset: { mapped_track_id: '', mapped_track_title: '', mapped_track_isrc: '', pg_record_id: '', mapped_by: '', mapped_at: '' } }
    ).catch(() => {});
    await collections.reportRows().updateOne(
      { source_row_id: sourceRowId, status: 'MAPPED' },
      { $set: { status: 'UNMATCHED', matched_track_id: null, pg_record_id: null } }
    ).catch(() => {});
    throw err;
  });
  return { ...result, warning };
}

module.exports = { upload, list, rows, listUnmatched, mapUnmatched, parseCsv };
