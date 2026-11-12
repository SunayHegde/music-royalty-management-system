import { useEffect, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { get, post } from '../api';
import SplitVersion from '../components/SplitVersion';
import { Alert, Button, Card, Empty, Field, Loader, PageHeader, useAction, useApi } from '../components/ui';
import { percentToBp, titleCase } from '../format';

export default function Splits() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const setTrack = (id, replace = false) => router[replace ? 'replace' : 'push'](`${pathname}?track=${id}`);
  const tracks = useApi(() => get('/tracks'));
  const trackId = params.get('track') || '';
  const versions = useApi(() => (trackId ? get(`/tracks/${trackId}/splits`) : Promise.resolve([])), [trackId]);

  useEffect(() => {
    if (!trackId && tracks.data?.length) setTrack(tracks.data[0].id, true);
  }, [trackId, tracks.data]); // eslint-disable-line react-hooks/exhaustive-deps

  const track = tracks.data?.find((t) => String(t.id) === trackId);
  const hasPending = versions.data?.some((v) => v.status === 'PENDING_APPROVAL');

  return (
    <>
      <PageHeader title="Split Agreements" subtitle="Versioned splits in basis points (10000 = 100%). A version becomes ACTIVE only after every contributor approves; older versions are kept forever." />
      <Card>
        <Loader state={tracks}>
          {(ts) => (
            <Field label="Track">
              <select value={trackId} onChange={(e) => setTrack(e.target.value)}>
                {ts.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title} ({t.isrc}) {t.activeSplit ? `— v${t.activeSplit.versionNo} active` : t.hasPendingSplit ? '— awaiting approval' : '— no split'}
                  </option>
                ))}
              </select>
            </Field>
          )}
        </Loader>
      </Card>
      {track && (
        <div className="grid-2 align-start">
          <Card title="Version history">
            <Loader state={versions}>
              {(vs) => (vs.length === 0 ? <Empty>No split versions yet for {track.title}.</Empty> : (
                <div className="stack">{vs.map((v) => <SplitVersion key={v.id} version={v} />)}</div>
              ))}
            </Loader>
          </Card>
          <Card title={`Create new version for ${track.title}`}>
            {hasPending
              ? <Empty>A version is still awaiting approval. It must be approved or rejected by the contributors before another version can be created.</Empty>
              : <NewSplitForm track={track} onCreated={() => { versions.reload(); tracks.reload(); }} />}
          </Card>
        </div>
      )}
    </>
  );
}

function NewSplitForm({ track, onCreated }) {
  const contributors = useApi(() => get('/contributors'));
  const now = new Date();
  // first agreement for a track defaults to its release month; later versions default to the current month
  const defaultEffective = () => (!track.activeSplit && track.releaseDate
    ? track.releaseDate.slice(0, 7)
    : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`);
  const [effective, setEffective] = useState(defaultEffective);
  const [notes, setNotes] = useState('');
  const [rows, setRows] = useState(() => (track.contributors.length
    ? track.contributors.map((c) => ({ contributorId: String(c.id), percent: '' }))
    : [{ contributorId: '', percent: '' }]));
  const action = useAction();

  useEffect(() => {
    setRows(track.contributors.length ? track.contributors.map((c) => ({ contributorId: String(c.id), percent: '' })) : [{ contributorId: '', percent: '' }]);
    setEffective(defaultEffective());
    action.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track.id]);

  const bps = rows.map((r) => percentToBp(r.percent));
  const total = bps.reduce((a, b) => a + (Number.isNaN(b) ? 0 : b), 0);
  const invalidRow = rows.some((r, i) => !r.contributorId || Number.isNaN(bps[i]) || bps[i] <= 0);
  const update = (i, k, v) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, [k]: v } : r)));

  const submit = async (e) => {
    e.preventDefault();
    const res = await action.run(
      () => post(`/tracks/${track.id}/splits`, {
        effectiveFrom: effective, notes,
        shares: rows.map((r, i) => ({ contributorId: Number(r.contributorId), shareBp: bps[i] })),
      }),
      (v) => `Version ${v.versionNo} created. Each contributor must now log in and approve their share.`
    );
    if (res) onCreated();
  };

  return (
    <form className="stack" onSubmit={submit}>
      <Alert error={action.error} success={action.success} onClose={action.clear} />
      <div className="form-grid">
        <Field label="Effective from (month)"><input type="month" value={effective} onChange={(e) => setEffective(e.target.value)} required /></Field>
        <Field label="Notes"><input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Original agreement" /></Field>
      </div>
      <Loader state={contributors}>
        {(cs) => (
          <div className="stack-sm">
            {rows.map((r, i) => (
              <div key={i} className="split-row">
                <select value={r.contributorId} onChange={(e) => update(i, 'contributorId', e.target.value)} required aria-label="Contributor">
                  <option value="">Contributor…</option>
                  {cs.map((c) => (
                    <option key={c.id} value={c.id} disabled={rows.some((x, j) => j !== i && x.contributorId === String(c.id))}>
                      {c.name} ({titleCase(c.role)})
                    </option>
                  ))}
                </select>
                <div className="input-suffix">
                  <input inputMode="decimal" value={r.percent} onChange={(e) => update(i, 'percent', e.target.value)} placeholder="0.00" aria-label="Share percent" required />
                  <span>%</span>
                </div>
                <span className="muted small bp">{Number.isNaN(bps[i]) ? '—' : `${bps[i]} bp`}</span>
                <Button variant="ghost" className="btn btn-ghost btn-sm" onClick={() => setRows(rows.filter((_, j) => j !== i))} disabled={rows.length === 1} aria-label="Remove row">✕</Button>
              </div>
            ))}
            <Button variant="secondary" className="btn btn-secondary btn-sm" onClick={() => setRows([...rows, { contributorId: '', percent: '' }])}>+ Add contributor</Button>
          </div>
        )}
      </Loader>
      <div className={`total-bar ${total === 10000 ? 'ok' : 'bad'}`}>
        <span>Total</span>
        <strong>{(total / 100).toFixed(2)}% <span className="small">({total} / 10000 bp)</span></strong>
        <span>{total === 10000 ? '✓ Valid' : total > 10000 ? '✕ Over 100%' : '✕ Must equal 100%'}</span>
      </div>
      <Button type="submit" busy={action.busy} disabled={total !== 10000 || invalidRow}>Create version & request approvals</Button>
    </form>
  );
}
