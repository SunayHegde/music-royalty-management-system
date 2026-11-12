import { useState } from 'react';
import { get, post } from '../api';
import RunBreakdown from '../components/RunBreakdown';
import { Alert, Badge, Button, Card, Empty, Field, Loader, Modal, PageHeader, useAction, useApi } from '../components/ui';
import { dateTime, inr, month } from '../format';

export default function Royalties() {
  const runs = useApi(() => get('/royalties/runs'));
  const [period, setPeriod] = useState('2026-10');
  const [preview, setPreview] = useState(null);
  const [viewing, setViewing] = useState(null);
  const action = useAction();

  const doPreview = async () => {
    setPreview(null);
    const res = await action.run(() => post('/royalties/preview', { month: period }));
    if (res) setPreview(res);
  };
  const save = async () => {
    const res = await action.run(() => post('/royalties/runs', { month: period }),
      (r) => `Royalty run #${r.id} for ${month(r.month)} saved and sent to Finance for approval.`);
    if (res) { setPreview(null); runs.reload(); }
  };

  return (
    <>
      <PageHeader title="Royalty Calculation" subtitle="Revenue − sampling obligations → approved split → advance recoupment → net payable. Exact NUMERIC arithmetic." />
      <Card title="Calculate royalties">
        <div className="toolbar">
          <Field label="Reporting month">
            <input type="month" value={period} onChange={(e) => { setPeriod(e.target.value); setPreview(null); action.clear(); }} />
          </Field>
          <Button onClick={doPreview} busy={action.busy && !preview} disabled={!period}>Calculate royalties (preview)</Button>
        </div>
        <Alert error={action.error} success={action.success} onClose={action.clear} />
        {preview && (
          <div className="preview-box">
            <div className="row between wrap">
              <div>
                <h3>Preview — {month(preview.month)}</h3>
                <p className="muted small">Nothing has been saved yet. Review the figures, then save the run for Finance approval.</p>
              </div>
              <div className="row gap">
                <Button variant="ghost" onClick={() => setPreview(null)}>Discard</Button>
                <Button onClick={save} busy={action.busy}>Save run & submit to Finance</Button>
              </div>
            </div>
            <RunBreakdown data={preview} />
          </div>
        )}
      </Card>
      <Card title="Royalty run history">
        <Loader state={runs}>
          {(rows) => (rows.length === 0 ? <Empty>No royalty runs yet.</Empty> : <RunTable rows={rows} onView={setViewing} />)}
        </Loader>
      </Card>
      {viewing && <RunModal runId={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

export function RunTable({ rows, onView, action }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Run</th><th>Month</th><th>Status</th><th className="num">Revenue</th><th className="num">Sampling</th><th className="num">Advances</th><th className="num">Net payable</th><th>Calculated</th><th>Approved / rejected</th><th /></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td>#{r.id}</td>
              <td><strong>{month(r.month)}</strong></td>
              <td><Badge status={r.status} />{r.status === 'APPROVED' && <div className="small muted">{r.pendingPayments} unpaid</div>}</td>
              <td className="num">{inr(r.totalRevenue)}</td>
              <td className="num">{inr(r.totalSampling)}</td>
              <td className="num">{inr(r.totalAdvanceDeduction)}</td>
              <td className="num"><strong>{inr(r.totalNet)}</strong></td>
              <td className="small">{r.calculatedBy} · {dateTime(r.calculatedAt)}</td>
              <td className="small">
                {r.approvedBy && `${r.approvedBy} · ${dateTime(r.approvedAt)}`}
                {r.rejectedBy && <>{r.rejectedBy} · {dateTime(r.rejectedAt)}<div className="muted">“{r.rejectionReason}”</div></>}
                {!r.approvedBy && !r.rejectedBy && '—'}
              </td>
              <td className="row gap end">
                {action && action(r)}
                <Button variant="ghost" className="btn btn-ghost btn-sm" onClick={() => onView(r.id)}>View</Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function RunModal({ runId, onClose }) {
  const run = useApi(() => get(`/royalties/runs/${runId}`), [runId]);
  return (
    <Modal title={`Royalty run #${runId}`} onClose={onClose}>
      <Loader state={run}>
        {(r) => (
          <>
            <p><Badge status={r.status} /> {month(r.month)} · scope {r.scope}</p>
            <RunBreakdown data={r} />
          </>
        )}
      </Loader>
    </Modal>
  );
}
