// End-to-end workflow test against the running API (http://localhost:4000).
// It re-seeds all three databases first, then drives the full demo through HTTP:
//   admin adds track/contributor -> split v1 -> each contributor approves -> sampling ->
//   advance -> CSV uploads -> unmatched mapping -> royalty preview/run -> finance approval ->
//   idempotent payments.  It also checks invalid splits, RBAC and duplicate prevention.
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE = process.env.API_URL || 'http://localhost:4000/api';
const SAMPLES = path.join(__dirname, '..', '..', 'sample-data');
let passed = 0;
let failed = 0;

function check(name, cond, extra) {
  if (cond) { passed += 1; console.log(`  ✔ ${name}`); }
  else { failed += 1; console.log(`  ✖ ${name}`, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); }
}

async function api(method, url, { token, body, form, headers = {} } = {}) {
  const h = { ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { h['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  const res = await fetch(BASE + url, { method, headers: h, body: payload });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

const login = async (u, p) => (await api('POST', '/auth/login', { body: { username: u, password: p } })).data.token;

async function uploadCsv(token, fileName, platform) {
  const form = new FormData();
  form.append('platform', platform);
  form.append('file', new Blob([fs.readFileSync(path.join(SAMPLES, fileName))], { type: 'text/csv' }), fileName);
  return api('POST', '/reports/upload', { token, form });
}

async function main() {
  console.log('Re-seeding databases...');
  execSync('node scripts/seed.js', { cwd: path.join(__dirname, '..'), stdio: 'ignore' });

  console.log('\n1. Authentication & role-based access');
  const bad = await api('POST', '/auth/login', { body: { username: 'admin', password: 'wrong' } });
  check('wrong password rejected (401)', bad.status === 401);
  const admin = await login('admin', 'admin123');
  const rahul = await login('rahul', 'rahul123');
  const arjun = await login('arjun', 'arjun123');
  const priya = await login('priya', 'priya123');
  const finance = await login('finance', 'finance123');
  check('all five demo users can log in', [admin, rahul, arjun, priya, finance].every(Boolean));
  check('no token -> 401', (await api('GET', '/tracks')).status === 401);
  check('contributor cannot list all tracks (403)', (await api('GET', '/tracks', { token: rahul })).status === 403);
  check('finance cannot create tracks (403)', (await api('POST', '/tracks', { token: finance, body: { title: 'x', isrc: 'X1X' } })).status === 403);

  console.log('\n2. Tracks & contributors');
  const contribs = (await api('GET', '/contributors', { token: admin })).data;
  const cid = Object.fromEntries(contribs.map((c) => [c.name.split(' ')[0].toLowerCase(), c.id]));
  const newC = await api('POST', '/contributors', { token: admin, body: { name: 'Meera Das', email: 'meera@demo-label.test', role: 'COMPOSER', newUsername: 'meera', newPassword: 'meera123' } });
  check('admin adds contributor with linked login', newC.status === 201 && newC.data.username === 'meera', newC.data);
  const newT = await api('POST', '/tracks', { token: admin, body: {
    title: 'Neon Skyline', isrc: 'IN004', album: 'Night City', releaseDate: '2026-10-01',
    identifiers: [{ platform: 'SPOTIFY', externalId: 'sp_neon004' }],
    contributors: [{ contributorId: cid.rahul }, { contributorId: newC.data.id }],
  } });
  check('admin adds track Neon Skyline (IN004)', newT.status === 201 && newT.data.contributors.length === 2, newT.data);
  check('duplicate ISRC rejected (409)', (await api('POST', '/tracks', { token: admin, body: { title: 'Copy', isrc: 'IN004' } })).status === 409);
  const search = await api('GET', '/tracks?q=midnight', { token: admin });
  const midnight = search.data[0];
  check('track search finds Midnight Drive', search.data.length === 1 && midnight.isrc === 'IN001');
  const summer = (await api('GET', '/tracks?q=IN002', { token: admin })).data[0];

  console.log('\n3. Split agreements');
  const invalid = await api('POST', `/tracks/${midnight.id}/splits`, { token: admin, body: { effectiveFrom: '2026-10', shares: [
    { contributorId: cid.rahul, shareBp: 5000 }, { contributorId: cid.arjun, shareBp: 3000 }, { contributorId: cid.priya, shareBp: 1000 }] } });
  check('invalid split total (90%) rejected (400)', invalid.status === 400, invalid.data);
  const over = await api('POST', `/tracks/${midnight.id}/splits`, { token: admin, body: { shares: [
    { contributorId: cid.rahul, shareBp: 6000 }, { contributorId: cid.arjun, shareBp: 5000 }] } });
  check('invalid split total (110%) rejected (400)', over.status === 400);
  const v1 = await api('POST', `/tracks/${midnight.id}/splits`, { token: admin, body: { effectiveFrom: '2026-10', notes: 'Original agreement', shares: [
    { contributorId: cid.rahul, shareBp: 5000 }, { contributorId: cid.arjun, shareBp: 3000 }, { contributorId: cid.priya, shareBp: 2000 }] } });
  check('split v1 50/30/20 created as PENDING_APPROVAL', v1.status === 201 && v1.data.status === 'PENDING_APPROVAL' && v1.data.versionNo === 1, v1.data);
  const v1b = await api('POST', `/tracks/${midnight.id}/splits`, { token: admin, body: { shares: [{ contributorId: cid.rahul, shareBp: 10000 }] } });
  check('second version blocked while v1 pending (409)', v1b.status === 409);
  check('finance cannot approve a split (403)', (await api('POST', `/splits/${v1.data.id}/decision`, { token: finance, body: { decision: 'APPROVED' } })).status === 403);
  const meera = await login('meera', 'meera123');
  check('non-party contributor cannot approve (403)', (await api('POST', `/splits/${v1.data.id}/decision`, { token: meera, body: { decision: 'APPROVED' } })).status === 403);
  const r1 = await api('POST', `/splits/${v1.data.id}/decision`, { token: rahul, body: { decision: 'APPROVED' } });
  check('Rahul approves his allocation', r1.status === 200 && r1.data.status === 'PENDING_APPROVAL');
  check('Rahul cannot decide twice (409)', (await api('POST', `/splits/${v1.data.id}/decision`, { token: rahul, body: { decision: 'REJECTED', comment: 'x' } })).status === 409);
  const r2 = await api('POST', `/splits/${v1.data.id}/decision`, { token: arjun, body: { decision: 'APPROVED' } });
  check('Arjun approves; still pending (incomplete approvals)', r2.data.status === 'PENDING_APPROVAL');

  console.log('\n4. Streaming report upload (PostgreSQL + MongoDB)');
  const up1 = await uploadCsv(admin, 'spotify_2026_10.csv', 'SPOTIFY');
  check('Spotify Oct report imported (3 matched)', up1.status === 201 && up1.data.matchedRows === 3, up1.data);
  const up2 = await uploadCsv(admin, 'apple_music_2026_10.csv', 'APPLE_MUSIC');
  check('Apple Music Oct report imported', up2.status === 201 && up2.data.matchedRows === 3);
  const up3 = await uploadCsv(admin, 'youtube_music_2026_10.csv', 'YOUTUBE_MUSIC');
  check('YouTube Music Oct report: 2 matched, 2 unmatched', up3.status === 201 && up3.data.matchedRows === 2 && up3.data.unmatchedRows === 2, up3.data);
  check('duplicate report import rejected (409)', (await uploadCsv(admin, 'spotify_2026_10.csv', 'SPOTIFY')).status === 409);
  const inv = await uploadCsv(admin, 'invalid_report.csv', 'SPOTIFY');
  check('malformed CSV rejected with row errors (400)', inv.status === 400 && inv.data.details.errors.length >= 2, inv.data);
  const reports = (await api('GET', '/reports', { token: admin })).data;
  const ytRows = (await api('GET', `/reports/${reports.find((r) => r.reportKey === 'YOUTUBE_MUSIC-2026-10').id}/rows`, { token: admin })).data;
  check('original rows stored as individual MongoDB documents', ytRows.length === 4 && ytRows[0].original_row.ISRC === 'IN001', ytRows[0]);

  console.log('\n5. Calculation blocked without an approved split');
  const blocked = await api('POST', '/royalties/preview', { token: admin, body: { month: '2026-10' } });
  check('preview blocked: Midnight Drive split not fully approved (422)', blocked.status === 422 && /Midnight Drive/.test(blocked.data.error), blocked.data);
  const r3 = await api('POST', `/splits/${v1.data.id}/decision`, { token: priya, body: { decision: 'APPROVED' } });
  check('Priya approves -> version becomes ACTIVE', r3.data.status === 'ACTIVE', r3.data);

  console.log('\n6. Sampling relationships (Neo4j)');
  const s1 = await api('POST', '/sampling', { token: admin, body: { sourceTrackId: midnight.id, sampledTrackId: summer.id, percentageBp: 1000 } });
  check('Midnight Drive SAMPLES Summer Nights at 10%', s1.status === 201 && s1.data.relationships.length === 1);
  check('self-sampling rejected (400)', (await api('POST', '/sampling', { token: admin, body: { sourceTrackId: midnight.id, sampledTrackId: midnight.id, percentageBp: 500 } })).status === 400);
  check('circular sampling rejected (409)', (await api('POST', '/sampling', { token: admin, body: { sourceTrackId: summer.id, sampledTrackId: midnight.id, percentageBp: 500 } })).status === 409);

  console.log('\n7. Advances');
  const adv = await api('POST', '/advances', { token: admin, body: { contributorId: cid.rahul, amount: '2000.00', description: 'Signing advance' } });
  check('₹2,000 advance added for Rahul', adv.status === 201 && adv.data.outstandingBalance === '2000.00', adv.data);

  console.log('\n8. Unmatched rows & manual mapping');
  const un = (await api('GET', '/unmatched', { token: admin })).data;
  check('2 unmatched rows listed from MongoDB', un.length === 2);
  const live = un.find((u) => u.isrc === 'IN0O2');
  const map = await api('POST', `/unmatched/${encodeURIComponent(live.source_row_id)}/map`, { token: admin, body: { trackId: summer.id } });
  check('row IN0O2 mapped to Summer Nights -> PostgreSQL record created', map.status === 200 && map.data.streamingRecordId > 0, map.data);
  check('mapping the same row twice rejected (409)', (await api('POST', `/unmatched/${encodeURIComponent(live.source_row_id)}/map`, { token: admin, body: { trackId: summer.id } })).status === 409);
  const mapped = (await api('GET', '/unmatched?status=MAPPED', { token: admin })).data;
  check('original row kept in MongoDB with status MAPPED', mapped.length === 1 && mapped[0].original_row.ISRC === 'IN0O2');

  console.log('\n9. Royalty calculation (October 2026)');
  const pv = await api('POST', '/royalties/preview', { token: admin, body: { month: '2026-10' } });
  check('preview succeeds', pv.status === 200, pv.data);
  const md = pv.data.tracks.find((t) => t.isrc === 'IN001');
  check('Midnight Drive revenue ₹10,000, sampling ₹1,000, distributable ₹9,000',
    md.ownRevenue === '10000.00' && md.samplingDeduction === '1000.00' && md.distributable === '9000.00', md);
  const pc = Object.fromEntries(pv.data.contributors.map((c) => [c.name.split(' ')[0], c]));
  check('Rahul: gross 4500, advance 2000, net 2500', pc.Rahul.gross === '4500.00' && pc.Rahul.advanceDeduction === '2000.00' && pc.Rahul.net === '2500.00', pc.Rahul);
  check('Arjun: net 2700', pc.Arjun.net === '2700.00', pc.Arjun);
  check('Priya: net 1800', pc.Priya.net === '1800.00', pc.Priya);
  const sn = pv.data.tracks.find((t) => t.isrc === 'IN002');
  check('Summer Nights receives ₹1,000 sampling credit (+ mapped ₹360 row)', sn.samplingCredit === '1000.00' && sn.ownRevenue === '3570.00', sn);
  check('unmatched ZZ9999 row (₹140) excluded from revenue', pv.data.totals.revenue === '18515.50', pv.data.totals);
  check('preview totals: gross = revenue', pv.data.totals.gross === pv.data.totals.revenue);
  const run = await api('POST', '/royalties/runs', { token: admin, body: { month: '2026-10' } });
  check('royalty run saved (PENDING_APPROVAL) with split version', run.status === 201 && run.data.status === 'PENDING_APPROVAL'
    && run.data.tracks.find((t) => t.isrc === 'IN001').versionNo === 1, run.data);
  check('duplicate run for same period rejected (409)', (await api('POST', '/royalties/runs', { token: admin, body: { month: '2026-10' } })).status === 409);
  check('rerun of September (already paid) rejected (409)', (await api('POST', '/royalties/runs', { token: admin, body: { month: '2026-09' } })).status === 409);

  console.log('\n10. Finance approval & payments');
  const runId = run.data.id;
  check('payment before approval rejected (409)', (await api('POST', '/payments', { token: finance, headers: { 'Idempotency-Key': 'early-key-0001' }, body: { runId, contributorId: cid.rahul } })).status === 409);
  check('admin cannot approve runs (403)', (await api('POST', `/royalties/runs/${runId}/approve`, { token: admin })).status === 403);
  const ap = await api('POST', `/royalties/runs/${runId}/approve`, { token: finance });
  check('finance approves run', ap.status === 200 && ap.data.status === 'APPROVED', ap.data);
  check('approving twice rejected (409)', (await api('POST', `/royalties/runs/${runId}/approve`, { token: finance })).status === 409);
  const advAfter = (await api('GET', '/advances', { token: admin })).data.find((a) => a.contributorId === cid.rahul);
  check('Rahul advance recouped: outstanding 0.00', advAfter.outstandingBalance === '0.00', advAfter);

  const key = 'pay-rahul-oct-0001';
  const p1 = await api('POST', '/payments', { token: finance, headers: { 'Idempotency-Key': key }, body: { runId, contributorId: cid.rahul } });
  check('Rahul paid ₹2,500 (201)', p1.status === 201 && p1.data.payment.amount === '2500.00', p1.data);
  const p2 = await api('POST', '/payments', { token: finance, headers: { 'Idempotency-Key': key }, body: { runId, contributorId: cid.rahul } });
  check('retry with same key returns same payment (no duplicate)', p2.status === 200 && p2.data.idempotentReplay && p2.data.payment.id === p1.data.payment.id);
  const p3 = await api('POST', '/payments', { token: finance, headers: { 'Idempotency-Key': 'pay-rahul-oct-0002' }, body: { runId, contributorId: cid.rahul } });
  check('second payout to Rahul with new key rejected (409)', p3.status === 409, p3.data);
  check('contributor cannot record payments (403)', (await api('POST', '/payments', { token: rahul, headers: { 'Idempotency-Key': 'rahul-self-pay-1' }, body: { runId, contributorId: cid.rahul } })).status === 403);
  const detail = (await api('GET', `/royalties/runs/${runId}`, { token: finance })).data;
  for (const c of detail.contributors.filter((x) => x.paymentStatus === 'PENDING')) {
    await api('POST', '/payments', { token: finance, headers: { 'Idempotency-Key': `pay-${runId}-${c.contributorId}-a` }, body: { runId, contributorId: c.contributorId } });
  }
  const after = (await api('GET', `/royalties/runs/${runId}`, { token: finance })).data;
  check('all contributors paid -> run status PAID', after.status === 'PAID' && after.contributors.every((c) => c.paymentStatus !== 'PENDING'), after.status);
  const pays = (await api('GET', `/payments?runId=${runId}`, { token: finance })).data;
  check('exactly one payment per contributor in history', pays.length === new Set(pays.map((p) => p.contributorId)).size && pays.length === after.contributors.length);

  console.log('\n11. Statements');
  const st = await api('GET', '/me/statement', { token: rahul });
  const oct = st.data.runs.find((r) => r.month === '2026-10');
  check('Rahul statement: Oct net 2500, PAID', oct && oct.net === '2500.00' && oct.paymentStatus === 'PAID', oct);
  check('Rahul cannot view Arjun statement (403)', (await api('GET', `/statements/${cid.arjun}`, { token: rahul })).status === 403);
  check('finance can view any statement', (await api('GET', `/statements/${cid.arjun}`, { token: finance })).status === 200);

  console.log('\n12. Split versioning keeps history');
  const v2 = await api('POST', `/tracks/${midnight.id}/splits`, { token: admin, body: { effectiveFrom: '2026-11', shares: [
    { contributorId: cid.rahul, shareBp: 4000 }, { contributorId: cid.arjun, shareBp: 4000 }, { contributorId: cid.priya, shareBp: 2000 }] } });
  check('v2 created while v1 stays ACTIVE', v2.status === 201 && v2.data.versionNo === 2);
  await api('POST', `/splits/${v2.data.id}/decision`, { token: rahul, body: { decision: 'REJECTED', comment: 'Disagree with 40%' } });
  const hist = (await api('GET', `/tracks/${midnight.id}/splits`, { token: admin })).data;
  check('rejected v2 and active v1 both retained', hist.length === 2 && hist.find((v) => v.versionNo === 1).status === 'ACTIVE' && hist.find((v) => v.versionNo === 2).status === 'REJECTED');

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
