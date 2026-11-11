import { Badge, Stat } from './ui';
import { inr, num, pct } from '../format';

/** Renders a royalty preview (unsaved) or a saved run in the same layout. */
export default function RunBreakdown({ data, renderPayAction }) {
  const t = data.totals || {
    revenue: data.totalRevenue, sampling: data.totalSampling, gross: data.totalGross,
    advanceDeduction: data.totalAdvanceDeduction, net: data.totalNet, streams: data.totalStreams, recordCount: data.recordCount,
  };
  return (
    <div className="stack">
      <div className="stats">
        <Stat label="Matched revenue" value={inr(t.revenue)} hint={`${num(t.recordCount)} records · ${num(t.streams)} streams`} />
        <Stat label="Sampling obligations" value={inr(t.sampling)} hint="moved between tracks" />
        <Stat label="Gross royalties" value={inr(t.gross)} />
        <Stat label="Advance recoupment" value={inr(t.advanceDeduction)} />
        <Stat label="Net payable" value={inr(t.net)} tone="good" />
      </div>

      <h3>Per track</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Track</th><th>Split used</th><th className="num">Streams</th><th className="num">Revenue</th><th className="num">− Sampling owed</th><th className="num">+ Sampling received</th><th className="num">Distributable</th></tr></thead>
          <tbody>
            {data.tracks.map((tr) => (
              <tr key={tr.trackId}>
                <td><strong>{tr.title}</strong> <code>{tr.isrc}</code></td>
                <td>Version {tr.versionNo} <span className="muted small">(#{tr.splitVersionId})</span></td>
                <td className="num">{num(tr.streams)}</td>
                <td className="num">{inr(tr.ownRevenue)}</td>
                <td className="num">{tr.samplingDeduction !== '0.00' ? `−${inr(tr.samplingDeduction)}` : '—'}</td>
                <td className="num">{tr.samplingCredit !== '0.00' ? `+${inr(tr.samplingCredit)}` : '—'}</td>
                <td className="num"><strong>{inr(tr.distributable)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.obligations.length > 0 && (
        <>
          <h3>Sampling obligations (from Neo4j)</h3>
          <ul className="list compact-list">
            {data.obligations.map((o) => (
              <li key={`${o.sourceTrackId}-${o.sampledTrackId}`}>
                <strong>{o.sourceTitle}</strong> samples <strong>{o.sampledTitle}</strong>: {pct(o.percentageBp)} of {inr(o.baseRevenue)} = <strong>{inr(o.amount)}</strong>
              </li>
            ))}
          </ul>
        </>
      )}

      <h3>Contributor lines</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Track</th><th>Contributor</th><th className="num">Share</th><th className="num">Gross</th><th className="num">Advance deducted</th><th className="num">Net</th></tr></thead>
          <tbody>
            {data.tracks.flatMap((tr) => (tr.lines || []).map((l) => (
              <tr key={`${tr.trackId}-${l.contributorId}`}>
                <td>{tr.title}</td>
                <td>{l.name}</td>
                <td className="num">{pct(l.shareBp)}</td>
                <td className="num">{inr(l.gross)}</td>
                <td className="num">{l.advanceDeduction !== '0.00' ? `−${inr(l.advanceDeduction)}` : '—'}</td>
                <td className="num">{inr(l.net)}</td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>

      <h3>Contributor totals</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Contributor</th><th className="num">Gross</th>
              {data.contributors[0]?.outstandingAdvance !== undefined && <th className="num">Advance balance</th>}
              <th className="num">Advance deducted</th>
              {data.contributors[0]?.advanceCarryForward !== undefined && <th className="num">Carried forward</th>}
              <th className="num">Net payable</th>
              {data.contributors[0]?.paymentStatus !== undefined && <th>Payment</th>}
              {renderPayAction && <th />}
            </tr>
          </thead>
          <tbody>
            {data.contributors.map((c) => (
              <tr key={c.contributorId}>
                <td><strong>{c.name}</strong></td>
                <td className="num">{inr(c.gross)}</td>
                {c.outstandingAdvance !== undefined && <td className="num">{inr(c.outstandingAdvance)}</td>}
                <td className="num">{c.advanceDeduction !== '0.00' ? `−${inr(c.advanceDeduction)}` : '—'}</td>
                {c.advanceCarryForward !== undefined && <td className="num">{inr(c.advanceCarryForward)}</td>}
                <td className="num"><strong>{inr(c.net)}</strong></td>
                {c.paymentStatus !== undefined && (
                  <td><Badge status={c.paymentStatus} />{c.paymentReference && <div className="small muted">{c.paymentReference}</div>}</td>
                )}
                {renderPayAction && <td>{renderPayAction(c)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
