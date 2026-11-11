// API routes. Every route (except login/health) requires a valid JWT and
// role checks are enforced here on the server, not only in the UI.
const express = require('express');
const multer = require('multer');
const c = require('../controllers');
const { authenticate, authorize } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const ADMIN = 'ADMIN';
const FIN = 'FINANCE';
const CON = 'CONTRIBUTOR';

const r = express.Router();

// ---- public ----
r.post('/auth/login', c.auth.login);

r.use(authenticate);

// ---- auth / users ----
r.get('/auth/me', c.auth.me);
r.get('/users', authorize(ADMIN), c.auth.users);

// ---- dashboards ----
r.get('/dashboard/admin', authorize(ADMIN), c.dashboard.admin);
r.get('/dashboard/finance', authorize(FIN), c.dashboard.finance);
r.get('/dashboard/contributor', authorize(CON), c.dashboard.contributor);

// ---- tracks & contributors ----
r.get('/platforms', c.tracks.platforms);
r.get('/tracks', authorize(ADMIN, FIN), c.tracks.list);
r.get('/tracks/:id', authorize(ADMIN, FIN), c.tracks.get);
r.post('/tracks', authorize(ADMIN), c.tracks.create);
r.put('/tracks/:id', authorize(ADMIN), c.tracks.update);
r.get('/contributors', authorize(ADMIN, FIN), c.contributors.list);
r.post('/contributors', authorize(ADMIN), c.contributors.create);
r.put('/contributors/:id', authorize(ADMIN), c.contributors.update);

// ---- split agreements ----
r.get('/splits', authorize(ADMIN), c.splits.listAll);
r.get('/tracks/:trackId/splits', authorize(ADMIN, FIN, CON), c.splits.listForTrack);
r.post('/tracks/:trackId/splits', authorize(ADMIN), c.splits.create);
r.post('/splits/:versionId/decision', authorize(CON), c.splits.decide);

// ---- sampling (Neo4j) ----
r.get('/sampling', authorize(ADMIN, FIN), c.sampling.list);
r.post('/sampling', authorize(ADMIN), c.sampling.create);
r.delete('/sampling/:sourceId/:sampledId', authorize(ADMIN), c.sampling.remove);

// ---- advances ----
r.get('/advances', authorize(ADMIN, FIN), c.advances.list);
r.get('/advances/transactions', authorize(ADMIN, FIN), c.advances.transactions);
r.post('/advances', authorize(ADMIN), c.advances.create);

// ---- streaming reports (PostgreSQL + MongoDB) ----
r.post('/reports/upload', authorize(ADMIN), upload.single('file'), c.reports.upload);
r.get('/reports', authorize(ADMIN, FIN), c.reports.list);
r.get('/reports/:id/rows', authorize(ADMIN, FIN), c.reports.rows);
r.get('/unmatched', authorize(ADMIN), c.reports.unmatched);
r.post('/unmatched/:sourceRowId/map', authorize(ADMIN), c.reports.map);

// ---- royalty runs ----
r.post('/royalties/preview', authorize(ADMIN), c.royalties.preview);
r.post('/royalties/runs', authorize(ADMIN), c.royalties.create);
r.get('/royalties/runs', authorize(ADMIN, FIN), c.royalties.list);
r.get('/royalties/runs/:id', authorize(ADMIN, FIN), c.royalties.get);
r.post('/royalties/runs/:id/approve', authorize(FIN), c.royalties.approve);
r.post('/royalties/runs/:id/reject', authorize(FIN), c.royalties.reject);

// ---- payments ----
r.get('/payments', authorize(ADMIN, FIN), c.payments.list);
r.post('/payments', authorize(FIN), c.payments.pay);

// ---- statements ----
r.get('/me/tracks', authorize(CON), c.tracks.mine);
r.get('/me/splits', authorize(CON), c.splits.mine);
r.get('/me/advances', authorize(CON), c.advances.mine);
r.get('/me/statement', authorize(CON), c.statements.mine);
r.get('/statements/:contributorId', authorize(ADMIN, FIN, CON), c.statements.get);

module.exports = r;
