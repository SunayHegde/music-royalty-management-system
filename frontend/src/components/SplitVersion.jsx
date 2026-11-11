import { Badge } from './ui';
import { date, month, pct, titleCase } from '../format';

/** One split version with every contributor's share and approval status. */
export default function SplitVersion({ version, highlightContributorId, children }) {
  const approved = version.shares.filter((s) => s.approvalStatus === 'APPROVED').length;
  return (
    <div className={`split-version split-${version.status.toLowerCase()}`}>
      <div className="row between wrap">
        <div>
          <strong>{version.trackTitle} — Version {version.versionNo}</strong>
          <div className="muted small">
            Effective from {month(version.effectiveFrom?.slice(0, 7))} · created {date(version.createdAt)}
            {version.createdBy ? ` by ${version.createdBy}` : ''}
            {version.activatedAt ? ` · activated ${date(version.activatedAt)}` : ''}
          </div>
        </div>
        <div className="row gap">
          <span className="muted small">{approved}/{version.shares.length} approved</span>
          <Badge status={version.status} />
        </div>
      </div>
      {version.notes && <p className="small muted">{version.notes}</p>}
      <div className="share-bar" aria-hidden="true">
        {version.shares.map((s, i) => (
          <span key={s.contributorId} style={{ width: `${s.shareBp / 100}%` }} className={`share-seg seg-${i % 6}`} title={`${s.name} ${pct(s.shareBp)}`} />
        ))}
      </div>
      <table className="compact">
        <thead><tr><th>Contributor</th><th>Role</th><th className="num">Share</th><th>Approval</th><th>Comment</th></tr></thead>
        <tbody>
          {version.shares.map((s, i) => (
            <tr key={s.contributorId} className={s.contributorId === highlightContributorId ? 'highlight' : ''}>
              <td><span className={`dot seg-${i % 6}`} /> {s.name}{s.contributorId === highlightContributorId ? ' (you)' : ''}</td>
              <td>{titleCase(s.role)}</td>
              <td className="num">{pct(s.shareBp)} <span className="muted small">({s.shareBp} bp)</span></td>
              <td><Badge status={s.approvalStatus} /></td>
              <td className="small">{s.comment || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {children}
    </div>
  );
}
