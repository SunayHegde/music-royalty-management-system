import { useRef, useState } from 'react';
import { api, get, post } from '../api';
import RunBreakdown from '../components/RunBreakdown';
import { Alert, Badge, Button, Card, Empty, Field, Loader, Modal, PageHeader, Stat, useAction, useApi } from '../components/ui';
import { inr, month, num } from '../format';
import { RunModal, RunTable } from './Royalties';

const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

export default function FinanceDashboard() {
  const dash = useApi(() => get('/dashboard/finance'));
  const runs = useApi(() => get('/royalties/runs'));
  const [selected, setSelected] = useState(null);
  const [viewing, setViewing] = useState(null);
  const refresh = () => { dash.reload(); runs.reload(); };

  const actionable = (runs.data || []).filter((r) => ['PENDING_APPROVAL', 'APPROVED'].includes(r.status));
  return (
    <>
      <PageHeader title="Finance" subtitle="Review royalty runs, approve them, and record simulated payouts (idempotent, append-only)." />
      <Loader state={dash}>
        {(d) => (
          <div className="stats">
            <Stat label="Runs awaiting approval" value={num(d.counts.awaitingApproval)} tone={d.counts.awaitingApproval ? 'warn' : undefined} />
            <Stat label="Approved runs with unpaid lines" value={num(d.counts.awaitingPayment)} />
            <Stat label="Outstanding payable" value={inr(d.counts.outstandingPayable)} />
            <Stat label="Total paid" value={inr(d.counts.totalPaid)} hint={`${d.counts.paymentCount} payments`} tone="good" />
          </div>
        )}
      </Loader>
      <Card title="Runs needing action">
        <Loader state={runs}>
          {() => (actionable.length === 0 ? <Empty>No runs need action right now.</Empty> : (
            <RunTable rows={actionable} onView={setViewing}
              action={(r) => <Button className="btn btn-primary btn-sm" onClick={() => setSelected(r.id)}>{r.status === 'PENDING_APPROVAL' ? 'Review' : 'Pay'}</Button>} />
          ))}
        </Loader>
      </Card>
      <Card title="All royalty runs">
        <Loader state={runs}>{(rows) => (rows.length === 0 ? <Empty>No runs yet.</Empty> : <RunTable rows={rows} onView={setViewing} />)}</Loader>
      </Card>
      {selected && <RunReview runId={selected} onClose={() => { setSelected(null); refresh(); }} onChanged={refresh} />}
      {viewing && <RunModal runId={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

function RunReview({ runId, onClose, onChanged }) {
  const run = useApi(() => get(`/royalties/runs/${runId}`), [runId]);
  const action = useAction();
  const [reason, setReason] = useState('');
  const [showReject, setShowReject] = useState(false);
  // one idempotency key per contributor payment attempt; reused on retry so a double click / network retry can't pay twice
  const keys = useRef({});

  const approve = async () => {
    const res = await action.run(() => post(`/royalties/runs/${runId}/approve`), 'Run approved. Advances recouped; payments can now be recorded.');
    if (res) { run.setData(res); onChanged(); }
  };
  const reject = async () => {
    const res = await action.run(() => post(`/royalties/runs/${runId}/reject`, { reason }), 'Run rejected. Its streaming records are released for recalculation.');
    if (res) { run.setData(res); setShowReject(false); onChanged(); }
  };
  const pay = async (c) => {
    keys.current[c.contributorId] ||= newKey();
    const res = await action.run(
      () => api('/payments', { method: 'POST', body: { runId, contributorId: c.contributorId }, headers: { 'Idempotency-Key': keys.current[c.contributorId] } }),
      (r) => `${r.idempotentReplay ? 'Already recorded' : 'Paid'} ${inr(r.payment.amount)} to ${r.payment.contributorName} (ref ${r.payment.paymentReference})`
    );
    if (res) { run.reload(); onChanged(); }
  };

  return (
    <Modal title={`Royalty run #${runId}`} onClose={onClose}>
      <Loader state={run}>
        {(r) => (
          <div className="stack">
            <div className="row between wrap">
              <div><Badge status={r.status} /> <strong>{month(r.month)}</strong> · calculated by {r.calculatedBy}</div>
              {r.status === 'PENDING_APPROVAL' && (
                <div className="row gap">
                  <Button variant="danger" onClick={() => setShowReject(!showReject)}>Reject…</Button>
                  <Button onClick={approve} busy={action.busy}>Approve run</Button>
                </div>
              )}
            </div>
            <Alert error={action.error} success={action.success} onClose={action.clear} />
            {showReject && (
              <div className="row gap align-end">
                <Field label="Rejection reason"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Apple report needs correction" /></Field>
                <Button variant="danger" onClick={reject} busy={action.busy} disabled={!reason.trim()}>Confirm reject</Button>
              </div>
            )}
            <RunBreakdown data={r} renderPayAction={r.status === 'APPROVED' ? (c) => (c.paymentStatus === 'PENDING'
              ? <Button className="btn btn-primary btn-sm" busy={action.busy} onClick={() => pay(c)}>Mark paid</Button>
              : null) : undefined} />
          </div>
        )}
      </Loader>
    </Modal>
  );
}
