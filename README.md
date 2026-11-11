# Music Royalty Management System (RoyaltyDesk)

A full-stack DBMS mini-project. A record label imports monthly streaming reports from Spotify, Apple Music and YouTube Music, then manages versioned split agreements, contributor approvals, sampling obligations, advances, royalty runs and payouts.

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite, plain CSS, React Router |
| Backend | Node.js + Express, JWT auth, bcrypt password hashing |
| **PostgreSQL 16** | Authoritative financial database: users, tracks, splits, approvals, normalized streaming records, advances, royalty runs, payments |
| **MongoDB 7** | Original uploaded report rows (one document per CSV line) and unmatched rows |
| **Neo4j 5** | `(:Track)-[:SAMPLES {percentageBp}]->(:Track)` sampling graph |

Exactly three databases are used. There is no Redis and no other store.

---

## 1. Prerequisites

* **Docker Desktop** (running)
* **Node.js 18+** (tested on Node 22)
* Windows PowerShell (the commands below are for PowerShell)

### Ports used

| Service | Host port |
|---|---|
| PostgreSQL | **5433** |
| MongoDB | **27018** |
| Neo4j Browser / Bolt | **7475** / **7688** |
| Express API | **4000** |
| React (Vite) | **3000** |

The database ports are deliberately non-default so they don't clash with other local PostgreSQL, MongoDB or Neo4j installs. Vite uses 3000 instead of 5173 because Windows/Hyper-V often reserves the 5141–5240 range (you can check with `netsh interface ipv4 show excludedportrange protocol=tcp`).

---

## 2. Setup and run (Windows PowerShell)

Open PowerShell in the project folder (the one that contains `docker-compose.yml`).

**Step 1: Start the three databases**

```powershell
docker compose up -d
docker compose ps        # wait until all three show "healthy" (about 20-40 s)
```

**Step 2: Install backend dependencies and create the `.env` file**

```powershell
cd backend
npm install
Copy-Item .env.example .env
```

**Step 3: Initialise the schemas and seed the demo data**

```powershell
npm run db:init          # PostgreSQL tables/triggers/view, MongoDB indexes, Neo4j constraint
npm run seed             # wipes all 3 DBs and loads demo users, contributors, tracks and Sept-2026 history
```

**Step 4: Start the API.** Leave this window open.

```powershell
npm run dev              # http://localhost:4000/api  (node --watch)
```

**Step 5: Start the frontend in a second PowerShell window**

```powershell
cd frontend
npm install
npm run dev              # http://localhost:3000
```

**Step 6: Open the app:** <http://localhost:3000>

Health check of all three databases: <http://localhost:4000/api/health>
Neo4j Browser: <http://localhost:7475> (user `neo4j`, password `royalty_neo4j_pw`, connect URL `bolt://localhost:7688`)

### Demo accounts

| Username | Password | Role |
|---|---|---|
| admin | admin123 | Label administrator |
| rahul | rahul123 | Contributor: Rahul Verma (singer) |
| arjun | arjun123 | Contributor: Arjun Nair (producer) |
| priya | priya123 | Contributor: Priya Sharma (songwriter) |
| finance | finance123 | Finance officer |

On the login page, click a demo chip to fill in its credentials.

### Automated end-to-end test (optional)

With the API running:

```powershell
cd backend
npm run test:e2e
```

This re-seeds the databases and runs **61 checks** over HTTP, covering the whole workflow plus invalid splits, role-based access, duplicate imports, duplicate runs and idempotent payments. **Run `npm run seed` again afterwards** to get a clean demo state.

### Stop / reset

```powershell
docker compose stop              # stop the databases (data is kept)
docker compose down -v           # remove containers AND all data volumes
cd backend; npm run seed         # reset demo data at any time
```

---

## 3. Demo script (execution sequence)

The seed loads three tracks:

* **Midnight Drive** (IN001), with Rahul, Arjun and Priya linked but **no split yet**.
* **Summer Nights** (IN002), with an approved split: Kavya 70%, Dev 30%.
* **Golden Hour** (IN003), with an approved split: Ananya 60%, Dev 40%.

It also loads one finished September 2026 run, so the dashboards and history have data. Sample CSVs are in [`sample-data/`](sample-data).

