-- PostgreSQL demo queries (financial source of truth)
-- Run (PowerShell, in the project folder):
--   cmd /c "type db-queries\postgres_demo.sql | docker exec -i mrms-postgres psql -U royalty -d royalty_db 2>&1"
\pset pager off
\echo '================ ALL TABLES ================'
\dt

\echo '================ 1. USERS (bcrypt hashed passwords) ================'
SELECT id, username, role, full_name, left(password_hash, 20) || '...' AS password_hash FROM users ORDER BY id;

\echo '================ 2. CONTRIBUTORS (linked to login accounts) ================'
SELECT c.id, c.name, c.role, c.email, u.username AS login FROM contributors c LEFT JOIN users u ON u.id = c.user_id ORDER BY c.id;

\echo '================ 3. TRACKS + PLATFORM IDENTIFIERS ================'
SELECT t.id, t.title, t.isrc, t.album, t.release_date,
       string_agg(p.code || '=' || ti.external_id, ', ') AS platform_ids
FROM tracks t LEFT JOIN track_identifiers ti ON ti.track_id = t.id LEFT JOIN platforms p ON p.id = ti.platform_id
GROUP BY t.id ORDER BY t.id;

\echo '================ 4. SPLIT VERSIONS (history is never overwritten) ================'
SELECT sv.id, t.title, sv.version_no, sv.status, sv.effective_from, sv.activated_at::timestamp(0)
FROM split_versions sv JOIN tracks t ON t.id = sv.track_id ORDER BY t.title, sv.version_no;

\echo '================ 5. SPLIT SHARES (basis points, 10000 = 100%) + APPROVALS ================'
SELECT t.title, sv.version_no, c.name, ts.share_bp, (ts.share_bp / 100.0)::numeric(5,2) || '%' AS percent,
       sa.status AS approval, sa.decided_at::timestamp(0)
FROM track_splits ts
JOIN split_versions sv ON sv.id = ts.split_version_id
JOIN tracks t ON t.id = sv.track_id
JOIN contributors c ON c.id = ts.contributor_id
JOIN split_approvals sa ON sa.split_version_id = ts.split_version_id AND sa.contributor_id = ts.contributor_id
ORDER BY t.title, sv.version_no, ts.share_bp DESC;

\echo '================ 6. STREAMING REPORTS (unique report id + file hash) ================'
SELECT r.report_key, p.name AS platform, r.period_month, r.total_rows, r.matched_rows, r.unmatched_rows, r.total_revenue
FROM streaming_reports r JOIN platforms p ON p.id = r.platform_id ORDER BY r.period_month, r.report_key;

\echo '================ 7. NORMALIZED STREAMING RECORDS (matched rows only) ================'
SELECT sr.id, sr.source_row_id, t.title, sr.streams, sr.revenue, sr.match_method, sr.royalty_run_id
FROM streaming_records sr JOIN tracks t ON t.id = sr.track_id ORDER BY sr.period_month, sr.source_row_id;

\echo '================ 8. ADVANCES + TRANSACTION HISTORY ================'
SELECT a.id, c.name, a.original_amount, a.outstanding_balance FROM advances a JOIN contributors c ON c.id = a.contributor_id;
SELECT t.id, c.name, t.txn_type, t.amount, t.balance_after, t.royalty_run_id, t.note
FROM advance_transactions t JOIN advances a ON a.id = t.advance_id JOIN contributors c ON c.id = a.contributor_id ORDER BY t.id;

\echo '================ 9. ROYALTY RUNS ================'
SELECT id, period_month, scope, status, total_revenue, total_sampling, total_gross, total_advance_deduction, total_net
FROM royalty_runs ORDER BY id;

\echo '================ 10. PER-TRACK RESULT (with exact split version used) ================'
SELECT rt.run_id, t.title, sv.version_no AS split_version, rt.own_revenue, rt.sampling_deduction, rt.sampling_credit, rt.distributable
FROM royalty_run_tracks rt JOIN tracks t ON t.id = rt.track_id JOIN split_versions sv ON sv.id = rt.split_version_id
ORDER BY rt.run_id, t.title;

\echo '================ 11. SAMPLING OBLIGATIONS USED (snapshot from Neo4j) ================'
SELECT o.run_id, s.title AS source_track, d.title AS sampled_track, o.percentage_bp, o.base_revenue, o.amount
FROM royalty_sampling_obligations o JOIN tracks s ON s.id = o.source_track_id JOIN tracks d ON d.id = o.sampled_track_id;

\echo '================ 12. CONTRIBUTOR-WISE ROYALTY DETAILS ================'
SELECT d.run_id, t.title, c.name, d.share_bp, d.gross_amount, d.advance_deduction, d.net_amount
FROM royalty_details d JOIN tracks t ON t.id = d.track_id JOIN contributors c ON c.id = d.contributor_id
ORDER BY d.run_id, t.title, d.share_bp DESC;

\echo '================ 13. PAYMENTS (append-only, idempotent) ================'
SELECT p.id, p.run_id, c.name, p.amount, p.payment_reference, left(p.idempotency_key, 12) || '...' AS idempotency_key, p.paid_at::timestamp(0)
FROM payments p JOIN contributors c ON c.id = p.contributor_id ORDER BY p.id;

\echo '================ 14. VIEW: payable status per contributor per run ================'
SELECT run_id, contributor_name, gross_amount, advance_deduction, net_amount, payment_status FROM v_run_contributor_payables ORDER BY run_id, contributor_name;
