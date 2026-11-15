-- =====================================================================
-- Music Royalty Management System - PostgreSQL schema
-- PostgreSQL is the authoritative source for all financial data.
--   * money        -> NUMERIC(18,2)
--   * percentages  -> INTEGER basis points (10000 = 100.00%)
--   * history tables are protected by triggers (no UPDATE / DELETE)
-- The script is idempotent: it can be re-run safely.
-- =====================================================================

-- ---------- Users & contributors ----------
CREATE TABLE IF NOT EXISTS users (
  id             SERIAL PRIMARY KEY,
  username       VARCHAR(50)  NOT NULL UNIQUE,
  password_hash  VARCHAR(100) NOT NULL,
  full_name      VARCHAR(120) NOT NULL,
  role           VARCHAR(20)  NOT NULL CHECK (role IN ('ADMIN','CONTRIBUTOR','FINANCE')),
  is_active      BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS contributors (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  email       VARCHAR(160) NOT NULL UNIQUE,
  role        VARCHAR(20)  NOT NULL CHECK (role IN ('SINGER','PRODUCER','SONGWRITER','COMPOSER')),
  user_id     INT UNIQUE REFERENCES users(id) ON DELETE SET NULL,  -- linked login account
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Platforms & tracks ----------
CREATE TABLE IF NOT EXISTS platforms (
  id    SMALLSERIAL PRIMARY KEY,
  code  VARCHAR(30)  NOT NULL UNIQUE,
  name  VARCHAR(80)  NOT NULL
);

CREATE TABLE IF NOT EXISTS tracks (
  id            SERIAL PRIMARY KEY,
  title         VARCHAR(200) NOT NULL,
  isrc          VARCHAR(15)  NOT NULL UNIQUE CHECK (isrc ~ '^[A-Z0-9]{3,15}$'),
  album         VARCHAR(200),
  release_date  DATE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_tracks_title ON tracks (lower(title));

-- platform specific identifiers (Spotify track id, Apple id, YouTube video id ...)
CREATE TABLE IF NOT EXISTS track_identifiers (
  id           SERIAL PRIMARY KEY,
  track_id     INT      NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  platform_id  SMALLINT NOT NULL REFERENCES platforms(id),
  external_id  VARCHAR(120) NOT NULL,
  UNIQUE (platform_id, external_id),
  UNIQUE (track_id, platform_id)
);

-- which contributors work on which track (many-to-many)
CREATE TABLE IF NOT EXISTS track_contributors (
  track_id        INT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  contributor_id  INT NOT NULL REFERENCES contributors(id),
  role            VARCHAR(20) NOT NULL CHECK (role IN ('SINGER','PRODUCER','SONGWRITER','COMPOSER')),
  PRIMARY KEY (track_id, contributor_id)
);
CREATE INDEX IF NOT EXISTS ix_track_contributors_contrib ON track_contributors (contributor_id);

-- ---------- Versioned split agreements ----------
CREATE TABLE IF NOT EXISTS split_versions (
  id              SERIAL PRIMARY KEY,
  track_id        INT  NOT NULL REFERENCES tracks(id),
  version_no      INT  NOT NULL CHECK (version_no > 0),
  status          VARCHAR(20) NOT NULL DEFAULT 'PENDING_APPROVAL'
                  CHECK (status IN ('PENDING_APPROVAL','ACTIVE','SUPERSEDED','REJECTED')),
  effective_from  DATE NOT NULL CHECK (EXTRACT(DAY FROM effective_from) = 1),
  notes           TEXT,
  created_by      INT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  activated_at    TIMESTAMPTZ,
  closed_at       TIMESTAMPTZ,
  UNIQUE (track_id, version_no)
);
-- at most one ACTIVE and one PENDING version per track
CREATE UNIQUE INDEX IF NOT EXISTS uq_split_active_per_track
  ON split_versions (track_id) WHERE status = 'ACTIVE';
CREATE UNIQUE INDEX IF NOT EXISTS uq_split_pending_per_track
  ON split_versions (track_id) WHERE status = 'PENDING_APPROVAL';

CREATE TABLE IF NOT EXISTS track_splits (
  id                SERIAL PRIMARY KEY,
  split_version_id  INT NOT NULL REFERENCES split_versions(id),
  contributor_id    INT NOT NULL REFERENCES contributors(id),
  share_bp          INT NOT NULL CHECK (share_bp > 0 AND share_bp <= 10000),
  UNIQUE (split_version_id, contributor_id)
);

CREATE TABLE IF NOT EXISTS split_approvals (
  id                SERIAL PRIMARY KEY,
  split_version_id  INT NOT NULL,
  contributor_id    INT NOT NULL,
  status            VARCHAR(10) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
  comment           TEXT,
  decided_by        INT REFERENCES users(id),
  decided_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (split_version_id, contributor_id),
  -- an approval can only exist for a contributor who is actually part of the split
  FOREIGN KEY (split_version_id, contributor_id) REFERENCES track_splits (split_version_id, contributor_id)
);
CREATE INDEX IF NOT EXISTS ix_split_approvals_contrib ON split_approvals (contributor_id, status);

-- ---------- Streaming reports (normalized, matched rows only) ----------
CREATE TABLE IF NOT EXISTS streaming_reports (
  id              SERIAL PRIMARY KEY,
  report_key      VARCHAR(60) NOT NULL UNIQUE,      -- e.g. SPOTIFY-2026-10 (unique report identifier)
  platform_id     SMALLINT NOT NULL REFERENCES platforms(id),
  period_month    DATE NOT NULL CHECK (EXTRACT(DAY FROM period_month) = 1),
  file_name       VARCHAR(255) NOT NULL,
  file_hash       CHAR(64) NOT NULL UNIQUE,         -- sha256 of the uploaded file
  total_rows      INT NOT NULL DEFAULT 0,
  matched_rows    INT NOT NULL DEFAULT 0,
  unmatched_rows  INT NOT NULL DEFAULT 0,
  total_streams   BIGINT NOT NULL DEFAULT 0,
  total_revenue   NUMERIC(18,2) NOT NULL DEFAULT 0,
  uploaded_by     INT REFERENCES users(id),
  uploaded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (platform_id, period_month)
);

-- ---------- Royalty runs ----------
CREATE TABLE IF NOT EXISTS royalty_runs (
  id                       SERIAL PRIMARY KEY,
  period_month             DATE NOT NULL CHECK (EXTRACT(DAY FROM period_month) = 1),
  scope                    VARCHAR(30) NOT NULL DEFAULT 'ALL_TRACKS',
  status                   VARCHAR(20) NOT NULL DEFAULT 'PENDING_APPROVAL'
                           CHECK (status IN ('PENDING_APPROVAL','APPROVED','REJECTED','PAID')),
  record_count             INT NOT NULL,
  total_streams            BIGINT NOT NULL,
  total_revenue            NUMERIC(18,2) NOT NULL CHECK (total_revenue >= 0),
  total_sampling           NUMERIC(18,2) NOT NULL CHECK (total_sampling >= 0),
  total_gross              NUMERIC(18,2) NOT NULL CHECK (total_gross >= 0),
  total_advance_deduction  NUMERIC(18,2) NOT NULL CHECK (total_advance_deduction >= 0),
  total_net                NUMERIC(18,2) NOT NULL CHECK (total_net >= 0),
  calculated_by            INT REFERENCES users(id),
  calculated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_by              INT REFERENCES users(id),
  approved_at              TIMESTAMPTZ,
  rejected_by              INT REFERENCES users(id),
  rejected_at              TIMESTAMPTZ,
  rejection_reason         TEXT,
  CHECK (total_net = total_gross - total_advance_deduction)
);
-- only one live (non-rejected) run per reporting period and scope
CREATE UNIQUE INDEX IF NOT EXISTS uq_royalty_run_period_scope
  ON royalty_runs (period_month, scope) WHERE status <> 'REJECTED';

CREATE TABLE IF NOT EXISTS streaming_records (
  id               BIGSERIAL PRIMARY KEY,
  report_id        INT NOT NULL REFERENCES streaming_reports(id),
  track_id         INT NOT NULL REFERENCES tracks(id),
  platform_id      SMALLINT NOT NULL REFERENCES platforms(id),
  period_month     DATE NOT NULL,
  source_row_id    VARCHAR(100) NOT NULL UNIQUE,     -- e.g. SPOTIFY-2026-10:3 (links back to MongoDB row)
  reported_isrc    VARCHAR(40),
  reported_title   VARCHAR(255),
  streams          BIGINT NOT NULL CHECK (streams >= 0),
  revenue          NUMERIC(18,2) NOT NULL CHECK (revenue >= 0),
  match_method     VARCHAR(10) NOT NULL CHECK (match_method IN ('AUTO','MANUAL')),
  mapped_by        INT REFERENCES users(id),
  royalty_run_id   INT REFERENCES royalty_runs(id),  -- set once the record is consumed by a run
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_streaming_records_period_track ON streaming_records (period_month, track_id);
CREATE INDEX IF NOT EXISTS ix_streaming_records_run ON streaming_records (royalty_run_id);

-- per-track result of a run, including the exact split version used
CREATE TABLE IF NOT EXISTS royalty_run_tracks (
  run_id              INT NOT NULL REFERENCES royalty_runs(id),
  track_id            INT NOT NULL REFERENCES tracks(id),
  split_version_id    INT NOT NULL REFERENCES split_versions(id),
  streams             BIGINT NOT NULL,
  own_revenue         NUMERIC(18,2) NOT NULL CHECK (own_revenue >= 0),
  sampling_deduction  NUMERIC(18,2) NOT NULL CHECK (sampling_deduction >= 0),
  sampling_credit     NUMERIC(18,2) NOT NULL CHECK (sampling_credit >= 0),
  distributable       NUMERIC(18,2) NOT NULL CHECK (distributable >= 0),
  PRIMARY KEY (run_id, track_id),
  CHECK (distributable = own_revenue - sampling_deduction + sampling_credit)
);

-- snapshot of the Neo4j sampling obligations used by a run
CREATE TABLE IF NOT EXISTS royalty_sampling_obligations (
  id                SERIAL PRIMARY KEY,
  run_id            INT NOT NULL REFERENCES royalty_runs(id),
  source_track_id   INT NOT NULL REFERENCES tracks(id),
  sampled_track_id  INT NOT NULL REFERENCES tracks(id),
  percentage_bp     INT NOT NULL CHECK (percentage_bp > 0 AND percentage_bp < 10000),
  base_revenue      NUMERIC(18,2) NOT NULL,
  amount            NUMERIC(18,2) NOT NULL CHECK (amount >= 0),
  CHECK (source_track_id <> sampled_track_id)
);

-- contributor-wise details
CREATE TABLE IF NOT EXISTS royalty_details (
  id                SERIAL PRIMARY KEY,
  run_id            INT NOT NULL,
  track_id          INT NOT NULL,
  contributor_id    INT NOT NULL REFERENCES contributors(id),
  split_version_id  INT NOT NULL,
  share_bp          INT NOT NULL CHECK (share_bp > 0 AND share_bp <= 10000),
  gross_amount      NUMERIC(18,2) NOT NULL CHECK (gross_amount >= 0),
  advance_deduction NUMERIC(18,2) NOT NULL CHECK (advance_deduction >= 0),
  net_amount        NUMERIC(18,2) NOT NULL CHECK (net_amount >= 0),
  UNIQUE (run_id, track_id, contributor_id),
  FOREIGN KEY (run_id, track_id) REFERENCES royalty_run_tracks (run_id, track_id),
  FOREIGN KEY (split_version_id, contributor_id) REFERENCES track_splits (split_version_id, contributor_id),
  CHECK (advance_deduction <= gross_amount),
  CHECK (net_amount = gross_amount - advance_deduction)
);
CREATE INDEX IF NOT EXISTS ix_royalty_details_contrib ON royalty_details (contributor_id, run_id);

-- ---------- Advances ----------
CREATE TABLE IF NOT EXISTS advances (
  id                   SERIAL PRIMARY KEY,
  contributor_id       INT NOT NULL REFERENCES contributors(id),
  original_amount      NUMERIC(18,2) NOT NULL CHECK (original_amount > 0),
  outstanding_balance  NUMERIC(18,2) NOT NULL,
  description          TEXT,
  issued_on            DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by           INT REFERENCES users(id),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (outstanding_balance >= 0 AND outstanding_balance <= original_amount)
);
CREATE INDEX IF NOT EXISTS ix_advances_contrib ON advances (contributor_id);

CREATE TABLE IF NOT EXISTS advance_transactions (
  id              SERIAL PRIMARY KEY,
  advance_id      INT NOT NULL REFERENCES advances(id),
  txn_type        VARCHAR(10) NOT NULL CHECK (txn_type IN ('ISSUED','RECOUPED')),
  amount          NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  balance_after   NUMERIC(18,2) NOT NULL CHECK (balance_after >= 0),
  royalty_run_id  INT REFERENCES royalty_runs(id),
  note            TEXT,
  created_by      INT REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ix_advance_txn_advance ON advance_transactions (advance_id);

-- ---------- Payments (append-only) ----------
CREATE TABLE IF NOT EXISTS payments (
  id                 SERIAL PRIMARY KEY,
  run_id             INT NOT NULL REFERENCES royalty_runs(id),
  contributor_id     INT NOT NULL REFERENCES contributors(id),
  amount             NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  idempotency_key    VARCHAR(100) NOT NULL UNIQUE,
  payment_reference  VARCHAR(100),
  method             VARCHAR(20) NOT NULL DEFAULT 'BANK_TRANSFER',
  status             VARCHAR(10) NOT NULL DEFAULT 'PAID' CHECK (status IN ('PAID')),
  paid_by            INT REFERENCES users(id),
  paid_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (run_id, contributor_id)       -- a contributor can be paid only once per run
);

-- ---------- Integrity triggers ----------

-- 1. split shares are immutable once written
CREATE OR REPLACE FUNCTION fn_block_modification() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are historical records and cannot be % ', TG_TABLE_NAME, lower(TG_OP)
    USING ERRCODE = 'P0001';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_track_splits_immutable ON track_splits;
CREATE TRIGGER trg_track_splits_immutable BEFORE UPDATE OR DELETE ON track_splits
  FOR EACH ROW EXECUTE FUNCTION fn_block_modification();

DROP TRIGGER IF EXISTS trg_advance_txn_immutable ON advance_transactions;
CREATE TRIGGER trg_advance_txn_immutable BEFORE UPDATE OR DELETE ON advance_transactions
  FOR EACH ROW EXECUTE FUNCTION fn_block_modification();

DROP TRIGGER IF EXISTS trg_payments_immutable ON payments;
CREATE TRIGGER trg_payments_immutable BEFORE UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION fn_block_modification();

DROP TRIGGER IF EXISTS trg_royalty_details_immutable ON royalty_details;
CREATE TRIGGER trg_royalty_details_immutable BEFORE UPDATE OR DELETE ON royalty_details
  FOR EACH ROW EXECUTE FUNCTION fn_block_modification();

-- 2. a split version's shares must total exactly 10000 bp (checked at COMMIT)
CREATE OR REPLACE FUNCTION fn_check_split_total() RETURNS trigger AS $$
DECLARE total INT;
BEGIN
  SELECT COALESCE(SUM(share_bp), 0) INTO total FROM track_splits WHERE split_version_id = NEW.split_version_id;
  IF total <> 10000 THEN
    RAISE EXCEPTION 'Split version % totals % basis points; it must total exactly 10000 (100%%)',
      NEW.split_version_id, total USING ERRCODE = 'P0001';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_split_total ON track_splits;
CREATE CONSTRAINT TRIGGER trg_split_total AFTER INSERT ON track_splits
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION fn_check_split_total();

-- 3. split versions: no deletes, identity columns frozen, only legal status transitions
CREATE OR REPLACE FUNCTION fn_split_version_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Split versions are historical records and cannot be deleted' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.track_id <> OLD.track_id OR NEW.version_no <> OLD.version_no
     OR NEW.effective_from <> OLD.effective_from THEN
    RAISE EXCEPTION 'Split version identity fields cannot be modified' USING ERRCODE = 'P0001';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'PENDING_APPROVAL' AND NEW.status IN ('ACTIVE','REJECTED')) OR
       (OLD.status = 'ACTIVE' AND NEW.status = 'SUPERSEDED')) THEN
    RAISE EXCEPTION 'Illegal split status transition % -> %', OLD.status, NEW.status USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_split_version_guard ON split_versions;
CREATE TRIGGER trg_split_version_guard BEFORE UPDATE OR DELETE ON split_versions
  FOR EACH ROW EXECUTE FUNCTION fn_split_version_guard();

-- 4. an approval decision can be made exactly once
CREATE OR REPLACE FUNCTION fn_split_approval_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Approval history cannot be deleted' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'This approval was already decided (%)', OLD.status USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_split_approval_guard ON split_approvals;
CREATE TRIGGER trg_split_approval_guard BEFORE UPDATE OR DELETE ON split_approvals
  FOR EACH ROW EXECUTE FUNCTION fn_split_approval_guard();

-- ---------- Reporting view ----------
CREATE OR REPLACE VIEW v_run_contributor_payables AS
SELECT d.run_id,
       d.contributor_id,
       c.name                    AS contributor_name,
       SUM(d.gross_amount)       AS gross_amount,
       SUM(d.advance_deduction)  AS advance_deduction,
       SUM(d.net_amount)         AS net_amount,
       p.id                      AS payment_id,
       p.paid_at,
       p.payment_reference,
       CASE WHEN p.id IS NOT NULL THEN 'PAID'
            WHEN SUM(d.net_amount) = 0 THEN 'NOTHING_DUE'
            ELSE 'PENDING' END   AS payment_status
FROM royalty_details d
JOIN contributors c ON c.id = d.contributor_id
LEFT JOIN payments p ON p.run_id = d.run_id AND p.contributor_id = d.contributor_id
GROUP BY d.run_id, d.contributor_id, c.name, p.id, p.paid_at, p.payment_reference;

-- =====================================================================
-- Stored function (with a CTE): a contributor's lifetime earnings summary.
-- Used by the statement API:  SELECT * FROM fn_contributor_earnings(1);
-- =====================================================================
CREATE OR REPLACE FUNCTION fn_contributor_earnings(p_contributor_id INT)
RETURNS TABLE (
  gross               NUMERIC(18,2),
  advance_deduction   NUMERIC(18,2),
  net                 NUMERIC(18,2),
  paid                NUMERIC(18,2),
  awaiting_payment    NUMERIC(18,2),
  outstanding_advance NUMERIC(18,2)
)
LANGUAGE sql STABLE AS $$
  WITH live_lines AS (                         -- CTE: payables from runs that were not rejected
    SELECT v.gross_amount, v.advance_deduction AS adv, v.net_amount, v.payment_status, r.status AS run_status
      FROM v_run_contributor_payables v
      JOIN royalty_runs r ON r.id = v.run_id
     WHERE v.contributor_id = p_contributor_id AND r.status <> 'REJECTED'
  )
  SELECT COALESCE(SUM(l.gross_amount), 0)::NUMERIC(18,2),
         COALESCE(SUM(l.adv), 0)::NUMERIC(18,2),
         COALESCE(SUM(l.net_amount), 0)::NUMERIC(18,2),
         COALESCE(SUM(l.net_amount) FILTER (WHERE l.payment_status = 'PAID'), 0)::NUMERIC(18,2),
         COALESCE(SUM(l.net_amount) FILTER (WHERE l.payment_status = 'PENDING'
                                              AND l.run_status IN ('APPROVED','PAID')), 0)::NUMERIC(18,2),
         (SELECT COALESCE(SUM(a.outstanding_balance), 0) FROM advances a
           WHERE a.contributor_id = p_contributor_id)::NUMERIC(18,2)
    FROM live_lines l;
$$;

-- =====================================================================
-- Stored procedure: Finance rejects a royalty run.
-- Used by the API:  CALL sp_reject_royalty_run(run_id, user_id, 'reason');
-- Marks the run REJECTED (history kept) and releases its streaming records
-- so a corrected run can include them. Runs inside the caller's transaction.
-- =====================================================================
CREATE OR REPLACE PROCEDURE sp_reject_royalty_run(p_run_id INT, p_user_id INT, p_reason TEXT)
LANGUAGE plpgsql AS $$
DECLARE
  v_status   TEXT;
  v_released INT;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'A rejection reason is required' USING ERRCODE = 'P0001';
  END IF;

  SELECT status INTO v_status FROM royalty_runs WHERE id = p_run_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Royalty run % not found', p_run_id USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'PENDING_APPROVAL' THEN
    RAISE EXCEPTION 'Run is %; only runs pending approval can be rejected', v_status USING ERRCODE = 'P0001';
  END IF;

  UPDATE royalty_runs
     SET status = 'REJECTED', rejected_by = p_user_id, rejected_at = now(), rejection_reason = p_reason
   WHERE id = p_run_id;

  UPDATE streaming_records SET royalty_run_id = NULL WHERE royalty_run_id = p_run_id;
  GET DIAGNOSTICS v_released = ROW_COUNT;
  RAISE NOTICE 'Run % rejected; % streaming records released', p_run_id, v_released;
END;
$$;

-- =====================================================================
-- Role-based access control inside PostgreSQL (DCL: roles, GRANT, RLS).
-- The API enforces roles on every endpoint; these database roles add the
-- same rules for anyone connecting to the database directly.
--   mrms_admin       : manages catalogue, splits, reports, advances, runs
--   mrms_finance     : approves runs, records payments (append-only)
--   mrms_contributor : read-only, sees ONLY their own royalty lines (RLS),
--                      may only change the decision columns of an approval
-- =====================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mrms_admin')       THEN CREATE ROLE mrms_admin NOLOGIN;       END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mrms_finance')     THEN CREATE ROLE mrms_finance NOLOGIN;     END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mrms_contributor') THEN CREATE ROLE mrms_contributor NOLOGIN; END IF;
END $$;

-- every role can read the catalogue
GRANT SELECT ON platforms, tracks, track_identifiers, track_contributors, contributors,
                split_versions, track_splits, split_approvals
  TO mrms_admin, mrms_finance, mrms_contributor;

-- admin: catalogue, splits, reports, advances and royalty runs
GRANT SELECT, INSERT, UPDATE ON tracks, track_identifiers, track_contributors, contributors,
                                split_versions, track_splits, split_approvals,
                                streaming_reports, streaming_records, advances, advance_transactions,
                                royalty_runs, royalty_run_tracks, royalty_sampling_obligations, royalty_details
  TO mrms_admin;
GRANT SELECT ON payments, users, v_run_contributor_payables TO mrms_admin;

-- finance: read everything financial, approve runs, recoup advances, record payments
GRANT SELECT ON streaming_reports, streaming_records, advances, advance_transactions, royalty_runs,
                royalty_run_tracks, royalty_sampling_obligations, royalty_details, payments,
                v_run_contributor_payables
  TO mrms_finance;
GRANT UPDATE ON royalty_runs, advances TO mrms_finance;
GRANT INSERT ON payments, advance_transactions TO mrms_finance;

-- contributor: own statement lines only (RLS below); may record only an approval decision
GRANT SELECT ON royalty_details, royalty_runs, payments, advances TO mrms_contributor;
GRANT UPDATE (status, comment, decided_by, decided_at) ON split_approvals TO mrms_contributor;

GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO mrms_admin, mrms_finance;
GRANT EXECUTE ON FUNCTION fn_contributor_earnings(INT) TO mrms_admin, mrms_finance, mrms_contributor;
GRANT EXECUTE ON PROCEDURE sp_reject_royalty_run(INT, INT, TEXT) TO mrms_finance;

-- Row-level security: a contributor session sets  app.contributor_id  and then only
-- sees its own rows. The table owner (the API's connection) is not affected.
ALTER TABLE royalty_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE split_approvals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_details_staff ON royalty_details;
CREATE POLICY p_details_staff ON royalty_details TO mrms_admin, mrms_finance USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS p_details_own ON royalty_details;
CREATE POLICY p_details_own ON royalty_details FOR SELECT TO mrms_contributor
  USING (contributor_id = NULLIF(current_setting('app.contributor_id', true), '')::INT);

DROP POLICY IF EXISTS p_approvals_staff ON split_approvals;
CREATE POLICY p_approvals_staff ON split_approvals TO mrms_admin, mrms_finance USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS p_approvals_own ON split_approvals;
CREATE POLICY p_approvals_own ON split_approvals TO mrms_contributor
  USING (contributor_id = NULLIF(current_setting('app.contributor_id', true), '')::INT)
  WITH CHECK (contributor_id = NULLIF(current_setting('app.contributor_id', true), '')::INT);
