'use client';

import type { ReactNode } from 'react';

/** Shared intelligence UI atoms: phases, confidence, upsets, probability bars. */

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="rounded-xl border border-line bg-card p-4">
      <Skeleton className="mb-3 h-4 w-1/3" />
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`mb-2 h-3 ${i % 2 ? 'w-5/6' : 'w-full'}`} />
      ))}
    </div>
  );
}

/** Full-page loading placeholder: hero bar + card grid (no spinners). */
export function PageSkeleton({ cards = 6 }: { cards?: number }) {
  return (
    <div className="grid gap-4">
      <Skeleton className="h-9 w-2/5" />
      <Skeleton className="h-28 w-full" />
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: cards }).map((_, i) => (
          <SkeletonCard key={i} lines={4} />
        ))}
      </div>
    </div>
  );
}

const PHASE_STYLE: Record<string, { label: string; cls: string; pulse?: boolean }> = {
  scheduled: { label: 'Scheduled', cls: 'bg-elevated text-muted' },
  pre_match: { label: 'Pre-Match', cls: 'bg-info/15 text-info' },
  live: { label: 'LIVE', cls: 'bg-danger/20 text-danger', pulse: true },
  half_time: { label: 'Half Time', cls: 'bg-warning/15 text-warning', pulse: true },
  extra_time: { label: 'Extra Time', cls: 'bg-danger/20 text-danger', pulse: true },
  penalties: { label: 'Penalties', cls: 'bg-danger/25 text-danger', pulse: true },
  awaiting_result: { label: 'FT — confirming', cls: 'bg-warning/15 text-warning' },
  completed: { label: 'FT', cls: 'bg-success/15 text-success' },
  postponed: { label: 'Postponed', cls: 'bg-elevated text-muted' },
  cancelled: { label: 'Cancelled', cls: 'bg-elevated text-muted' },
};

export function PhaseChip({ phase }: { phase: string }) {
  const s = PHASE_STYLE[phase] ?? PHASE_STYLE.scheduled;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold ${s.cls}`}>
      {s.pulse && <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-current" />}
      {s.label}
    </span>
  );
}

/** Tri-segment win/draw/win probability bar. */
export function TriProbBar({
  home, draw, away, homeCode, awayCode, compact = false,
}: { home: number; draw: number; away: number; homeCode: string; awayCode: string; compact?: boolean }) {
  const pct = (x: number) => `${Math.max(2, x * 100)}%`;
  return (
    <div>
      <div className={`flex w-full overflow-hidden rounded-full bg-elevated ${compact ? 'h-2' : 'h-3'}`}>
        <div className="prob-seg h-full bg-primary" style={{ width: pct(home) }} />
        <div className="prob-seg h-full bg-line" style={{ width: pct(draw) }} />
        <div className="prob-seg h-full bg-info" style={{ width: pct(away) }} />
      </div>
      {!compact && (
        <div className="mt-1 flex justify-between font-mono text-[11px] text-muted">
          <span><b className="text-primary">{homeCode}</b> {(home * 100).toFixed(1)}%</span>
          <span>draw {(draw * 100).toFixed(1)}%</span>
          <span>{(away * 100).toFixed(1)}% <b className="text-info">{awayCode}</b></span>
        </div>
      )}
    </div>
  );
}

const CONFIDENCE_STEPS: Array<{ id: string; label: string }> = [
  { id: 'very_low', label: 'Very Low' },
  { id: 'low', label: 'Low' },
  { id: 'moderate', label: 'Moderate' },
  { id: 'high', label: 'High' },
  { id: 'very_high', label: 'Very High' },
];

export function ConfidenceMeter({ level, value }: { level: string; value?: number }) {
  const idx = Math.max(0, CONFIDENCE_STEPS.findIndex((s) => s.id === level));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-muted">
        <span>Prediction confidence</span>
        <span className="font-mono">{value != null ? `${value.toFixed(0)}/100` : CONFIDENCE_STEPS[idx].label}</span>
      </div>
      <div className="flex gap-1">
        {CONFIDENCE_STEPS.map((s, i) => (
          <div
            key={s.id}
            title={s.label}
            className={`h-1.5 flex-1 rounded-full ${i <= idx ? (idx >= 3 ? 'bg-success' : idx >= 2 ? 'bg-primary' : 'bg-warning') : 'bg-elevated'}`}
          />
        ))}
      </div>
      <div className="mt-0.5 text-right text-[11px] font-semibold">{CONFIDENCE_STEPS[idx].label}</div>
    </div>
  );
}

const UPSET_STYLE: Record<string, string> = {
  low: 'bg-elevated text-muted',
  medium: 'bg-warning/15 text-warning',
  high: 'bg-danger/15 text-danger',
  extreme: 'bg-danger/30 text-danger',
};

export function UpsetBadge({ tier, score, underdog }: { tier: string; score?: number; underdog?: string }) {
  if (tier === 'low') return null;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${UPSET_STYLE[tier]}`}>
      UPSET {tier.toUpperCase()}
      {score != null && <span className="font-mono">{Math.round(score)}</span>}
      {underdog && <span className="opacity-80">· {underdog}</span>}
    </span>
  );
}

/** Mirrored tactical axes comparison (home left, away right). */
export function AxesCompare({ home, away, labels }: { home: Record<string, number>; away: Record<string, number>; labels: Record<string, string> }) {
  return (
    <div className="grid gap-1.5">
      {Object.entries(labels).map(([key, label]) => {
        const h = home[key] ?? 0;
        const a = away[key] ?? 0;
        return (
          <div key={key} className="grid grid-cols-[1fr_110px_1fr] items-center gap-2">
            <div className="flex justify-end">
              <div className="h-2 rounded-l-full bg-primary/80" style={{ width: `${h}%` }} />
            </div>
            <div className="text-center text-[10px] uppercase tracking-wide text-muted">
              {label} <span className="font-mono">{Math.round(h)}·{Math.round(a)}</span>
            </div>
            <div className="flex justify-start">
              <div className="h-2 rounded-r-full bg-info/80" style={{ width: `${a}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function FreshnessBar({ team, freshness, label, notes }: { team: string; freshness: number; label: string; notes?: string[] }) {
  const color = freshness >= 88 ? 'var(--color-success)' : freshness >= 72 ? 'var(--color-primary)' : freshness >= 55 ? 'var(--color-warning)' : 'var(--color-danger)';
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <b>{team}</b>
        <span className="font-mono" style={{ color }}>{freshness}/100 · {label}</span>
      </div>
      <div className="h-2.5 w-full overflow-hidden rounded-full bg-elevated">
        <div className="prob-seg h-full rounded-full" style={{ width: `${freshness}%`, background: color }} />
      </div>
      {notes?.length ? <p className="mt-1 text-[11px] text-muted">{notes[0]}</p> : null}
    </div>
  );
}

export function Section({ title, children, action }: { title: ReactNode; children: ReactNode; action?: ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}
