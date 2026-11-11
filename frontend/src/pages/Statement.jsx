import { useSearchParams } from 'react-router-dom';
import { get } from '../api';
import { Badge, Card, Empty, Field, Loader, PageHeader, Stat, useApi } from '../components/ui';
import { dateTime, inr, month, pct, titleCase } from '../format';

/** Contributor-wise royalty statement. `own` = logged-in contributor; otherwise admin/finance pick one. */
export default function Statement({ own = false }) {
  const [params, setParams] = useSearchParams();
  const contributors = useApi(() => (own ? Promise.resolve([]) : get('/contributors')), [own]);
  const selected = own ? 'me' : params.get('contributor') || '';
  const statement = useApi(
    () => (own ? get('/me/statement') : selected ? get(`/statements/${selected}`) : Promise.resolve(null)),
    [own, selected]
  );

  return (
    <>
      <PageHeader title={own ? 'My Royalty Statement' : 'Royalty Statements'} subtitle="Per-month, per-track breakdown with the split version used, advance recoupment and payment status" />
      {!own && (
        <Card>
          <Loader state={contributors}>
            {(cs) => (
              <Field label="Contributor">
                <select value={selected} onChange={(e) => setParams({ contributor: e.target.value })}>
                  <option value="">Select a contributor…</option>
                  {cs.map((c) => <option key={c.id} value={c.id}>{c.name} ({titleCase(c.role)})</option>)}
                </select>
              </Field>
            )}
          </Loader>
        </Card>
      )}
      <Loader state={statement}>
        {(s) => (!s ? <Empty>Choose a contributor to view their statement.</Empty> : (
          <>
            <Card>
              <div className="row between wrap">
                <div>
                  <h2 className="m0">{s.contributor.name}</h2>
                  <div className="muted">{titleCase(s.contributor.role)} · {s.contributor.email}</div>
                </div>
                <Button onClick={() => window.print()} />
              </div>
              <div className="stats">
                <Stat label="Gross royalties" value={inr(s.totals.gross)} />
                <Stat label="Advance recouped" value={inr(s.totals.advanceDeduction)} />
                <Stat label="Net royalties" value={inr(s.totals.net)} />
                <Stat label="Paid" value={inr(s.totals.paid)} tone="good" />
                <Stat label="Approved, awaiting payment" value={inr(s.totals.awaitingPayment)} />
              </div>
            </Card>
            {s.runs.length === 0 ? <Card><Empty>No royalty runs include this contributor yet.</Empty></Card> : s.runs.map((r) => (
              <Card key={r.runId} title={`${month(r.month)} · Run #${r.runId}`}
                actions={<>{r.runStatus === 'PENDING_APPROVAL' ? <Badge status="PENDING" label="Provisional — awaiting finance" /> : <Badge status={r.paymentStatus} />}</>}>
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Track</th><th>Split version</th><th className="num">Track distributable</th><th className="num">Share</th><th className="num">Gross</th><th className="num">Advance deducted</th><th className="num">Net</th></tr></thead>
                    <tbody>
                      {r.lines.map((l) => (
                        <tr key={l.trackId}>
                          <td><strong>{l.title}</strong> <code>{l.isrc}</code></td>
                          <td>v{l.splitVersion}</td>
                          <td className="num">{inr(l.distributable)}</td>
                          <td className="num">{pct(l.shareBp)}</td>
                          <td className="num">{inr(l.gross)}</td>
                          <td className="num">{l.advanceDeduction !== '0.00' ? `−${inr(l.advanceDeduction)}` : '—'}</td>
                          <td className="num">{inr(l.net)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr><th colSpan="4">Total</th><th className="num">{inr(r.gross)}</th><th className="num">{r.advanceDeduction !== '0.00' ? `−${inr(r.advanceDeduction)}` : '—'}</th><th className="num">{inr(r.net)}</th></tr>
                    </tfoot>
                  </table>
                </div>
                {r.paidAt && <p className="small muted">Paid {dateTime(r.paidAt)} · reference <code>{r.paymentReference}</code></p>}
              </Card>
            ))}
            <Card title="Advances">
              {s.advances.length === 0 ? <Empty>No advances.</Empty> : (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>When</th><th>Type</th><th className="num">Amount</th><th className="num">Balance after</th><th>Note</th></tr></thead>
                    <tbody>
                      {s.advanceTransactions.map((t) => (
                        <tr key={t.id}><td>{dateTime(t.createdAt)}</td><td><Badge status={t.type} /></td><td className="num">{inr(t.amount)}</td><td className="num">{inr(t.balanceAfter)}</td><td className="small">{t.note}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </>
        ))}
      </Loader>
    </>
  );
}

const Button = ({ onClick }) => <button type="button" className="btn btn-secondary btn-sm no-print" onClick={onClick}>Print statement</button>;
