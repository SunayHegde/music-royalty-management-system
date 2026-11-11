import { useMemo, useState } from 'react';
import { inr, month as fmtMonth, num, pct } from '../format';

// Categorical slots 1-3 of the validated reference palette, fixed per platform (never by rank).
export const PLATFORM_COLORS = { SPOTIFY: '#2a78d6', APPLE_MUSIC: '#eb6834', YOUTUBE_MUSIC: '#1baf7a' };
export const PLATFORM_NAMES = { SPOTIFY: 'Spotify', APPLE_MUSIC: 'Apple Music', YOUTUBE_MUSIC: 'YouTube Music' };

/** Stacked monthly revenue by platform, with per-segment hover tooltip and a legend. */
export function RevenueChart({ rows }) {
  const [hover, setHover] = useState(null);
  const months = useMemo(() => [...new Set(rows.map((r) => r.month))].slice(-6), [rows]);
  const platforms = Object.keys(PLATFORM_COLORS).filter((p) => rows.some((r) => r.platform === p));
  if (!rows.length) return <div className="empty">No streaming revenue imported yet.</div>;

  const totals = months.map((m) => rows.filter((r) => r.month === m).reduce((a, r) => a + Number(r.revenue), 0));
  const max = Math.max(...totals) || 1;
  const niceMax = Math.ceil(max / 5000) * 5000 || 5000;
  const W = 560; const H = 230; const pad = { l: 56, r: 12, t: 12, b: 28 };
  const plotH = H - pad.t - pad.b;
  const slot = (W - pad.l - pad.r) / months.length;
  const barW = Math.min(56, slot * 0.5);
  const y = (v) => pad.t + plotH - (v / niceMax) * plotH;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * niceMax);

  return (
    <div className="chart">
      <div className="legend">
        {platforms.map((p) => (
          <span key={p} className="legend-item"><span className="legend-swatch" style={{ background: PLATFORM_COLORS[p] }} />{PLATFORM_NAMES[p]}</span>
        ))}
      </div>
      <div className="chart-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Monthly revenue by platform">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} className="grid" />
              <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" className="axis">{t >= 1000 ? `₹${t / 1000}k` : `₹${t}`}</text>
            </g>
          ))}
          {months.map((m, i) => {
            const cx = pad.l + slot * i + slot / 2;
            let acc = 0;
            const segs = platforms.map((p) => {
              const r = rows.find((x) => x.month === m && x.platform === p);
              const v = r ? Number(r.revenue) : 0;
              const seg = { p, r, y0: acc, y1: acc + v };
              acc += v;
              return seg;
            }).filter((s) => s.r);
            return (
              <g key={m}>
                {segs.map((s, j) => {
                  const top = y(s.y1); const bottom = y(s.y0);
                  const h = Math.max(0, bottom - top - (j > 0 ? 2 : 0)); // 2px surface gap between stacked fills
                  const isTop = j === segs.length - 1;
                  return (
                    <path
                      key={s.p}
                      d={roundedTopRect(cx - barW / 2, top, barW, h, isTop ? 4 : 0)}
                      fill={PLATFORM_COLORS[s.p]}
                      opacity={hover && (hover.m !== m || hover.p !== s.p) ? 0.55 : 1}
                      onMouseEnter={() => setHover({ m, p: s.p, r: s.r, x: cx, y: top })}
                      onMouseLeave={() => setHover(null)}
                    />
                  );
                })}
                <text x={cx} y={H - 8} textAnchor="middle" className="axis">{fmtMonth(m)}</text>
              </g>
            );
          })}
        </svg>
        {hover && (
          <div className="tooltip" style={{ left: `${(hover.x / W) * 100}%`, top: `${(hover.y / H) * 100}%` }}>
            <div className="tooltip-title">{PLATFORM_NAMES[hover.p]} · {fmtMonth(hover.m)}</div>
            <div>{inr(hover.r.revenue)}</div>
            <div className="muted">{num(hover.r.streams)} streams</div>
          </div>
        )}
      </div>
    </div>
  );
}

function roundedTopRect(x, yTop, w, h, r) {
  if (h <= 0) return '';
  const rr = Math.min(r, h, w / 2);
  return `M${x},${yTop + h} V${yTop + rr} Q${x},${yTop} ${x + rr},${yTop} H${x + w - rr} Q${x + w},${yTop} ${x + w},${yTop + rr} V${yTop + h} Z`;
}

/** Simple directed graph of SAMPLES relationships (nodes on a circle). */
export function SamplingGraph({ nodes, relationships }) {
  const [hover, setHover] = useState(null);
  if (!nodes.length) return <div className="empty">No tracks in the graph yet.</div>;
  const W = 560; const H = 340; const R = Math.min(W, H) / 2 - 60;
  const pos = new Map(nodes.map((n, i) => {
    const a = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
    return [n.id, { x: W / 2 + R * Math.cos(a), y: H / 2 + R * Math.sin(a) }];
  }));
  const linked = new Set(relationships.flatMap((r) => [r.sourceId, r.sampledId]));
  return (
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Sampling relationship graph">
        <defs>
          <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" className="graph-arrow" />
          </marker>
        </defs>
        {relationships.map((r) => {
          const a = pos.get(r.sourceId); const b = pos.get(r.sampledId);
          if (!a || !b) return null;
          const dx = b.x - a.x; const dy = b.y - a.y; const len = Math.hypot(dx, dy) || 1;
          const off = 30;
          const x1 = a.x + (dx / len) * off; const y1 = a.y + (dy / len) * off;
          const x2 = b.x - (dx / len) * off; const y2 = b.y - (dy / len) * off;
          const key = `${r.sourceId}-${r.sampledId}`;
          return (
            <g key={key} onMouseEnter={() => setHover(key)} onMouseLeave={() => setHover(null)}>
              <line x1={x1} y1={y1} x2={x2} y2={y2} className={`graph-edge ${hover === key ? 'hot' : ''}`} markerEnd="url(#arrow)" />
              <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth="16" />
              <rect x={(x1 + x2) / 2 - 24} y={(y1 + y2) / 2 - 11} width="48" height="22" rx="11" className="graph-pill" />
              <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 + 4} textAnchor="middle" className="graph-pill-text">{pct(r.percentageBp)}</text>
            </g>
          );
        })}
        {nodes.map((n) => {
          const p = pos.get(n.id);
          return (
            <g key={n.id}>
              <circle cx={p.x} cy={p.y} r="24" className={`graph-node ${linked.has(n.id) ? 'linked' : ''}`} />
              <text x={p.x} y={p.y + 4} textAnchor="middle" className="graph-node-isrc">{n.isrc}</text>
              <text x={p.x} y={p.y + 42} textAnchor="middle" className="graph-label">{n.title}</text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
