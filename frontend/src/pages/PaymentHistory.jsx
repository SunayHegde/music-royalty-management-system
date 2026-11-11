import { get } from '../api';
import { Badge, Card, Empty, Loader, PageHeader, useApi } from '../components/ui';
import { dateTime, inr, month } from '../format';

export default function PaymentHistory() {
  const payments = useApi(() => get('/payments'));
  return (
    <>
      <PageHeader title="Payment History" subtitle="Append-only ledger. Each row is protected by a database trigger against updates and deletes." />
      <Card>
        <Loader state={payments}>
          {(rows) => (rows.length === 0 ? <Empty>No payments recorded yet.</Empty> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Payment</th><th>Paid at</th><th>Run</th><th>Contributor</th><th className="num">Amount</th><th>Method</th><th>Reference</th><th>Idempotency key</th><th>By</th><th>Status</th></tr></thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id}>
                      <td>#{p.id}</td>
                      <td>{dateTime(p.paidAt)}</td>
                      <td>#{p.runId} · {month(p.month)}</td>
                      <td><strong>{p.contributorName}</strong></td>
                      <td className="num">{inr(p.amount)}</td>
                      <td>{p.method.replace('_', ' ').toLowerCase()}</td>
                      <td><code className="small">{p.paymentReference}</code></td>
                      <td><code className="small">{p.idempotencyKey.slice(0, 13)}…</code></td>
                      <td>{p.paidBy}</td>
                      <td><Badge status={p.status} /></td>
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
