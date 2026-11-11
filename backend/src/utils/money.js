// Exact money arithmetic using BigInt paise (1 rupee = 100 paise).
// Floating point is never used for money anywhere in the system.
const { ApiError } = require('./errors');

const STRICT = /^\d+(\.\d{1,2})?$/;
const LENIENT = /^\d+(\.\d+)?$/;

/** '1234.5' -> 123450n. Rejects anything that isn't a non-negative amount with <= 2 decimals. */
function toPaise(value, field = 'amount') {
  const s = String(value ?? '').trim().replace(/,/g, '');
  if (!STRICT.test(s)) throw new ApiError(400, `${field} must be a non-negative amount with at most 2 decimals`);
  const [i, f = ''] = s.split('.');
  return BigInt(i) * 100n + BigInt((f + '00').slice(0, 2));
}

/** Like toPaise but accepts more decimals (platform reports) and rounds half-up to paise. */
function toPaiseRounded(value) {
  const s = String(value ?? '').trim().replace(/,/g, '');
  if (!LENIENT.test(s)) return null;
  const [i, f = ''] = s.split('.');
  let paise = BigInt(i) * 100n + BigInt((f + '00').slice(0, 2));
  if (f.length > 2 && Number(f[2]) >= 5) paise += 1n;
  return paise;
}

/** 123450n -> '1234.50' */
function fromPaise(p) {
  const neg = p < 0n;
  const abs = neg ? -p : p;
  const s = `${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
  return neg ? `-${s}` : s;
}

/** amount * bp / 10000, rounded half-up */
function percentOf(paise, bp) {
  return (paise * BigInt(bp) + 5000n) / 10000n;
}

const minBig = (a, b) => (a < b ? a : b);

module.exports = { toPaise, toPaiseRounded, fromPaise, percentOf, minBig };
