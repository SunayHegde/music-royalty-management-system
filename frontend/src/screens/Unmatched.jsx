import { useState } from 'react';
import { get, post } from '../api';
import { Alert, Badge, Button, Card, Empty, Loader, PageHeader, useAction, useApi } from '../components/ui';
import { dateTime, inr, month, num } from '../format';

export default function Unmatched() {
  const [status, setStatus] = useState('UNMATCHED');
  const rows = useApi(() => get(`/unmatched?status=${status}`), [status]);
  const tracks = useApi(() => get('/tracks'));
  const [choice, setChoice] = useState({});
  const action = useAction();

  const map = async (row) => {
    const res = await action.run(
      () => post(`/unmatched/${encodeURIComponent(row.source_row_id)}/map`, { trackId: Number(choice[row.source_row_id]) }),
      (r) => `Row ${r.sourceRowId} mapped to ${r.trackTitle}; normalized record #${r.streamingRecordId} created in PostgreSQL.${r.warning ? ` ${r.warning}` : ''}`
    );
    if (res) rows.reload();
  };

  return (
    <>
      <PageHeader title="Unmatched Report Rows" subtitle="Rows whose ISRC did not match the catalogue. They are excluded from royalty calculations until mapped to a track." />
      <Alert error={action.error} success={action.success} onClose={action.clear} />
      <Card actions={(
        <div className="segmented" role="tablist">
          {['UNMATCHED', 'MAPPED', 'ALL'].map((s) => (
            <button key={s} type="button" role="tab" aria-selected={status === s} className={status === s ? 'active' : ''} onClick={() => setStatus(s)}>
              {s === 'ALL' ? 'All' : s === 'MAPPED' ? 'Mapped' : 'Unmatched'}
            </button>
          ))}
        </div>
      )} title="Rows from MongoDB">
        <Loader state={rows}>
          {(docs) => (docs.length === 0 ? <Empty>{status === 'UNMATCHED' ? 'Nothing to resolve — every row is matched. 🎉' : 'No rows.'}</Empty> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Report</th><th>Month</th><th>Reported ISRC</th><th>Reported title</th><th className="num">Streams</th><th className="num">Revenue</th><th>Status</th><th>Map to track</th></tr></thead>
                <tbody>
                  {docs.map((d) => (
                    <tr key={d.source_row_id}>
                      <td><code className="small">{d.source_row_id}</code></td>
                      <td>{month(d.month)}</td>
                      <td><code>{d.original_row.ISRC ?? d.isrc}</code></td>
                      <td>{d.track_name}</td>
                      <td className="num">{num(d.streams)}</td>
                      <td className="num">{inr(d.revenue)}</td>
                      <td><Badge status={d.status} /></td>
                      <td>
                        {d.status === 'UNMATCHED' ? (
                          <div className="row gap nowrap">
                            <select value={choice[d.source_row_id] || ''} onChange={(e) => setChoice({ ...choice, [d.source_row_id]: e.target.value })} aria-label="Track">
                              <option value="">Select track…</option>
                              {(tracks.data || []).map((t) => <option key={t.id} value={t.id}>{t.title} ({t.isrc})</option>)}
                            </select>
                            <Button className="btn btn-primary btn-sm" busy={action.busy} disabled={!choice[d.source_row_id]} onClick={() => map(d)}>Map</Button>
                          </div>
                        ) : (
                          <span className="small">→ {d.mapped_track_title} ({d.mapped_track_isrc}) · {d.mapped_by}, {dateTime(d.mapped_at)}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </Loader>
      </Card>
    </>
  );
}
