-- Shows that PostgreSQL itself enforces the business rules (every statement here FAILS on purpose).
-- Run (PowerShell, in the project folder):
--   cmd /c "type db-queries\postgres_constraints_demo.sql | docker exec -i mrms-postgres psql -U royalty -d royalty_db 2>&1"
-- Nothing is changed: each failing statement is rolled back.
\pset pager off

\echo '--- 1. Duplicate ISRC (UNIQUE constraint) ---'
INSERT INTO tracks (title, isrc) VALUES ('Copy of Midnight Drive', 'IN001');

\echo '--- 2. Split that totals 90% (deferred trigger checks SUM = 10000 at COMMIT) ---'
BEGIN;
INSERT INTO split_versions (track_id, version_no, effective_from) VALUES (3, 99, '2026-12-01');
INSERT INTO track_splits (split_version_id, contributor_id, share_bp)
  VALUES (currval('split_versions_id_seq'), 6, 9000);
COMMIT;

\echo '--- 3. Modifying an approved split share (immutable history trigger) ---'
UPDATE track_splits SET share_bp = 9999 WHERE id = (SELECT MIN(id) FROM track_splits);

\echo '--- 4. Deleting a payment (append-only payments) ---'
DELETE FROM payments WHERE id = (SELECT MIN(id) FROM payments);

\echo '--- 5. Second royalty run for an already-run month (partial UNIQUE index) ---'
INSERT INTO royalty_runs (period_month, record_count, total_streams, total_revenue, total_sampling, total_gross, total_advance_deduction, total_net)
VALUES ('2026-09-01', 0, 0, 0, 0, 0, 0, 0);

\echo '--- 6. Paying the same contributor twice for one run (UNIQUE run_id, contributor_id) ---'
INSERT INTO payments (run_id, contributor_id, amount, idempotency_key)
SELECT run_id, contributor_id, amount, 'another-key-123' FROM payments ORDER BY id LIMIT 1;

\echo '--- 7. Advance outstanding below zero (CHECK constraint) ---'
UPDATE advances SET outstanding_balance = -1 WHERE id = (SELECT MIN(id) FROM advances);
