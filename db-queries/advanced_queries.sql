-- Advanced SQL demo: joins, nested & correlated subqueries, recursive CTE,
-- stored function, stored procedure, and role-based access control (DCL + RLS).
-- Run (PowerShell, in the project folder):
--   cmd /c "type db-queries\advanced_queries.sql | docker exec -i mrms-postgres psql -U royalty -d royalty_db 2>&1"
-- Best run after the full demo (or `npm run test:e2e`) so every table has data.
\pset pager off

\echo '================ Q1. INNER JOIN (4 tables): contributor lines of each royalty run ================'
SELECT r.id AS run, to_char(r.period_month, 'YYYY-MM') AS month, t.title, c.name, sv.version_no AS split_v,
       d.share_bp, d.gross_amount, d.advance_deduction, d.net_amount
FROM royalty_details d
JOIN royalty_runs   r  ON r.id  = d.run_id
JOIN tracks         t  ON t.id  = d.track_id
JOIN contributors   c  ON c.id  = d.contributor_id
JOIN split_versions sv ON sv.id = d.split_version_id
WHERE r.status <> 'REJECTED'
ORDER BY r.id, t.title, d.share_bp DESC;

\echo '================ Q2. LEFT JOIN + GROUP BY: every track with its total streams and revenue (0 if none) ================'
SELECT t.title, t.isrc, COUNT(sr.id) AS records,
       COALESCE(SUM(sr.streams), 0) AS streams, COALESCE(SUM(sr.revenue), 0) AS revenue
FROM tracks t
LEFT JOIN streaming_records sr ON sr.track_id = t.id
GROUP BY t.id, t.title, t.isrc
ORDER BY revenue DESC;

\echo '================ Q3. NESTED subquery: tracks that earned more than the average track in Oct 2026 ================'
SELECT t.title, SUM(sr.revenue) AS oct_revenue
FROM streaming_records sr JOIN tracks t ON t.id = sr.track_id
WHERE sr.period_month = '2026-10-01'
GROUP BY t.title
HAVING SUM(sr.revenue) > (SELECT AVG(track_total)
                            FROM (SELECT SUM(revenue) AS track_total
                                    FROM streaming_records
                                   WHERE period_month = '2026-10-01'
                                   GROUP BY track_id) AS per_track);

\echo '================ Q4. CORRELATED subquery: each contributor''s best-paid line vs. the run average ================'
SELECT c.name, d.run_id, t.title, d.net_amount,
       (SELECT ROUND(AVG(d2.net_amount), 2) FROM royalty_details d2 WHERE d2.run_id = d.run_id) AS run_avg
FROM royalty_details d
JOIN royalty_runs r ON r.id = d.run_id AND r.status <> 'REJECTED'
JOIN contributors c ON c.id = d.contributor_id
JOIN tracks t ON t.id = d.track_id
WHERE d.net_amount = (SELECT MAX(d3.net_amount)            -- correlated on the outer row's contributor
                        FROM royalty_details d3
                        JOIN royalty_runs r3 ON r3.id = d3.run_id AND r3.status <> 'REJECTED'
                       WHERE d3.contributor_id = d.contributor_id)
ORDER BY d.net_amount DESC;

\echo '================ Q5. EXISTS / NOT EXISTS: contributors with a login who have never been paid ================'
SELECT c.name, u.username
FROM contributors c JOIN users u ON u.id = c.user_id
WHERE NOT EXISTS (SELECT 1 FROM payments p WHERE p.contributor_id = c.id);

\echo '================ Q6. RECURSIVE CTE: month calendar with revenue (months without reports show 0) ================'
WITH RECURSIVE months(m) AS (
  SELECT DATE '2026-08-01'
  UNION ALL
  SELECT (m + INTERVAL '1 month')::DATE FROM months WHERE m < DATE '2026-11-01'
)
SELECT to_char(m, 'YYYY-MM') AS month,
       COALESCE(SUM(sr.streams), 0) AS streams,
       COALESCE(SUM(sr.revenue), 0) AS revenue
FROM months
LEFT JOIN streaming_records sr ON sr.period_month = months.m
GROUP BY m ORDER BY m;

\echo '================ Q7. RECURSIVE CTE: split-version history chain per track (v1 -> v2 -> ...) ================'
WITH RECURSIVE chain AS (
  SELECT sv.track_id, sv.version_no, sv.status, sv.version_no::TEXT AS path
    FROM split_versions sv WHERE sv.version_no = 1
  UNION ALL
  SELECT nx.track_id, nx.version_no, nx.status, c.path || ' -> v' || nx.version_no
    FROM split_versions nx JOIN chain c ON nx.track_id = c.track_id AND nx.version_no = c.version_no + 1
)
SELECT t.title, 'v' || ch.path AS version_chain, ch.status AS latest_status
FROM chain ch JOIN tracks t ON t.id = ch.track_id
WHERE NOT EXISTS (SELECT 1 FROM split_versions s WHERE s.track_id = ch.track_id AND s.version_no = ch.version_no + 1)
ORDER BY t.title;

\echo '================ Q8. CTE + window function: running advance balance per contributor ================'
WITH txns AS (
  SELECT c.name, t.created_at, t.txn_type,
         CASE WHEN t.txn_type = 'ISSUED' THEN t.amount ELSE -t.amount END AS signed_amount
  FROM advance_transactions t JOIN advances a ON a.id = t.advance_id JOIN contributors c ON c.id = a.contributor_id
)
SELECT name, txn_type, signed_amount,
       SUM(signed_amount) OVER (PARTITION BY name ORDER BY created_at) AS running_balance
FROM txns ORDER BY name, created_at;

\echo '================ Q9. STORED FUNCTION (uses a CTE): lifetime earnings of every contributor ================'
SELECT c.name, e.*
FROM contributors c CROSS JOIN LATERAL fn_contributor_earnings(c.id) AS e
ORDER BY e.net DESC;

\echo '================ Q10. STORED PROCEDURE: rejecting run #1 (September, already PAID) is refused ================'
CALL sp_reject_royalty_run(1, 5, 'demo');

\echo '================ Q11. DCL: database roles and their privileges on the payments table ================'
SELECT grantee, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privileges
FROM information_schema.role_table_grants
WHERE table_name = 'payments' AND grantee LIKE 'mrms_%'
GROUP BY grantee ORDER BY grantee;

\echo '================ Q12. RLS: as role mrms_contributor (contributor 1 = Rahul) only own lines are visible ================'
BEGIN;
SET LOCAL ROLE mrms_contributor;
SELECT set_config('app.contributor_id', '1', true) AS contributor_id;
SELECT run_id, contributor_id, gross_amount, net_amount FROM royalty_details;
\echo '--- and a contributor may not delete payments:'
DELETE FROM payments;
ROLLBACK;
