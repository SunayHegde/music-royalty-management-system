import Link from 'next/link';
import { get } from '../api';
import { RevenueChart } from '../components/charts';
import { Badge, Card, Empty, Loader, PageHeader, Stat, useApi } from '../components/ui';
import { inr, month, num, pct } from '../format';

export default function AdminDashboard() {
  const state = useApi(() => get('/dashboard/admin'));
  return (
    <>
      <PageHeader title="Label Dashboard" subtitle="Catalogue, revenue and approvals at a glance" />
      <Loader state={state}>
        {(d) => (
          <>
            <div className="stats">
              <Stat label="Tracks" value={num(d.counts.tracks)} hint={`${d.counts.samplingLinks} sampling links`} />
              <Stat label="Contributors" value={num(d.counts.contributors)} />
              <Stat label={`Revenue · ${d.latestMonth ? month(d.latestMonth) : 'latest month'}`} value={inr(d.latestMonthRevenue)} hint="matched records only" />
              <Stat label="Pending split approvals" value={num(d.counts.pendingApprovals)} hint={`${d.counts.pendingSplitVersions} version(s) awaiting`} tone={d.counts.pendingApprovals ? 'warn' : undefined} />
              <Stat label="Unmatched report rows" value={num(d.counts.unmatchedRows)} hint={<Link href="/admin/unmatched">Resolve →</Link>} tone={d.counts.unmatchedRows ? 'warn' : undefined} />
              <Stat label="Outstanding advances" value={inr(d.counts.outstandingAdvances)} hint={`${d.counts.runsAwaitingFinance} run(s) awaiting finance`} />
            </div>
            <div className="grid-2">
              <Card title="Monthly streaming revenue by platform">
                <RevenueChart rows={d.monthlyRevenue} />
              </Card>
              <Card title="Split versions awaiting approval" actions={<Link className="btn btn-ghost btn-sm" href="/admin/splits">Manage</Link>}>
                {d.pendingSplits.length === 0 ? <Empty>No split agreements are waiting for approval.</Empty> : (
                  <ul className="list">
                    {d.pendingSplits.map((v) => (
                      <li key={v.id}>
                        <div className="row between">
                          <strong>{v.trackTitle} · v{v.versionNo}</strong>
                          <Badge status={v.status} />
                        </div>
                        <div className="chips">
                          {v.shares.map((s) => (
                            <span key={s.contributorId} className="chip">
                              {s.name} {pct(s.shareBp)} <Badge status={s.approvalStatus} />
                            </span>
                          ))}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
            <Card title="Revenue table">
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Month</th><th>Platform</th><th className="num">Streams</th><th className="num">Revenue</th></tr></thead>
                  <tbody>
                    {d.monthlyRevenue.map((r) => (
                      <tr key={`${r.month}-${r.platform}`}><td>{month(r.month)}</td><td>{r.platform.replace('_', ' ')}</td><td className="num">{num(r.streams)}</td><td className="num">{inr(r.revenue)}</td></tr>
                    ))}
                    {!d.monthlyRevenue.length && <tr><td colSpan="4" className="muted">No data yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </Loader>
    </>
  );
}
