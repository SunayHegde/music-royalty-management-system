import { useState } from 'react';
import Link from 'next/link';
import { get, post, put } from '../api';
import { Alert, Button, Card, Field, Loader, Modal, PageHeader, useAction, useApi } from '../components/ui';
import { inr, titleCase } from '../format';

export default function Contributors() {
  const list = useApi(() => get('/contributors'));
  const [editing, setEditing] = useState(null);
  const [flash, setFlash] = useState(null);

  return (
    <>
      <PageHeader title="Contributors" subtitle="Singers, producers, songwriters and composers — optionally linked to a login account"
        actions={<Button onClick={() => setEditing('new')}>+ Add contributor</Button>} />
      <Alert success={flash} onClose={() => setFlash(null)} />
      <Card>
        <Loader state={list}>
          {(rows) => (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Login account</th><th className="num">Tracks</th><th className="num">Outstanding advance</th><th /></tr></thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id}>
                      <td><strong>{c.name}</strong></td>
                      <td>{c.email}</td>
                      <td>{titleCase(c.role)}</td>
                      <td>{c.username ? <code>{c.username}</code> : <span className="muted">not linked</span>}</td>
                      <td className="num">{c.trackCount}</td>
                      <td className="num">{inr(c.outstandingAdvance)}</td>
                      <td className="row gap end">
                        <Link className="btn btn-ghost btn-sm" href={`/statements?contributor=${c.id}`}>Statement</Link>
                        <Button variant="ghost" className="btn btn-ghost btn-sm" onClick={() => setEditing(c)}>Edit</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Loader>
      </Card>
      {editing && (
        <ContributorForm contributor={editing === 'new' ? null : editing} onClose={() => setEditing(null)}
          onSaved={(c) => { setEditing(null); setFlash(`Saved contributor ${c.name}`); list.reload(); }} />
      )}
    </>
  );
}

function ContributorForm({ contributor, onClose, onSaved }) {
  const users = useApi(() => get('/users?role=CONTRIBUTOR&unlinked=true'));
  const [f, setF] = useState({
    name: contributor?.name || '', email: contributor?.email || '', role: contributor?.role || 'SINGER',
    link: 'keep', userId: '', newUsername: '', newPassword: '',
  });
  const action = useAction();
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  const save = async (e) => {
    e.preventDefault();
    const body = { name: f.name, email: f.email, role: f.role };
    if (f.link === 'existing') body.userId = Number(f.userId);
    if (f.link === 'new') { body.newUsername = f.newUsername; body.newPassword = f.newPassword; }
    if (f.link === 'unlink') body.unlinkUser = true;
    const res = await action.run(() => (contributor ? put(`/contributors/${contributor.id}`, body) : post('/contributors', body)));
    if (res) onSaved(res);
  };

  return (
    <Modal title={contributor ? `Edit ${contributor.name}` : 'Add contributor'} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <Alert error={action.error} />
        <div className="form-grid">
          <Field label="Name *"><input value={f.name} onChange={(e) => set('name', e.target.value)} required /></Field>
          <Field label="Email *"><input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} required /></Field>
          <Field label="Role *">
            <select value={f.role} onChange={(e) => set('role', e.target.value)}>
              {['SINGER', 'PRODUCER', 'SONGWRITER', 'COMPOSER'].map((r) => <option key={r} value={r}>{titleCase(r)}</option>)}
            </select>
          </Field>
          <Field label="Login account" hint={contributor?.username ? `Currently linked to “${contributor.username}”` : 'Contributors need a login to approve splits'}>
            <select value={f.link} onChange={(e) => set('link', e.target.value)}>
              <option value="keep">{contributor ? 'Keep as is' : 'No login account'}</option>
              <option value="existing">Link an existing contributor login</option>
              <option value="new">Create a new login</option>
              {contributor?.username && <option value="unlink">Unlink login</option>}
            </select>
          </Field>
        </div>
        {f.link === 'existing' && (
          <Loader state={users}>
            {(us) => (
              <Field label="Unlinked contributor accounts">
                <select value={f.userId} onChange={(e) => set('userId', e.target.value)} required>
                  <option value="">Select account…</option>
                  {us.map((u) => <option key={u.id} value={u.id}>{u.username} — {u.fullName}</option>)}
                </select>
                {!us.length && <span className="field-hint">No unlinked contributor accounts. Create a new login instead.</span>}
              </Field>
            )}
          </Loader>
        )}
        {f.link === 'new' && (
          <div className="form-grid">
            <Field label="Username"><input value={f.newUsername} onChange={(e) => set('newUsername', e.target.value.toLowerCase())} required /></Field>
            <Field label="Password" hint="min 6 characters, stored as a bcrypt hash"><input type="password" value={f.newPassword} onChange={(e) => set('newPassword', e.target.value)} required minLength={6} /></Field>
          </div>
        )}
        <div className="row gap end">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" busy={action.busy}>{contributor ? 'Save changes' : 'Create contributor'}</Button>
        </div>
      </form>
    </Modal>
  );
}
