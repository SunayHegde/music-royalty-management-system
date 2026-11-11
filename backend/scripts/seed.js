// Resets all three databases and loads demo data.
//
//  PostgreSQL : 5 users, 6 contributors, 3 platforms, 3 tracks, approved splits for
//               Summer Nights + Golden Hour, and a fully processed + paid September 2026 run
//               (history for the dashboards).
//  MongoDB    : the original rows of the September report.
//  Neo4j      : Track nodes (sampling links are created during the demo).
//
// Midnight Drive (IN001) is seeded with its contributors but WITHOUT a split agreement,
// so the live demo can create Split v1 and have Rahul, Arjun and Priya approve it.
const fs = require('fs');
const path = require('path');
const pg = require('../src/db/postgres');
const mongo = require('../src/db/mongo');
const neo = require('../src/db/neo4j');
const { initDatabases } = require('./initDb');
const { hashPassword } = require('../src/services/authService');
const trackService = require('../src/services/trackService');
const reportService = require('../src/services/reportService');
const royaltyService = require('../src/services/royaltyService');
const paymentService = require('../src/services/paymentService');

const USERS = [
  { username: 'admin', password: 'admin123', fullName: 'Label Administrator', role: 'ADMIN' },
  { username: 'rahul', password: 'rahul123', fullName: 'Rahul Verma', role: 'CONTRIBUTOR' },
  { username: 'arjun', password: 'arjun123', fullName: 'Arjun Nair', role: 'CONTRIBUTOR' },
  { username: 'priya', password: 'priya123', fullName: 'Priya Sharma', role: 'CONTRIBUTOR' },
  { username: 'finance', password: 'finance123', fullName: 'Finance Officer', role: 'FINANCE' },
];

const CONTRIBUTORS = [
  { key: 'rahul', name: 'Rahul Verma', email: 'rahul@demo-label.test', role: 'SINGER', user: 'rahul' },
  { key: 'arjun', name: 'Arjun Nair', email: 'arjun@demo-label.test', role: 'PRODUCER', user: 'arjun' },
  { key: 'priya', name: 'Priya Sharma', email: 'priya@demo-label.test', role: 'SONGWRITER', user: 'priya' },
  { key: 'kavya', name: 'Kavya Menon', email: 'kavya@demo-label.test', role: 'SINGER' },
  { key: 'dev', name: 'Dev Kapoor', email: 'dev@demo-label.test', role: 'COMPOSER' },
  { key: 'ananya', name: 'Ananya Rao', email: 'ananya@demo-label.test', role: 'SINGER' },
];

const TRACKS = [
  { key: 'midnight', title: 'Midnight Drive', isrc: 'IN001', album: 'Night City', releaseDate: '2026-03-14',
    ids: { SPOTIFY: 'sp_7xMidnightDrive', APPLE_MUSIC: 'am_1600001', YOUTUBE_MUSIC: 'yt_mDrv001' },
    contributors: ['rahul', 'arjun', 'priya'], split: null },
  { key: 'summer', title: 'Summer Nights', isrc: 'IN002', album: 'Coastal Tapes', releaseDate: '2024-05-10',
    ids: { SPOTIFY: 'sp_4kSummerNights', APPLE_MUSIC: 'am_1500002' },
    contributors: ['kavya', 'dev'], split: { kavya: 7000, dev: 3000 }, effectiveFrom: '2024-05-01' },
  { key: 'golden', title: 'Golden Hour', isrc: 'IN003', album: 'Coastal Tapes', releaseDate: '2024-08-22',
    ids: { SPOTIFY: 'sp_9gGoldenHour', YOUTUBE_MUSIC: 'yt_gHr003' },
    contributors: ['ananya', 'dev'], split: { ananya: 6000, dev: 4000 }, effectiveFrom: '2024-08-01' },
];

async function wipe() {
  await pg.query(`TRUNCATE payments, advance_transactions, advances, royalty_details, royalty_sampling_obligations,
                  royalty_run_tracks, streaming_records, royalty_runs, streaming_reports, split_approvals, track_splits,
                  split_versions, track_contributors, track_identifiers, tracks, platforms, contributors, users
                  RESTART IDENTITY CASCADE`);
  await mongo.collections.reportRows().deleteMany({});
  await mongo.collections.unmatched().deleteMany({});
  await neo.run('MATCH (n) DETACH DELETE n');
}