| # | Log in as | Page | Action | What it demonstrates |
|---|---|---|---|---|
| 1 | admin | Dashboard | Review the counts and the revenue chart | PostgreSQL aggregates + Mongo/Neo4j counts |
| 2 | admin | Tracks | **+ Add track**, e.g. *Neon Skyline*, ISRC `IN004`. Then try `IN001` again. | CRUD, platform IDs, multiple contributors, unique ISRC (409) |
| 3 | admin | Contributors | **+ Add contributor**, with *Create a new login* | Contributor ↔ login link |
| 4 | admin | Split Agreements | Choose **Midnight Drive** and enter Rahul 50, Arjun 30, Priya 20. Try 50/30/10 first. | Basis points; an invalid total is blocked (UI + API + DB trigger) |
| 5 | rahul → arjun → priya | My Dashboard | **Approve my share** (log out between users) | Each contributor decides only their own allocation. v1 turns **ACTIVE** only after the third approval. |
| 6 | admin | Sampling | Midnight Drive → Summer Nights, **10%**. Then try the reverse direction. | Neo4j relationship; circular sampling and self-sampling rejected |
| 7 | admin | Advances | Rahul, **2000.00** | Advance + ISSUED transaction |
| 8 | admin | Report Upload | Upload `spotify_2026_10.csv` (Spotify), `apple_music_2026_10.csv` (Apple Music) and `youtube_music_2026_10.csv` (YouTube Music). Then upload one of them again, and `invalid_report.csv`. | Rows go to MongoDB, matched rows to PostgreSQL. Duplicate import → 409. Malformed file rejected. Click **Raw rows** to see the Mongo documents. |
| 9 | admin | Unmatched Rows | Map `IN0O2` (*Summer Nights (Live Session)*) to **Summer Nights**. Leave `ZZ9999` unmatched. | Manual mapping copies the record into PostgreSQL; the original Mongo row is kept as MAPPED |
| 10 | admin | Royalty Runs | Month **2026-10** → **Calculate royalties (preview)** → **Save run & submit to Finance**. Then try saving again. | Preview before saving; the duplicate run is blocked |
| 11 | finance | Run Approvals | **Review** → **Approve run** → **Mark paid** for each contributor | Advance recouped at approval; idempotent, append-only payments. Run becomes PAID. |
| 12 | rahul | My Statement | View October | Split version used, ₹2,000 advance recouped, ₹2,500 paid |

**Expected October figures for Midnight Drive** (from the spec):

```
Revenue (Spotify 6000 + Apple 2500 + YouTube 1500)   ₹10,000.00   (10,000 streams)
− Sampling owed to Summer Nights (10%)               ₹ 1,000.00
= Distributable                                      ₹ 9,000.00
Rahul 50% = 4,500.00 − advance 2,000.00 = net ₹2,500.00
Arjun 30% = ₹2,700.00          Priya 20% = ₹1,800.00
```

> **Note:** step 4 defaults a track's *first* split to its release month (Mar 2026 for Midnight Drive). Later versions default to the current month. A split only applies to royalty months on or after its **effective month**. If you create Midnight Drive's split effective Nov 2026, the October calculation is correctly blocked with "no approved split agreement".

---

## 4. Architecture

```
frontend/ (React + Vite)  ──/api proxy──►  backend/ (Express)
                                              ├── PostgreSQL  (src/db/postgres.js)
                                              ├── MongoDB     (src/db/mongo.js)
                                              └── Neo4j       (src/db/neo4j.js)
```

```
backend/
  src/
    config/        env configuration
    db/            postgres.js, mongo.js, neo4j.js, schema.sql
    middleware/    auth.js (JWT + role gate), errorHandler.js (DB error → HTTP)
    services/      business logic (one per module)
    controllers/   thin HTTP handlers
    routes/        all /api routes with server-side role checks
    utils/         money.js (BigInt paise), validate.js, errors.js
  scripts/         initDb.js, seed.js, e2eTest.js
frontend/src/
  pages/           one page per screen (12 screens)
  components/      layout, UI kit, charts, split/run breakdowns
sample-data/       demo CSV reports
```

### How the three databases work together

1. **Upload a report.** The CSV is validated. In a single PostgreSQL transaction, a `streaming_reports` row and the `streaming_records` for matched ISRCs are inserted. Every original line is written to MongoDB `streaming_reports` (one document each), and unmatched lines also go to `unmatched_reports`. If MongoDB fails, PostgreSQL rolls back. If PostgreSQL fails at commit, the Mongo documents are deleted (compensation).
2. **Map an unmatched row.** The normalized record is inserted in PostgreSQL (`match_method = 'MANUAL'`), and the Mongo row is marked `MAPPED`. The original row is never deleted.
3. **Calculate.** The engine reads matched, not-yet-consumed records from PostgreSQL, sampling percentages from Neo4j, approved splits and advance balances from PostgreSQL. It saves the results, plus a snapshot of the Neo4j obligations, back into PostgreSQL.

### Royalty policy

* **Sampling (one level).** If track T has revenue R and `T-[:SAMPLES {p}]->S`, then T owes S `round(R × p)`. That amount is deducted from T's distributable and credited to S's. Credits are not re-sampled, so there is no recursion.
* **Split.** The applicable version is the latest approved version (ACTIVE or SUPERSEDED) whose effective month is on or before the period. Shares are floored to the paisa, and leftover paise go to the largest shares, so the total is exact.
* **Advances.** The deduction is `min(contributor gross, outstanding balance)`. Any remainder carries forward. The deduction is applied FIFO to the advances at **finance approval**, with RECOUPED transactions.
* **Money.** All arithmetic uses BigInt paise in JS and `NUMERIC(18,2)` in PostgreSQL. Floats are never used.

---

## 5. Database design

