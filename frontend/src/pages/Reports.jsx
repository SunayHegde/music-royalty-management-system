import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, get } from '../api';
import { Alert, Badge, Button, Card, Empty, Field, Loader, Modal, PageHeader, useAction, useApi } from '../components/ui';
import { dateTime, inr, month, num } from '../format';

export default function Reports() {
  const reports = useApi(() => get('/reports'));
  const platforms = useApi(() => get('/platforms'));
  const [platform, setPlatform] = useState('');
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [viewing, setViewing] = useState(null);
  const fileRef = useRef();
  const action = useAction();

  const upload = async (e) => {
    e.preventDefault();
    setResult(null);
    const form = new FormData();
    form.append('platform', platform);
    form.append('file', file);
    const res = await action.run(() => api('/reports/upload', { method: 'POST', form }));
    if (res) {
      setResult(res);
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      reports.reload();
    }
  };

  return (
    <>
      <PageHeader title="Streaming Report Upload" subtitle="CSV columns: ISRC, track_name, streams, revenue, month. Each original row is stored in MongoDB; matched rows are normalized into PostgreSQL." />
      <div className="grid-2 align-start">
        <Card title="Upload monthly report">
          <form className="stack" onSubmit={upload}>
            <Alert error={action.error} onClose={action.clear} />
            {result && (
              <div className="alert alert-success" role="status">
                <div>
                  <strong>Imported {result.reportKey}</strong>
                  <div>{result.totalRows} rows · {result.matchedRows} matched → PostgreSQL · {result.unmatchedRows} unmatched → MongoDB</div>
                  <div>{num(result.totalStreams)} streams · {inr(result.totalRevenue)}</div>
                  {result.unmatchedRows > 0 && <Link to="/admin/unmatched">Resolve unmatched rows →</Link>}
                </div>
              </div>
            )}
            <Loader state={platforms}>
              {(ps) => (
                <Field label="Platform">
                  <select value={platform} onChange={(e) => setPlatform(e.target.value)} required>
                    <option value="">Select platform…</option>
                    {ps.map((p) => <option key={p.code} value={p.code}>{p.name}</option>)}
                  </select>
                </Field>
              )}
            </Loader>
            <Field label="CSV file" hint="Sample files are in the project's sample-data folder">
              <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={(e) => setFile(e.target.files[0] || null)} required />
            </Field>
            <Button type="submit" busy={action.busy} disabled={!file || !platform}>Upload & process</Button>
            <p className="small muted">Duplicate imports are rejected by report identifier (PLATFORM-YYYY-MM), file hash and per-row source id.</p>
          </form>
        </Card>
        <Card title="Expected format">
          <pre className="code-block">{`ISRC,track_name,streams,revenue,month
IN001,Midnight Drive,6000,6000.00,2026-10
IN002,Summer Nights,3200,2400.00,2026-10`}</pre>
          <ul className="small">
            <li>One file per platform per month.</li>
            <li>Rows with an unknown ISRC are kept in MongoDB <code>unmatched_reports</code> until mapped.</li>
            <li>Malformed rows reject the whole file — nothing partial is imported.</li>
          </ul>
        </Card>
      </div>
      <Card title="Report history">
        <Loader state={reports}>
          {(rows) => (rows.length === 0 ? <Empty>No reports imported yet.</Empty> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Report ID</th><th>Platform</th><th>Month</th><th>File</th><th className="num">Rows</th><th className="num">Matched</th><th className="num">Unmatched</th><th className="num">Streams</th><th className="num">Revenue</th><th>Uploaded</th><th /></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td><code>{r.reportKey}</code></td>
                      <td>{r.platformName}</td>
                      <td>{month(r.month)}</td>
                      <td className="small">{r.fileName}</td>
                      <td className="num">{r.totalRows}</td>
                      <td className="num">{r.matchedRows}</td>
                      <td className="num">{r.unmatchedRows > 0 ? <Badge status="UNMATCHED" label={String(r.unmatchedRows)} /> : 0}</td>
                      <td className="num">{num(r.totalStreams)}</td>
                      <td className="num">{inr(r.totalRevenue)}</td>
                      <td className="small">{dateTime(r.uploadedAt)} · {r.uploadedBy}</td>
                      <td><Button variant="ghost" className="btn btn-ghost btn-sm" onClick={() => setViewing(r)}>Raw rows</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </Loader>
      </Card>
      {viewing && <RawRows report={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

function RawRows({ report, onClose }) {
  const rows = useApi(() => get(`/reports/${report.id}/rows`), [report.id]);
  return (
    <Modal title={`${report.reportKey} — original rows (MongoDB)`} onClose={onClose}>
      <Loader state={rows}>
        {(docs) => (
          <div className="table-wrap">
            <table>
              <thead><tr><th>#</th><th>Source row id</th><th>Original row (as received)</th><th>Status</th></tr></thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.source_row_id}>
                    <td>{d.row_number}</td>
                    <td><code className="small">{d.source_row_id}</code></td>
                    <td><code className="small">{JSON.stringify(d.original_row)}</code></td>
                    <td><Badge status={d.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Loader>
    </Modal>
  );
}