async function seed() {
  await initDatabases({ quiet: true });
  await mongo.connectMongo();
  await wipe();
  console.log('✔ Cleared PostgreSQL, MongoDB and Neo4j');

  await pg.query(`INSERT INTO platforms (code, name) VALUES
    ('SPOTIFY','Spotify'), ('APPLE_MUSIC','Apple Music'), ('YOUTUBE_MUSIC','YouTube Music')`);

  const userIds = {};
  for (const u of USERS) {
    const { rows } = await pg.query(
      'INSERT INTO users (username, password_hash, full_name, role) VALUES ($1,$2,$3,$4) RETURNING id',
      [u.username, await hashPassword(u.password), u.fullName, u.role]
    );
    userIds[u.username] = rows[0].id;
  }
  console.log('✔ Users: admin, rahul, arjun, priya, finance (bcrypt hashed)');

  const cIds = {};
  for (const c of CONTRIBUTORS) {
    const { rows } = await pg.query(
      'INSERT INTO contributors (name, email, role, user_id) VALUES ($1,$2,$3,$4) RETURNING id',
      [c.name, c.email, c.role, c.user ? userIds[c.user] : null]
    );
    cIds[c.key] = rows[0].id;
  }
  console.log('✔ Contributors: Rahul, Arjun, Priya (linked to logins), Kavya, Dev, Ananya');

  const tIds = {};
  for (const t of TRACKS) {
    const track = await trackService.create({
      title: t.title, isrc: t.isrc, album: t.album, releaseDate: t.releaseDate,
      identifiers: Object.entries(t.ids).map(([platform, externalId]) => ({ platform, externalId })),
      contributors: t.contributors.map((k) => ({ contributorId: cIds[k] })),
    }); // also MERGEs the Neo4j Track node
    tIds[t.key] = track.id;

    if (t.split) {
      await pg.withTransaction(async (client) => {
        const v = await client.query(
          `INSERT INTO split_versions (track_id, version_no, status, effective_from, notes, created_by, activated_at)
           VALUES ($1, 1, 'ACTIVE', $2, 'Seeded historical agreement', $3, now()) RETURNING id`,
          [track.id, t.effectiveFrom, userIds.admin]
        );
        for (const [k, bp] of Object.entries(t.split)) {
          await client.query('INSERT INTO track_splits (split_version_id, contributor_id, share_bp) VALUES ($1,$2,$3)', [v.rows[0].id, cIds[k], bp]);
          await client.query(
            `INSERT INTO split_approvals (split_version_id, contributor_id, status, comment, decided_by, decided_at)
             VALUES ($1,$2,'APPROVED','Signed paper agreement',$3, now())`,
            [v.rows[0].id, cIds[k], userIds.admin]
          );
        }
      });
    }
  }
  console.log('✔ Tracks: Midnight Drive (IN001, no split yet), Summer Nights (IN002), Golden Hour (IN003)');

  // ---- September 2026 history: imported, calculated, approved and paid ----
  const admin = { id: userIds.admin, username: 'admin', role: 'ADMIN' };
  const finance = { id: userIds.finance, username: 'finance', role: 'FINANCE' };
  const file = path.join(__dirname, '..', '..', 'sample-data', 'seed', 'spotify_2026_09.csv');
  await reportService.upload({ file: { buffer: fs.readFileSync(file), originalname: 'spotify_2026_09.csv' }, platformCode: 'SPOTIFY' }, admin);
  const run = await royaltyService.createRun('2026-09', admin);
  await royaltyService.approveRun(run.id, finance);
  for (const c of run.contributors) {
    await paymentService.pay({ runId: run.id, contributorId: c.contributorId, paymentReference: `NEFT-SEP26-${c.contributorId}` }, `seed-sep26-${c.contributorId}`, finance);
  }
  console.log('✔ September 2026: Spotify report imported, royalty run calculated, approved and paid');
}

seed()
  .then(() => console.log('\nSeed complete. Log in with admin/admin123, rahul/rahul123, arjun/arjun123, priya/priya123, finance/finance123'))
  .catch((e) => { console.error('Seed failed:', e.message, e.details || ''); process.exitCode = 1; })
  .finally(async () => { await pg.pool.end(); await mongo.closeMongo(); await neo.closeNeo4j(); });
