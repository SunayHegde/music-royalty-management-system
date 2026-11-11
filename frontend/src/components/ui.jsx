import { useCallback, useEffect, useState } from 'react';
import { titleCase } from '../format';

/** Load data from the API with loading / error state. */
export function useApi(fn, deps = []) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try { setData(await fn()); } catch (e) { setError(e); } finally { setLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load, setData };
}

/** Run a mutating action with busy / success / error feedback. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const run = useCallback(async (fn, successMsg) => {
    setBusy(true); setError(null); setSuccess(null);
    try {
      const r = await fn();
      if (successMsg) setSuccess(typeof successMsg === 'function' ? successMsg(r) : successMsg);
      return r;
    } catch (e) {
      setError(e);
      return undefined;
    } finally { setBusy(false); }
  }, []);
  const clear = () => { setError(null); setSuccess(null); };
  return { busy, error, success, run, clear, setError };
}

export const PageHeader = ({ title, subtitle, actions }) => (
  <div className="page-header">
    <div>
      <h1>{title}</h1>
      {subtitle && <p className="muted">{subtitle}</p>}
    </div>
    {actions && <div className="row gap">{actions}</div>}
  </div>
);

export const Card = ({ title, actions, children, className = '' }) => (
  <section className={`card ${className}`}>
    {(title || actions) && (
      <header className="card-header">
        {title && <h2>{title}</h2>}
        {actions && <div className="row gap">{actions}</div>}
      </header>
    )}
    {children}
  </section>
);

export const Stat = ({ label, value, hint, tone }) => (
  <div className={`stat ${tone ? `stat-${tone}` : ''}`}>
    <div className="stat-label">{label}</div>
    <div className="stat-value">{value}</div>
    {hint && <div className="stat-hint">{hint}</div>}
  </div>
);

const BADGE_TONES = {
  ACTIVE: 'good', APPROVED: 'good', PAID: 'good', MATCHED: 'good', MAPPED: 'info', AUTO: 'neutral', MANUAL: 'info',
  PENDING_APPROVAL: 'warn', PENDING: 'warn', UNMATCHED: 'warn',
  REJECTED: 'bad', SUPERSEDED: 'neutral', NOTHING_DUE: 'neutral', ISSUED: 'info', RECOUPED: 'neutral',
};
const BADGE_ICONS = { good: '✓', warn: '●', bad: '✕', info: '◆', neutral: '○' };

export const Badge = ({ status, label }) => {
  const tone = BADGE_TONES[status] || 'neutral';
  return (
    <span className={`badge badge-${tone}`}>
      <span aria-hidden="true">{BADGE_ICONS[tone]}</span> {label || titleCase(status)}
    </span>
  );
};

export function Alert({ error, success, onClose }) {
  if (!error && !success) return null;
  const details = error?.details?.errors || error?.details?.tracksWithoutApprovedSplit?.map((t) => `${t.title} (${t.isrc})`);
  return (
    <div className={`alert ${error ? 'alert-error' : 'alert-success'}`} role={error ? 'alert' : 'status'}>
      <div>
        <strong>{error ? error.message : success}</strong>
        {details && (
          <ul>{details.map((d) => <li key={d}>{d}</li>)}</ul>
        )}
      </div>
      {onClose && <button type="button" className="alert-close" onClick={onClose} aria-label="Dismiss">×</button>}
    </div>
  );
}

export const Spinner = ({ label = 'Loading…' }) => (
  <div className="loading"><span className="spinner" aria-hidden="true" /> {label}</div>
);

export const Empty = ({ children }) => <div className="empty">{children}</div>;

/** Standard wrapper for a useApi() result. */
export function Loader({ state, children }) {
  if (state.loading && !state.data) return <Spinner />;
  if (state.error) return <Alert error={state.error} />;
  return children(state.data);
}

export function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <header className="card-header">
          <h2>{title}</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Close">×</button>
        </header>
        {children}
      </div>
    </div>
  );
}

export const Field = ({ label, children, hint }) => (
  <label className="field">
    <span className="field-label">{label}</span>
    {children}
    {hint && <span className="field-hint">{hint}</span>}
  </label>
);

export const Button = ({ busy, disabled, children, variant = 'primary', ...rest }) => (
  <button type="button" className={`btn btn-${variant}`} {...rest} disabled={busy || disabled}>
    {busy && <span className="spinner spinner-sm" aria-hidden="true" />} {children}
  </button>
);
