import { useState } from 'react';
import Link from 'next/link';
import { get, post, put } from '../api';
import { Alert, Badge, Button, Card, Field, Loader, Modal, PageHeader, useAction, useApi } from '../components/ui';
import { date, titleCase } from '../format';

const EMPTY = { title: '', isrc: '', album: '', releaseDate: '', identifiers: {}, contributors: {} };

export default function Tracks() {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const tracks = useApi(() => get(`/tracks${search ? `?q=${encodeURIComponent(search)}` : ''}`), [search]);
  const [editing, setEditing] = useState(null); // null | 'new' | track
  const [flash, setFlash] = useState(null);

  return (
    <>
      <PageHeader
        title="Tracks"
        subtitle="Catalogue stored in PostgreSQL (ISRC is unique) and mirrored as Track nodes in Neo4j"
        actions={<Button onClick={() => setEditing('new')}>+ Add track</Button>}
      />
      <Alert success={flash} onClose={() => setFlash(null)} />
      <Card>
        <form className="toolbar" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); }}>
          <input type="search" placeholder="Search by title, ISRC or album…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Button type="submit" variant="secondary">Search</Button>
          {search && <Button variant="ghost" onClick={() => { setQ(''); setSearch(''); }}>Clear</Button>}
        </form>
        <Loader state={tracks}>
          {(rows) => (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr><th>Title</th><th>ISRC</th><th>Album</th><th>Released</th><th>Contributors</th><th>Platform IDs</th><th>Split</th><th /></tr>
                </thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.id}>
                      <td><strong>{t.title}</strong></td>
                      <td><code>{t.isrc}</code></td>
                      <td>{t.album || '—'}</td>
                      <td>{date(t.releaseDate)}</td>
                      <td>{t.contributors.map((c) => `${c.name} (${titleCase(c.role)})`).join(', ') || '—'}</td>
                      <td className="small">{t.identifiers.map((i) => <div key={i.platform}>{i.platformName}: <code>{i.externalId}</code></div>)}</td>
                      <td>
                        {t.activeSplit ? <Badge status="ACTIVE" label={`v${t.activeSplit.versionNo} active`} />
                          : t.hasPendingSplit ? <Badge status="PENDING" label="Awaiting approval" />
                            : <Link href={`/admin/splits?track=${t.id}`} className="small">Create split →</Link>}
                      </td>
                      <td><Button variant="ghost" className="btn btn-ghost btn-sm" onClick={() => setEditing(t)}>Edit</Button></td>
                    </tr>
                  ))}
                  {!rows.length && <tr><td colSpan="8" className="muted">No tracks found.</td></tr>}
                </tbody>
              </table>
            </div>
          )}
        </Loader>
      </Card>
      {editing && (
        <TrackForm
          track={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(t) => { setEditing(null); setFlash(`Saved “${t.title}” (${t.isrc})`); tracks.reload(); }}
        />
      )}
    </>
  );
}

function TrackForm({ track, onClose, onSaved }) {
  const platforms = useApi(() => get('/platforms'));
  const contributors = useApi(() => get('/contributors'));
  const [f, setF] = useState(() => (track ? {
    title: track.title, isrc: track.isrc, album: track.album || '', releaseDate: track.releaseDate || '',
    identifiers: Object.fromEntries(track.identifiers.map((i) => [i.platform, i.externalId])),
    contributors: Object.fromEntries(track.contributors.map((c) => [c.id, c.role])),
  } : EMPTY));
  const action = useAction();
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  const save = async (e) => {
    e.preventDefault();
    const body = {
      title: f.title, isrc: f.isrc, album: f.album, releaseDate: f.releaseDate || null,
      identifiers: Object.entries(f.identifiers).map(([platform, externalId]) => ({ platform, externalId })),
      contributors: Object.entries(f.contributors).map(([contributorId, role]) => ({ contributorId: Number(contributorId), role })),
    };
    const res = await action.run(() => (track ? put(`/tracks/${track.id}`, body) : post('/tracks', body)));
    if (res) onSaved(res);
  };

  return (
    <Modal title={track ? `Edit ${track.title}` : 'Add track'} onClose={onClose}>
      <form onSubmit={save} className="stack">
        <Alert error={action.error} />
        <div className="form-grid">
          <Field label="Title *"><input value={f.title} onChange={(e) => set('title', e.target.value)} required /></Field>
          <Field label="ISRC *" hint="Unique; letters and digits"><input value={f.isrc} onChange={(e) => set('isrc', e.target.value.toUpperCase())} required /></Field>
          <Field label="Album"><input value={f.album} onChange={(e) => set('album', e.target.value)} /></Field>
          <Field label="Release date"><input type="date" value={f.releaseDate} onChange={(e) => set('releaseDate', e.target.value)} /></Field>
        </div>
        <fieldset>
          <legend>Platform identifiers</legend>
          <Loader state={platforms}>
            {(ps) => (
              <div className="form-grid">
                {ps.map((p) => (
                  <Field key={p.code} label={p.name}>
                    <input value={f.identifiers[p.code] || ''} placeholder={`${p.name} track id`}
                      onChange={(e) => set('identifiers', { ...f.identifiers, [p.code]: e.target.value })} />
                  </Field>
                ))}
              </div>
            )}
          </Loader>
        </fieldset>
        <fieldset>
          <legend>Contributors on this track</legend>
          <Loader state={contributors}>
            {(cs) => (
              <div className="check-list">
                {cs.map((c) => {
                  const on = c.id in f.contributors;
                  return (
                    <div key={c.id} className="check-row">
                      <label className="row gap">
                        <input type="checkbox" checked={on} onChange={() => {
                          const next = { ...f.contributors };
                          if (on) delete next[c.id]; else next[c.id] = c.role;
                          set('contributors', next);
                        }} />
                        {c.name}
                      </label>
                      {on && (
                        <select value={f.contributors[c.id]} onChange={(e) => set('contributors', { ...f.contributors, [c.id]: e.target.value })}>
                          {['SINGER', 'PRODUCER', 'SONGWRITER', 'COMPOSER'].map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </Loader>
        </fieldset>
        <div className="row gap end">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" busy={action.busy}>{track ? 'Save changes' : 'Create track'}</Button>
        </div>
      </form>
    </Modal>
  );
}
