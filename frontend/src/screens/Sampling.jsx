import { useState } from 'react';
import { del, get, post } from '../api';
import { SamplingGraph } from '../components/charts';
import { Alert, Button, Card, Empty, Field, Loader, PageHeader, useAction, useApi } from '../components/ui';
import { pct, percentToBp } from '../format';

export default function Sampling() {
  const graph = useApi(() => get('/sampling'));
  const tracks = useApi(() => get('/tracks'));
  const [f, setF] = useState({ source: '', sampled: '', percent: '' });
  const action = useAction();
  const bp = percentToBp(f.percent);

  const submit = async (e) => {
    e.preventDefault();
    const res = await action.run(
      () => post('/sampling', { sourceTrackId: Number(f.source), sampledTrackId: Number(f.sampled), percentageBp: bp }),
      'Sampling relationship created in Neo4j'
    );
    if (res) { graph.setData(res); setF({ source: '', sampled: '', percent: '' }); }
  };
  const remove = async (r) => {
    if (!window.confirm(`Remove: ${r.sourceTitle} samples ${r.sampledTitle}?`)) return;
    const res = await action.run(() => del(`/sampling/${r.sourceId}/${r.sampledId}`), 'Relationship removed');
    if (res) graph.setData(res);
  };

  return (
    <>
      <PageHeader title="Sampling Relationships" subtitle="Stored in Neo4j as (Track)-[:SAMPLES {percentageBp}]->(Track). The source track owes the sampled track that share of its revenue (one level, no recursion)." />
      <Alert error={action.error} success={action.success} onClose={action.clear} />
      <div className="grid-2 align-start">
        <Card title="Add relationship">
          <Loader state={tracks}>
            {(ts) => (
              <form className="stack" onSubmit={submit}>
                <Field label="Source track (the one that samples)">
                  <select value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} required>
                    <option value="">Select…</option>
                    {ts.map((t) => <option key={t.id} value={t.id}>{t.title} ({t.isrc})</option>)}
                  </select>
                </Field>
                <Field label="Sampled track (receives the royalty)">
                  <select value={f.sampled} onChange={(e) => setF({ ...f, sampled: e.target.value })} required>
                    <option value="">Select…</option>
                    {ts.map((t) => <option key={t.id} value={t.id} disabled={String(t.id) === f.source}>{t.title} ({t.isrc})</option>)}
                  </select>
                </Field>
                <Field label="Royalty percentage owed" hint={Number.isNaN(bp) ? 'e.g. 10 or 7.5' : `${bp} basis points`}>
                  <div className="input-suffix"><input inputMode="decimal" value={f.percent} onChange={(e) => setF({ ...f, percent: e.target.value })} placeholder="10" required /><span>%</span></div>
                </Field>
                <Button type="submit" busy={action.busy} disabled={Number.isNaN(bp) || bp <= 0}>Create SAMPLES relationship</Button>
                <p className="small muted">Self-sampling and circular chains (A→B→…→A) are rejected.</p>
              </form>
            )}
          </Loader>
        </Card>
        <Card title="Graph">
          <Loader state={graph}>{(g) => <SamplingGraph nodes={g.nodes} relationships={g.relationships} />}</Loader>
        </Card>
      </div>
      <Card title="Relationships">
        <Loader state={graph}>
          {(g) => (g.relationships.length === 0 ? <Empty>No sampling relationships yet.</Empty> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Source track</th><th /><th>Sampled track</th><th className="num">Owes</th><th>Created by</th><th /></tr></thead>
                <tbody>
                  {g.relationships.map((r) => (
                    <tr key={`${r.sourceId}-${r.sampledId}`}>
                      <td><strong>{r.sourceTitle}</strong> <code>{r.sourceIsrc}</code></td>
                      <td className="muted">samples →</td>
                      <td><strong>{r.sampledTitle}</strong> <code>{r.sampledIsrc}</code></td>
                      <td className="num">{pct(r.percentageBp)}</td>
                      <td>{r.createdBy || '—'}</td>
                      <td><Button variant="ghost" className="btn btn-ghost btn-sm" onClick={() => remove(r)}>Remove</Button></td>
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
