// Thin HTTP controllers: parse request -> call service -> send JSON.
// Ownership checks that depend on the logged-in user live here or in the services.
const { asyncHandler: h, ApiError } = require('../utils/errors');
const authService = require('../services/authService');
const trackService = require('../services/trackService');
const contributorService = require('../services/contributorService');
const splitService = require('../services/splitService');
const samplingService = require('../services/samplingService');
const advanceService = require('../services/advanceService');
const reportService = require('../services/reportService');
const royaltyService = require('../services/royaltyService');
const paymentService = require('../services/paymentService');
const statementService = require('../services/statementService');
const dashboardService = require('../services/dashboardService');

const ownContributor = (req) => {
  if (!req.user.contributorId) throw new ApiError(403, 'Your account is not linked to a contributor record');
  return req.user.contributorId;
};

module.exports = {
  auth: {
    login: h(async (req, res) => res.json(await authService.login(req.body.username, req.body.password))),
    me: h(async (req, res) => res.json(await authService.me(req.user.id))),
    users: h(async (req, res) => res.json(await authService.listUsers({ role: req.query.role, unlinked: req.query.unlinked === 'true' }))),
  },
  dashboard: {
    admin: h(async (_req, res) => res.json(await dashboardService.admin())),
    finance: h(async (_req, res) => res.json(await dashboardService.finance())),
    contributor: h(async (req, res) => { ownContributor(req); res.json(await dashboardService.contributor(req.user)); }),
  },
  tracks: {
    list: h(async (req, res) => res.json(await trackService.list({ q: req.query.q }))),
    mine: h(async (req, res) => res.json(await trackService.list({ contributorId: ownContributor(req) }))),
    get: h(async (req, res) => res.json(await trackService.get(req.params.id))),
    create: h(async (req, res) => res.status(201).json(await trackService.create(req.body))),
    update: h(async (req, res) => res.json(await trackService.update(Number(req.params.id), req.body))),
    platforms: h(async (_req, res) => res.json(await trackService.listPlatforms())),
  },
  contributors: {
    list: h(async (_req, res) => res.json(await contributorService.list())),
    create: h(async (req, res) => res.status(201).json(await contributorService.create(req.body))),
    update: h(async (req, res) => res.json(await contributorService.update(Number(req.params.id), req.body))),
  },
  splits: {
    listForTrack: h(async (req, res) => res.json(await splitService.listForTrack(Number(req.params.trackId), req.user))),
    listAll: h(async (req, res) => res.json(await splitService.listAll({ status: req.query.status }))),
    mine: h(async (req, res) => res.json(await splitService.listForContributor(ownContributor(req)))),
    create: h(async (req, res) => res.status(201).json(await splitService.create(Number(req.params.trackId), req.body, req.user))),
    decide: h(async (req, res) => res.json(await splitService.decide(Number(req.params.versionId), req.user, req.body.decision, req.body.comment))),
  },
  sampling: {
    list: h(async (_req, res) => res.json(await samplingService.list())),
    create: h(async (req, res) => res.status(201).json(await samplingService.create(req.body, req.user))),
    remove: h(async (req, res) => res.json(await samplingService.remove(req.params.sourceId, req.params.sampledId))),
  },
  advances: {
    list: h(async (_req, res) => res.json(await advanceService.list())),
    mine: h(async (req, res) => res.json(await advanceService.list({ contributorId: ownContributor(req) }))),
    create: h(async (req, res) => res.status(201).json(await advanceService.create(req.body, req.user))),
    transactions: h(async (req, res) => res.json(await advanceService.transactions({ advanceId: req.query.advanceId ? Number(req.query.advanceId) : undefined }))),
  },
  reports: {
    upload: h(async (req, res) => res.status(201).json(await reportService.upload({ file: req.file, platformCode: req.body.platform }, req.user))),
    list: h(async (_req, res) => res.json(await reportService.list())),
    rows: h(async (req, res) => res.json(await reportService.rows(Number(req.params.id)))),
    unmatched: h(async (req, res) => res.json(await reportService.listUnmatched({ status: req.query.status || 'UNMATCHED' }))),
    map: h(async (req, res) => res.json(await reportService.mapUnmatched(req.params.sourceRowId, req.body.trackId, req.user))),
  },
  royalties: {
    preview: h(async (req, res) => res.json(await royaltyService.preview(req.body.month))),
    create: h(async (req, res) => res.status(201).json(await royaltyService.createRun(req.body.month, req.user))),
    list: h(async (_req, res) => res.json(await royaltyService.listRuns())),
    get: h(async (req, res) => res.json(await royaltyService.getRun(Number(req.params.id)))),
    approve: h(async (req, res) => res.json(await royaltyService.approveRun(Number(req.params.id), req.user))),
    reject: h(async (req, res) => res.json(await royaltyService.rejectRun(Number(req.params.id), req.user, req.body.reason))),
  },
  payments: {
    list: h(async (req, res) => res.json(await paymentService.list({ runId: req.query.runId ? Number(req.query.runId) : undefined }))),
    pay: h(async (req, res) => {
      const result = await paymentService.pay(req.body, req.get('Idempotency-Key'), req.user);
      res.status(result.idempotentReplay ? 200 : 201).json(result);
    }),
  },
  statements: {
    get: h(async (req, res) => {
      const id = Number(req.params.contributorId);
      if (req.user.role === 'CONTRIBUTOR' && req.user.contributorId !== id) {
        throw new ApiError(403, 'You can only view your own royalty statement');
      }
      res.json(await statementService.forContributor(id));
    }),
    mine: h(async (req, res) => res.json(await statementService.forContributor(ownContributor(req)))),
  },
};
