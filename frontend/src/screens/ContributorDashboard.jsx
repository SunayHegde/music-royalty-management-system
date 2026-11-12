import { useState } from 'react';
import Link from 'next/link';
import { get, post } from '../api';
import { useAuth } from '../auth';
import SplitVersion from '../components/SplitVersion';
import { Alert, Badge, Button, Card, Empty, Field, Loader, PageHeader, Stat, useAction, useApi } from '../components/ui';
import { inr, month, pct } from '../format';

export default function ContributorDashboard() {
  const { user } = useAuth();
  const dash = useApi(() => get('/dashboard/contributor'));
  const action = useAction();

  const decide = async (version, decision, comment) => {
    const res = await action.run(
      () => post(`/splits/${version.id}/decision`, { decision, comment }),
      (v) => (decision === 'APPROVED'
        ? `You approved ${v.trackTitle} v${v.versionNo}.${v.status === 'ACTIVE' ? ' All contributors have approved — this version is now ACTIVE.' : ' Waiting for the other contributors.'}`
        : `You rejected ${v.trackTitle} v${v.versionNo}. The label will be notified to prepare a new version.`)
    );
    if (res) dash.reload();
  };

  return (
    <>
      <PageHeader title={`Welcome, ${user.fullName.split(' ')[0]}`} subtitle="Your tracks, split agreements and royalty earnings" />
      <Alert error={action.error} success={action.success} onClose={action.clear} />
      <Loader state={dash}>
        {(d) => {
          const me = d.statement;
          return (
            <>
              <div className="stats">
                <Stat label="Pending approvals" value={d.pendingApprovals.length} tone={d.pendingApprovals.length ? 'warn' : undefined} />
                <Stat label="My tracks" value={d.tracks.length} />
                <Stat label="Net royalties (all runs)" value={inr(me.totals.net)} hint={`Gross ${inr(me.totals.gross)}`} />
                <Stat label="Paid to me" value={inr(me.totals.paid)} tone="good" hint={me.totals.awaitingPayment !== '0.00' ? `${inr(me.totals.awaitingPayment)} awaiting payment` : undefined} />
                <Stat label="Advance outstanding" value={inr(me.totals.outstandingAdvance)} />
              </div>

              <Card title="Agreements awaiting your decision">
                {d.pendingApprovals.length === 0 ? <Empty>Nothing to approve right now.</Empty> : (
                  <div className="stack">
                    {d.pendingApprovals.map((v) => (
                      <SplitVersion key={v.id} version={v} highlightContributorId={user.contributorId}>
                        <DecisionForm version={v} mine={v.shares.find((s) => s.contributorId === user.contributorId)} busy={action.busy} onDecide={decide} />
                      </SplitVersion>
                    ))}
                  </div>
                )}
              </Card>

              <div className="grid-2 align-start">
                <Card title="My tracks">
                  {d.tracks.length === 0 ? <Empty>You are not linked to any tracks yet.</Empty> : (
                    <table>
                      <thead><tr><th>Track</th><th>ISRC</th><th>Active split</th></tr></thead>
                      <tbody>
                        {d.tracks.map((t) => (
                          <tr key={t.id}>
                            <td><strong>{t.title}</strong><div className="small muted">{t.album}</div></td>
                            <td><code>{t.isrc}</code></td>
                            <td>{t.activeSplit ? <Badge status="ACTIVE" label={`v${t.activeSplit.versionNo}`} /> : t.hasPendingSplit ? <Badge status="PENDING" label="Awaiting approval" /> : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Card>
                <Card title="Recent statements" actions={<Link className="btn btn-ghost btn-sm" href="/me/statement">Full statement →</Link>}>
                  {me.runs.length === 0 ? <Empty>No royalty statements yet.</Empty> : (
                    <table>
                      <thead><tr><th>Month</th><th className="num">Gross</th><th className="num">Advance</th><th className="num">Net</th><th>Status</th></tr></thead>
                      <tbody>
                        {me.runs.slice(0, 6).map((r) => (
                          <tr key={r.runId}>
                            <td>{month(r.month)}</td>
                            <td className="num">{inr(r.gross)}</td>
                            <td className="num">{r.advanceDeduction !== '0.00' ? `−${inr(r.advanceDeduction)}` : '—'}</td>
                            <td className="num"><strong>{inr(r.net)}</strong></td>
                            <td>{r.runStatus === 'PENDING_APPROVAL' ? <Badge status="PENDING" label="Provisional" /> : <Badge status={r.paymentStatus} />}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Card>
              </div>

              <Card title="All my agreements (history)">
                {d.agreements.length === 0 ? <Empty>No agreements yet.</Empty> : (
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>Track</th><th>Version</th><th>Effective</th><th className="num">My share</th><th>My decision</th><th>Version status</th></tr></thead>
                      <tbody>
                        {d.agreements.map((v) => {
                          const mine = v.shares.find((s) => s.contributorId === user.contributorId);
                          return (
                            <tr key={v.id}>
                              <td>{v.trackTitle}</td>
                              <td>v{v.versionNo}</td>
                              <td>{month(v.effectiveFrom.slice(0, 7))}</td>
                              <td className="num">{pct(mine.shareBp)}</td>
                              <td><Badge status={mine.approvalStatus} /></td>
                              <td><Badge status={v.status} /></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </>
          );
        }}
      </Loader>
    </>
  );
}

function DecisionForm({ version, mine, busy, onDecide }) {
  const [comment, setComment] = useState('');
  if (!mine || mine.approvalStatus !== 'PENDING') return null;
  return (
    <div className="decision">
      <p>Your allocation: <strong>{pct(mine.shareBp)}</strong> of {version.trackTitle}. You can approve or reject only your own allocation.</p>
      <div className="row gap wrap align-end">
        <Field label="Comment (required to reject)"><input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional for approval" /></Field>
        <Button variant="danger" busy={busy} disabled={!comment.trim()} onClick={() => onDecide(version, 'REJECTED', comment)}>Reject</Button>
        <Button variant="success" busy={busy} onClick={() => onDecide(version, 'APPROVED', comment)}>Approve my share</Button>
      </div>
    </div>
  );
}
