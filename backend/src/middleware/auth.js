const jwt = require('jsonwebtoken');
const config = require('../config');
const { ApiError } = require('../utils/errors');

/** Verifies the Bearer JWT and attaches req.user = { id, username, role, contributorId, fullName } */
function authenticate(req, _res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next(new ApiError(401, 'Authentication required'));
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = {
      id: payload.sub,
      username: payload.username,
      role: payload.role,
      contributorId: payload.contributorId ?? null,
      fullName: payload.fullName,
    };
    return next();
  } catch {
    return next(new ApiError(401, 'Session expired or invalid token. Please log in again.'));
  }
}

/** Role gate enforced on the server for every protected route. */
const authorize = (...roles) => (req, _res, next) => {
  if (!req.user) return next(new ApiError(401, 'Authentication required'));
  if (!roles.includes(req.user.role)) {
    return next(new ApiError(403, `This action requires role: ${roles.join(' or ')}`));
  }
  return next();
};

module.exports = { authenticate, authorize };
