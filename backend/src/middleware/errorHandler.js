const { ApiError } = require('../utils/errors');

// Translate database errors into meaningful HTTP responses.
function errorHandler(err, _req, res, _next) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: 'File is too large (max 5 MB)' });
  }
  // PostgreSQL error codes
  switch (err && err.code) {
    case '23505':
      return res.status(409).json({ error: friendlyUnique(err), constraint: err.constraint });
    case '23503':
      return res.status(400).json({ error: 'Referenced record does not exist', constraint: err.constraint });
    case '23514':
      return res.status(400).json({ error: `Value violates a data rule (${err.constraint})` });
    case 'P0001':
      return res.status(409).json({ error: err.message });
    case '40001':
      return res.status(409).json({ error: 'Concurrent update detected, please retry' });
    default:
      break;
  }
  // MongoDB duplicate key
  if (err && err.code === 11000) {
    return res.status(409).json({ error: 'Duplicate report row (source row already imported)' });
  }
  console.error('[error]', err);
  return res.status(500).json({ error: 'Internal server error' });
}

function friendlyUnique(err) {
  const map = {
    tracks_isrc_key: 'A track with this ISRC already exists',
    contributors_email_key: 'A contributor with this email already exists',
    contributors_user_id_key: 'That login account is already linked to another contributor',
    users_username_key: 'That username is already taken',
    streaming_reports_report_key_key: 'This report (platform + month) has already been imported',
    streaming_reports_file_hash_key: 'This exact file has already been imported',
    streaming_reports_platform_id_period_month_key: 'A report for this platform and month has already been imported',
    streaming_records_source_row_id_key: 'This source row has already been imported',
    uq_royalty_run_period_scope: 'A royalty run already exists for this reporting period and scope',
    payments_run_id_contributor_id_key: 'This contributor has already been paid for this run',
    payments_idempotency_key_key: 'Duplicate payment request',
    track_identifiers_platform_id_external_id_key: 'That platform identifier is already used by another track',
    uq_split_pending_per_track: 'This track already has a split version awaiting approval',
    uq_split_active_per_track: 'This track already has an active split',
  };
  return map[err.constraint] || 'Duplicate value violates a unique constraint';
}

module.exports = { errorHandler };
