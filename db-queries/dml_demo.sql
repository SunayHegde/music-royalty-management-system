-- DML demo: INSERT / UPDATE / UPSERT / DELETE / SELECT with RETURNING.
-- Everything runs inside one transaction that is ROLLED BACK at the end,
-- so it is safe to run live in front of an examiner - no data changes.
-- Run (PowerShell, in the project folder):
--   cmd /c "type db-queries\dml_demo.sql | docker exec -i mrms-postgres psql -U royalty -d royalty_db 2>&1"
\pset pager off
BEGIN;

\echo '--- INSERT a track (as the Tracks page does) ---'
INSERT INTO tracks (title, isrc, album, release_date)
VALUES ('Demo Track', 'IN099', 'Demo Album', '2026-11-01')
RETURNING id, title, isrc, created_at::timestamp(0);

\echo '--- INSERT a platform identifier for it (sub-select for the foreign keys) ---'
INSERT INTO track_identifiers (track_id, platform_id, external_id)
SELECT t.id, p.id, 'sp_demo099' FROM tracks t, platforms p WHERE t.isrc = 'IN099' AND p.code = 'SPOTIFY'
RETURNING *;

\echo '--- UPDATE the album (as the Edit track form does) ---'
UPDATE tracks SET album = 'Demo Album (Deluxe)', updated_at = now()
WHERE isrc = 'IN099'
RETURNING id, title, album;

\echo '--- UPSERT: link contributor to track, ignore if already linked (ON CONFLICT DO NOTHING) ---'
INSERT INTO track_contributors (track_id, contributor_id, role)
SELECT id, 1, 'SINGER' FROM tracks WHERE isrc = 'IN099'
ON CONFLICT DO NOTHING
RETURNING *;
INSERT INTO track_contributors (track_id, contributor_id, role)
SELECT id, 1, 'SINGER' FROM tracks WHERE isrc = 'IN099'
ON CONFLICT DO NOTHING
RETURNING *;

\echo '--- UPDATE with arithmetic (advance recoupment pattern) ---'
INSERT INTO advances (contributor_id, original_amount, outstanding_balance, description)
VALUES (2, 1500.00, 1500.00, 'Demo advance') RETURNING id, original_amount, outstanding_balance;
UPDATE advances SET outstanding_balance = outstanding_balance - 1000.00
WHERE description = 'Demo advance'
RETURNING id, original_amount, outstanding_balance;

\echo '--- DELETE the identifier and the track (allowed: no history refers to them) ---'
DELETE FROM track_identifiers WHERE external_id = 'sp_demo099' RETURNING id, external_id;
DELETE FROM track_contributors WHERE track_id = (SELECT id FROM tracks WHERE isrc = 'IN099') RETURNING *;
DELETE FROM tracks WHERE isrc = 'IN099' RETURNING id, title;

\echo '--- SELECT with JOIN + GROUP BY: revenue per platform per month ---'
SELECT to_char(sr.period_month, 'YYYY-MM') AS month, p.name AS platform,
       COUNT(*) AS records, SUM(sr.streams) AS streams, SUM(sr.revenue) AS revenue
FROM streaming_records sr JOIN platforms p ON p.id = sr.platform_id
GROUP BY sr.period_month, p.name
ORDER BY month, platform;

ROLLBACK;
\echo '--- ROLLBACK done: the database is unchanged ---'
