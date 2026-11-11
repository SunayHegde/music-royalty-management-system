// Display formatting. Money arrives from the API as exact decimal strings ("4500.00");
// we only insert grouping separators for display - no float arithmetic.
export function inr(value) {
  if (value === null || value === undefined || value === '') return '—';
  const s = String(value);
  const neg = s.startsWith('-');
  const [i, f = '00'] = (neg ? s.slice(1) : s).split('.');
  // Indian digit grouping: 12,34,567.00
  const last3 = i.slice(-3);
  const rest = i.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}₹${rest ? `${rest},` : ''}${last3}.${(f + '00').slice(0, 2)}`;
}

export const pct = (bp) => `${(Number(bp) / 100).toFixed(2).replace(/\.00$/, '')}%`;
export const num = (n) => Number(n || 0).toLocaleString('en-IN');
export const date = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const dateTime = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const month = (m) => {
  if (!m) return '—';
  const [y, mo] = m.split('-');
  return new Date(Number(y), Number(mo) - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
};
export const titleCase = (s) => (s ? s.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : '');

/** '12.5' (percent) -> 1250 basis points, exact (no float multiply). */
export function percentToBp(str) {
  const s = String(str ?? '').trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) return NaN;
  const [i, f = ''] = s.split('.');
  return Number(i) * 100 + Number((f + '00').slice(0, 2));
}
