'use client';

import { useState, type ReactNode } from 'react';

/**
 * Dependency-free SVG chart kit, themed via the app's CSS variables
 * (--color-primary, --color-info, --color-secondary, --color-success,
 * --color-danger, --color-line, --color-muted). All charts scale to their
 * container width through viewBox.
 */

export const CHART = {
  primary: 'var(--color-primary)',
  info: 'var(--color-info)',
  gold: 'var(--color-secondary)',
  success: 'var(--color-success)',
  danger: 'var(--color-danger)',
  warning: 'var(--color-warning)',
  line: 'var(--color-line)',
  muted: 'var(--color-muted)',
};

const FONT = 'inherit';

// ---------------------------------------------------------------------------

export interface LinePoint {
  label: string;
  y: number;
}

export interface LineSeries {
  name: string;
  color?: string;
  points: LinePoint[];
  /** draw a soft area fill under the line */
  area?: boolean;
}

/** Multi-series line chart with y gridlines and sparse x labels. */
export function LineChart({
  series,
  height = 220,
  yFmt,
  baseline,
  baselineLabel,
}: {
  series: LineSeries[];
  height?: number;
  yFmt?: (v: number) => string;
  baseline?: number;
  baselineLabel?: string;
}) {
  const W = 600;
  const H = height;
  const PAD = { l: 44, r: 12, t: 14, b: 26 };
  const all = series.flatMap((s) => s.points.map((p) => p.y));
  if (baseline != null) all.push(baseline);
  if (all.length === 0) return <Empty />;
  let min = Math.min(...all);
  let max = Math.max(...all);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const span = max - min;
  min -= span * 0.08;
  max += span * 0.08;

  // tick precision adapts to the range so labels never repeat
  const fmt = yFmt ?? ((v: number) => (max - min >= 4 ? String(Math.round(v)) : v.toFixed(1)));

  const n = Math.max(...series.map((s) => s.points.length));
  const x = (i: number) => PAD.l + (n <= 1 ? 0.5 : i / (n - 1)) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - (v - min) / (max - min)) * (H - PAD.t - PAD.b);

  const ticks = 4;
  const labels = series[0]?.points ?? [];
  const labelEvery = Math.max(1, Math.ceil(labels.length / 8));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
      {Array.from({ length: ticks + 1 }).map((_, i) => {
        const v = min + ((max - min) * i) / ticks;
        return (
          <g key={i}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke={CHART.line} strokeWidth={1} />
            <text x={PAD.l - 6} y={y(v) + 3} textAnchor="end" fontSize={10} fill={CHART.muted} fontFamily={FONT}>
              {fmt(v)}
            </text>
          </g>
        );
      })}
      {baseline != null && (
        <g>
          <line x1={PAD.l} x2={W - PAD.r} y1={y(baseline)} y2={y(baseline)} stroke={CHART.muted} strokeWidth={1} strokeDasharray="4 4" />
          {baselineLabel && (
            <text x={W - PAD.r} y={y(baseline) - 4} textAnchor="end" fontSize={9} fill={CHART.muted} fontFamily={FONT}>
              {baselineLabel}
            </text>
          )}
        </g>
      )}
      {labels.map((p, i) =>
        i % labelEvery === 0 ? (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize={9} fill={CHART.muted} fontFamily={FONT}>
            {p.label}
          </text>
        ) : null,
      )}
      {series.map((s, si) => {
        const color = s.color ?? (si === 0 ? CHART.primary : CHART.info);
        const pts = s.points.map((p, i) => `${x(i)},${y(p.y)}`).join(' ');
        return (
          <g key={s.name}>
            {s.area && s.points.length > 1 && (
              <polygon
                points={`${x(0)},${y(min)} ${pts} ${x(s.points.length - 1)},${y(min)}`}
                fill={color}
                opacity={0.08}
              />
            )}
            <polyline points={pts} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
            {s.points.map((p, i) => (
              <circle key={i} cx={x(i)} cy={y(p.y)} r={2.6} fill={color}>
                <title>{`${s.name} · ${p.label}: ${fmt(p.y)}`}</title>
              </circle>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------

/** Vertical bars with value labels on top. */
export function Bars({
  data,
  height = 200,
  color = CHART.primary,
  yFmt = (v: number) => String(v),
}: {
  data: Array<{ label: string; value: number; color?: string }>;
  height?: number;
  color?: string;
  yFmt?: (v: number) => string;
}) {
  if (data.length === 0) return <Empty />;
  const W = 600;
  const H = height;
  const PAD = { l: 8, r: 8, t: 18, b: 24 };
  const max = Math.max(...data.map((d) => d.value), 1);
  const bw = (W - PAD.l - PAD.r) / data.length;
  const labelEvery = Math.max(1, Math.ceil(data.length / 10));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
      {data.map((d, i) => {
        const h = (d.value / max) * (H - PAD.t - PAD.b);
        const xPos = PAD.l + i * bw;
        return (
          <g key={i}>
            <rect
              x={xPos + bw * 0.14}
              y={H - PAD.b - h}
              width={bw * 0.72}
              height={Math.max(1, h)}
              rx={Math.min(6, bw * 0.2)}
              fill={d.color ?? color}
              opacity={0.9}
            >
              <title>{`${d.label}: ${yFmt(d.value)}`}</title>
            </rect>
            {data.length <= 16 && d.value > 0 && (
              <text x={xPos + bw / 2} y={H - PAD.b - h - 4} textAnchor="middle" fontSize={9} fill={CHART.muted} fontFamily={FONT}>
                {yFmt(d.value)}
              </text>
            )}
            {i % labelEvery === 0 && (
              <text x={xPos + bw / 2} y={H - 8} textAnchor="middle" fontSize={9} fill={CHART.muted} fontFamily={FONT}>
                {d.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------

/** Horizontal labeled bars (divs, not SVG — crisp at any width). */
export function HBars({
  data,
  max,
  fmt = (v: number) => String(v),
  labelWidth = 'w-28',
}: {
  data: Array<{ label: ReactNode; value: number; color?: string; suffix?: ReactNode }>;
  max?: number;
  fmt?: (v: number) => string;
  labelWidth?: string;
}) {
  if (data.length === 0) return <Empty />;
  const m = max ?? Math.max(...data.map((d) => Math.abs(d.value)), 1e-9);
  return (
    <div className="grid gap-1.5">
      {data.map((d, i) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <span className={`${labelWidth} shrink-0 truncate font-medium`}>{d.label}</span>
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-elevated">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.max(1.5, (Math.abs(d.value) / m) * 100)}%`, background: d.color ?? CHART.primary }}
            />
          </div>
          <span className="w-16 shrink-0 text-right font-mono text-[11px] text-muted">{d.suffix ?? fmt(d.value)}</span>
        </div>
      ))}
    </div>
  );
}

/** Diverging horizontal bars for +/- values (Elo movers etc.). */
export function DivergingBars({
  data,
  fmt = (v: number) => `${v > 0 ? '+' : ''}${v}`,
}: {
  data: Array<{ label: ReactNode; value: number }>;
  fmt?: (v: number) => string;
}) {
  if (data.length === 0) return <Empty />;
  const m = Math.max(...data.map((d) => Math.abs(d.value)), 1e-9);
  return (
    <div className="grid gap-1.5">
      {data.map((d, i) => {
        const pct = (Math.abs(d.value) / m) * 50;
        return (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="w-24 shrink-0 truncate font-medium">{d.label}</span>
            <div className="relative h-3 flex-1 overflow-hidden rounded-full bg-elevated">
              <div className="absolute inset-y-0 left-1/2 w-px bg-line" />
              <div
                className="absolute inset-y-0 rounded-full"
                style={
                  d.value >= 0
                    ? { left: '50%', width: `${Math.max(1, pct)}%`, background: CHART.success }
                    : { right: '50%', width: `${Math.max(1, pct)}%`, background: CHART.danger }
                }
              />
            </div>
            <span className={`w-12 shrink-0 text-right font-mono text-[11px] font-semibold ${d.value >= 0 ? 'text-success' : 'text-danger'}`}>
              {fmt(d.value)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Radar / spider chart, one or two overlaid series on 0–100 axes. */
export function Radar({
  axes,
  series,
  size = 230,
}: {
  axes: Array<{ key: string; label: string }>;
  series: Array<{ name: string; color?: string; values: Record<string, number> }>;
  size?: number;
}) {
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - 34;
  const n = axes.length;
  const angle = (i: number) => -Math.PI / 2 + (i * 2 * Math.PI) / n;
  const pt = (i: number, r: number) => [cx + r * Math.cos(angle(i)), cy + r * Math.sin(angle(i))] as const;

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="mx-auto w-full max-w-xs" role="img">
      {[0.25, 0.5, 0.75, 1].map((f) => (
        <polygon
          key={f}
          points={axes.map((_, i) => pt(i, R * f).join(',')).join(' ')}
          fill="none"
          stroke={CHART.line}
          strokeWidth={1}
        />
      ))}
      {axes.map((a, i) => {
        const [lx, ly] = pt(i, R + 16);
        return (
          <g key={a.key}>
            <line x1={cx} y1={cy} x2={pt(i, R)[0]} y2={pt(i, R)[1]} stroke={CHART.line} strokeWidth={1} />
            <text x={lx} y={ly + 3} textAnchor="middle" fontSize={9} fill={CHART.muted} fontFamily={FONT}>
              {a.label}
            </text>
          </g>
        );
      })}
      {series.map((s, si) => {
        const color = s.color ?? (si === 0 ? CHART.primary : CHART.info);
        const pts = axes.map((a, i) => pt(i, (Math.max(0, Math.min(100, s.values[a.key] ?? 0)) / 100) * R).join(',')).join(' ');
        return (
          <g key={s.name}>
            <polygon points={pts} fill={color} opacity={0.14} />
            <polygon points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
            {axes.map((a, i) => {
              const [px, py] = pt(i, (Math.max(0, Math.min(100, s.values[a.key] ?? 0)) / 100) * R);
              return (
                <circle key={a.key} cx={px} cy={py} r={2.5} fill={color}>
                  <title>{`${s.name} · ${a.label}: ${Math.round(s.values[a.key] ?? 0)}`}</title>
                </circle>
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------

/** Donut with center label and a small legend. */
export function Donut({
  segments,
  centerLabel,
  size = 170,
}: {
  segments: Array<{ label: string; value: number; color: string }>;
  centerLabel?: ReactNode;
  size?: number;
}) {
  const total = segments.reduce((a, s) => a + s.value, 0);
  if (total <= 0) return <Empty />;
  const R = size / 2 - 6;
  const r = R * 0.62;
  const cx = size / 2;
  const cy = size / 2;
  let acc = 0;
  const arcs = segments
    .filter((s) => s.value > 0)
    .map((s) => {
      const a0 = (acc / total) * 2 * Math.PI - Math.PI / 2;
      acc += s.value;
      const a1 = (acc / total) * 2 * Math.PI - Math.PI / 2;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a: number, rad: number) => `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`;
      // full-circle edge case
      if (s.value === total) {
        return { ...s, d: `M ${cx} ${cy - R} A ${R} ${R} 0 1 1 ${cx - 0.01} ${cy - R} L ${cx - 0.01} ${cy - r} A ${r} ${r} 0 1 0 ${cx} ${cy - r} Z` };
      }
      return {
        ...s,
        d: `M ${p(a0, R)} A ${R} ${R} 0 ${large} 1 ${p(a1, R)} L ${p(a1, r)} A ${r} ${r} 0 ${large} 0 ${p(a0, r)} Z`,
      };
    });
  return (
    <div className="flex items-center justify-center gap-4">
      <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size }} role="img">
        {arcs.map((a, i) => (
          <path key={i} d={a.d} fill={a.color} opacity={0.9}>
            <title>{`${a.label}: ${a.value} (${((a.value / total) * 100).toFixed(0)}%)`}</title>
          </path>
        ))}
        {centerLabel && (
          <text x={cx} y={cy + 4} textAnchor="middle" fontSize={13} fontWeight={700} fill="currentColor" fontFamily={FONT}>
            {centerLabel}
          </text>
        )}
      </svg>
      <div className="grid gap-1">
        {segments.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[11px]">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />
            <span className="text-muted">{s.label}</span>
            <span className="font-mono font-semibold">{total ? `${((s.value / total) * 100).toFixed(0)}%` : '—'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Scatter plot with axis labels and hover titles. */
export function Scatter({
  points,
  xLabel,
  yLabel,
  height = 230,
}: {
  points: Array<{ x: number; y: number; label: string; color?: string }>;
  xLabel: string;
  yLabel: string;
  height?: number;
}) {
  if (points.length === 0) return <Empty />;
  const W = 600;
  const H = height;
  const PAD = { l: 40, r: 14, t: 12, b: 30 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  let [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  let [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  if (x0 === x1) [x0, x1] = [x0 - 1, x1 + 1];
  if (y0 === y1) [y0, y1] = [y0 - 1, y1 + 1];
  const xpad = (x1 - x0) * 0.06;
  const ypad = (y1 - y0) * 0.1;
  x0 -= xpad; x1 += xpad; y0 -= ypad; y1 += ypad;
  const X = (v: number) => PAD.l + ((v - x0) / (x1 - x0)) * (W - PAD.l - PAD.r);
  const Y = (v: number) => PAD.t + (1 - (v - y0) / (y1 - y0)) * (H - PAD.t - PAD.b);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
      {[0, 0.5, 1].map((f) => {
        const v = y0 + (y1 - y0) * f;
        return (
          <g key={f}>
            <line x1={PAD.l} x2={W - PAD.r} y1={Y(v)} y2={Y(v)} stroke={CHART.line} strokeWidth={1} />
            <text x={PAD.l - 6} y={Y(v) + 3} textAnchor="end" fontSize={9} fill={CHART.muted} fontFamily={FONT}>
              {Math.round(v)}
            </text>
          </g>
        );
      })}
      {[0, 0.5, 1].map((f) => {
        const v = x0 + (x1 - x0) * f;
        return (
          <text key={f} x={X(v)} y={H - 14} textAnchor="middle" fontSize={9} fill={CHART.muted} fontFamily={FONT}>
            {Math.round(v)}
          </text>
        );
      })}
      <text x={(PAD.l + W - PAD.r) / 2} y={H - 2} textAnchor="middle" fontSize={9} fill={CHART.muted} fontFamily={FONT}>
        {xLabel}
      </text>
      <text x={10} y={(PAD.t + H - PAD.b) / 2} textAnchor="middle" fontSize={9} fill={CHART.muted} fontFamily={FONT} transform={`rotate(-90 10 ${(PAD.t + H - PAD.b) / 2})`}>
        {yLabel}
      </text>
      {points.map((p, i) => (
        <circle key={i} cx={X(p.x)} cy={Y(p.y)} r={4} fill={p.color ?? CHART.primary} opacity={0.75} stroke="white" strokeWidth={1}>
          <title>{`${p.label} — ${xLabel} ${p.x}, ${yLabel} ${p.y}`}</title>
        </circle>
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------

/** Probability heat table (rows × numeric columns 0..1). */
export function HeatTable({
  columns,
  rows,
}: {
  columns: Array<{ key: string; label: string }>;
  rows: Array<{ label: ReactNode; values: Record<string, number> }>;
}) {
  if (rows.length === 0) return <Empty />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate" style={{ borderSpacing: '2px' }}>
        <thead>
          <tr>
            <th className="px-2 text-left text-[10px] font-semibold uppercase tracking-wider text-muted" />
            {columns.map((c) => (
              <th key={c.key} className="px-1 pb-1 text-center text-[10px] font-semibold uppercase tracking-wider text-muted">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr key={ri}>
              <td className="whitespace-nowrap pr-2 text-xs font-medium">{r.label}</td>
              {columns.map((c) => {
                const v = Math.max(0, Math.min(1, r.values[c.key] ?? 0));
                return (
                  <td
                    key={c.key}
                    title={`${(v * 100).toFixed(1)}%`}
                    className="rounded-md px-1 py-1 text-center font-mono text-[10px]"
                    style={{
                      background: `color-mix(in srgb, var(--color-primary) ${Math.round(v * 88)}%, var(--color-elevated))`,
                      color: v > 0.45 ? 'white' : 'var(--color-muted)',
                    }}
                  >
                    {v >= 0.995 ? '100' : (v * 100).toFixed(0)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------

/** Mirrored per-match GF/GA bars (for: up in orange, against: down in blue). */
export function MirrorBars({
  data,
  height = 170,
}: {
  data: Array<{ label: string; up: number; down: number; title?: string }>;
  height?: number;
}) {
  if (data.length === 0) return <Empty />;
  const W = 600;
  const H = height;
  const PAD = { l: 8, r: 8, t: 14, b: 22 };
  const mid = PAD.t + (H - PAD.t - PAD.b) / 2;
  const half = (H - PAD.t - PAD.b) / 2 - 4;
  const max = Math.max(...data.flatMap((d) => [d.up, d.down]), 1);
  const bw = (W - PAD.l - PAD.r) / data.length;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
      <line x1={PAD.l} x2={W - PAD.r} y1={mid} y2={mid} stroke={CHART.line} strokeWidth={1} />
      {data.map((d, i) => {
        const xPos = PAD.l + i * bw;
        const hu = (d.up / max) * half;
        const hd = (d.down / max) * half;
        return (
          <g key={i}>
            <rect x={xPos + bw * 0.18} y={mid - hu} width={bw * 0.64} height={Math.max(d.up > 0 ? 2 : 0, hu)} rx={3} fill={CHART.primary} opacity={0.9}>
              <title>{`${d.title ?? d.label} — scored ${d.up}`}</title>
            </rect>
            <rect x={xPos + bw * 0.18} y={mid} width={bw * 0.64} height={Math.max(d.down > 0 ? 2 : 0, hd)} rx={3} fill={CHART.info} opacity={0.9}>
              <title>{`${d.title ?? d.label} — conceded ${d.down}`}</title>
            </rect>
            <text x={xPos + bw / 2} y={H - 6} textAnchor="middle" fontSize={9} fill={CHART.muted} fontFamily={FONT}>
              {d.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------

export function ChartLegend({ items }: { items: Array<{ label: string; color: string }> }) {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}

function Empty() {
  return <p className="py-6 text-center text-xs text-muted">No data yet — charts fill in as real results arrive.</p>;
}

/** Tab-like pill selector used by the analytics page. */
export function PillSelect<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ id: T; label: string }>;
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-full px-3 py-1 text-xs font-medium transition ${
            value === o.id ? 'bg-primary text-white' : 'bg-elevated text-muted hover:text-txt'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Hook kept here so chart-heavy pages can lazily expand sections. */
export function useExpand(initial = false) {
  const [open, setOpen] = useState(initial);
  return { open, toggle: () => setOpen((v) => !v) };
}