### PostgreSQL (`backend/src/db/schema.sql`)

| Table | Purpose / key constraints |
|---|---|
| `users` | login accounts; `role ∈ {ADMIN, CONTRIBUTOR, FINANCE}`; bcrypt hash |
| `contributors` | `role ∈ {SINGER, PRODUCER, SONGWRITER, COMPOSER}`; `user_id UNIQUE` links to a login |
| `platforms` | SPOTIFY, APPLE_MUSIC, YOUTUBE_MUSIC |
| `tracks` | `isrc UNIQUE` |
| `track_identifiers` | platform IDs; `UNIQUE(platform_id, external_id)` |
| `track_contributors` | many-to-many tracks ↔ contributors |
| `split_versions` | `UNIQUE(track_id, version_no)`; partial unique indexes: one ACTIVE and one PENDING per track; status-transition trigger; no deletes |
| `track_splits` | `share_bp` (basis points); **deferred constraint trigger enforces Σ = 10000**; immutable |
| `split_approvals` | composite FK to `track_splits`; trigger allows exactly one decision |
| `streaming_reports` | `report_key UNIQUE` (e.g. `SPOTIFY-2026-10`), `file_hash UNIQUE`, `UNIQUE(platform, month)` |
| `streaming_records` | normalized matched rows; `source_row_id UNIQUE`; `royalty_run_id` marks a record as consumed (never counted twice) |
| `advances` | `CHECK (0 ≤ outstanding ≤ original)` |
| `advance_transactions` | ISSUED / RECOUPED history; immutable |
| `royalty_runs` | partial unique index `(period_month, scope) WHERE status <> 'REJECTED'`, which blocks duplicate runs |
| `royalty_run_tracks` | per-track revenue, sampling, distributable and **split_version_id used** |
| `royalty_sampling_obligations` | snapshot of the Neo4j obligations used |
| `royalty_details` | contributor-wise lines; FK `(split_version_id, contributor_id)` → `track_splits`; `CHECK net = gross − advance`; immutable |
| `payments` | append-only; `UNIQUE(run_id, contributor_id)` and `UNIQUE(idempotency_key)` |
| view `v_run_contributor_payables` | per-run contributor totals + PENDING / PAID / NOTHING_DUE |

### MongoDB (`royalty_reports` database)

* `streaming_reports`: one document per CSV line: `{source_row_id (unique), report_key, platform, month, row_number, original_row{…as received…}, status: MATCHED|UNMATCHED|MAPPED, pg_record_id}`
* `unmatched_reports`: `{source_row_id (unique), isrc, track_name, streams, revenue, reason, status: UNMATCHED|MAPPED, mapped_track_id, mapped_by, mapped_at, original_row}`

### Neo4j

* `(:Track {pgId, title, isrc})`, with a unique constraint on `pgId`
* `(:Track)-[:SAMPLES {percentageBp, createdAt, createdBy}]->(:Track)`
* Self-sampling, duplicates and cycles (`EXISTS {(sampled)-[:SAMPLES*1..25]->(source)}`) are rejected. The total outgoing share for a track must stay below 100%.

---

## 6. API overview (all under `/api`, JWT required except login)

| Method & path | Role |
|---|---|
| `POST /auth/login`, `GET /auth/me` | public / any |
| `GET /dashboard/admin` · `/finance` · `/contributor` | per role |
| `GET/POST /tracks`, `PUT /tracks/:id` | admin (finance read) |
| `GET/POST /contributors`, `PUT /contributors/:id` | admin (finance read) |
| `GET/POST /tracks/:id/splits`, `GET /splits` | admin; contributors read their own tracks |
| `POST /splits/:versionId/decision` | contributor (own allocation only) |
| `GET/POST /sampling`, `DELETE /sampling/:src/:dst` | admin |
| `GET/POST /advances`, `GET /advances/transactions` | admin |
| `POST /reports/upload`, `GET /reports`, `GET /reports/:id/rows` | admin |
| `GET /unmatched`, `POST /unmatched/:sourceRowId/map` | admin |
| `POST /royalties/preview`, `POST /royalties/runs` | admin |
| `GET /royalties/runs[/:id]` | admin, finance |
| `POST /royalties/runs/:id/approve` · `/reject` | finance |
| `GET /payments`, `POST /payments` (header `Idempotency-Key`) | finance |
| `GET /me/statement`, `GET /statements/:contributorId` | contributor (own) / admin / finance |

---

## 7. Troubleshooting

* **`Database connection failed`** when starting the API: run `docker compose ps` and wait for all three containers to show *healthy*.
* **`listen EACCES … :3000`**: that port is reserved on your machine. Change `server.port` in `frontend/vite.config.js` and `CORS_ORIGIN` in `backend/.env`.
* **A port is already in use**: change the left-hand port in `docker-compose.yml` and the matching value in `backend/.env`.
* **A late-mapped row isn't in the run**: a run for that month already exists. Records mapped afterwards are included only if Finance rejects the run and the admin recalculates.
