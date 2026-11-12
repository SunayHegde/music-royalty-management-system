import { useState } from 'react';
import { get, post } from '../api';
import { Alert, Badge, Button, Card, Empty, Field, Loader, PageHeader, useAction, useApi } from '../components/ui';
import { date, dateTime, inr, month } from '../format';

export default function Advances() {
  const advances = useApi(() => get('/advances'));
  const txns = useApi(() => get('/advances/transactions'));
  const contributors = useApi(() => get('/contributors'));
  const [f, setF] = useState({ contributorId: '', amount: '', description: '', issuedOn: new Date().toISOString().slice(0, 10) });
  const action = useAction();

  const submit = async (e) => {
    e.preventDefault();
    const res = await action.run(() => post('/advances', f), (a) => `Advance of ${inr(a.originalAmount)} recorded for ${a.contributorName}`);
    if (res) { setF({ ...f, amount: '', description: '' }); advances.reload(); txns.reload(); }
  };

  return (
    <>
      <PageHeader title="Advances" subtitle="Recouped from future royalties — never more than the outstanding balance; any remainder carries forward." />
      <div className="grid-2 align-start">
        <Card title="Add advance">
          <form className="stack" onSubmit={submit}>
            <Alert error={action.error} success={action.success} onClose={action.clear} />
            <Loader state={contributors}>
              {(cs) => (
                <Field label="Contributor">
                  <select value={f.contributorId} onChange={(e) => setF({ ...f, contributorId: e.target.value })} required>
                    <option value="">Select…</option>
                    {cs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
              )}
            </Loader>
            <div className="form-grid">
              <Field label="Amount (₹)"><input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} placeholder="2000.00" required pattern="\d+(\.\d{1,2})?" title="Amount with up to 2 decimals" /></Field>
              <Field label="Issued on"><input type="date" value={f.issuedOn} onChange={(e) => setF({ ...f, issuedOn: e.target.value })} required /></Field>
            </div>
            <Field label="Description"><input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} placeholder="Signing advance" /></Field>
            <Button type="submit" busy={action.busy}>Record advance</Button>
          </form>
        </Card>
        <Card title="Advance balances">
          <Loader state={advances}>
            {(rows) => (rows.length === 0 ? <Empty>No advances issued.</Empty> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Contributor</th><th>Issued</th><th className="num">Original</th><th className="num">Recouped</th><th className="num">Outstanding</th></tr></thead>
                  <tbody>
                    {rows.map((a) => (
                      <tr key={a.id}>
                        <td><strong>{a.contributorName}</strong><div className="small muted">{a.description}</div></td>
                        <td>{date(a.issuedOn)}</td>
                        <td className="num">{inr(a.originalAmount)}</td>
                        <td className="num">{inr(a.recoupedAmount)}</td>
                        <td className="num"><strong>{inr(a.outstandingBalance)}</strong></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </Loader>
        </Card>
      </div>
      <Card title="Advance transaction history (append-only)">
        <Loader state={txns}>
          {(rows) => (rows.length === 0 ? <Empty>No transactions yet.</Empty> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>When</th><th>Contributor</th><th>Type</th><th className="num">Amount</th><th className="num">Balance after</th><th>Royalty run</th><th>Note</th></tr></thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.id}>
                      <td>{dateTime(t.createdAt)}</td>
                      <td>{t.contributorName}</td>
                      <td><Badge status={t.type} /></td>
                      <td className="num">{inr(t.amount)}</td>
                      <td className="num">{inr(t.balanceAfter)}</td>
                      <td>{t.royaltyRunId ? `#${t.royaltyRunId} · ${month(t.runMonth)}` : '—'}</td>
                      <td className="small">{t.note}</td>
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
