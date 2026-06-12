'use client';

import type { ReactNode } from 'react';
import { useApi } from '../lib/hooks';

/** Split-panel auth layout: live-platform brand panel + form card. */
export function AuthShell({ children, title, subtitle }: { children: ReactNode; title: string; subtitle: string }) {
  const { data: volume } = useApi<{ totalSimulations: number }>('/simulations/volume', { auth: false });
  const { data: matches } = useApi<any[]>('/matches', { auth: false });
  const liveNow = matches?.filter((m) => ['live', 'half_time', 'extra_time', 'penalties'].includes(m.status)).length ?? 0;
  const completed = matches?.filter((m) => m.status === 'completed').length ?? 0;

  return (
    <div className="mx-auto grid min-h-[72vh] max-w-5xl items-stretch gap-6 pt-6 lg:grid-cols-[1.1fr_1fr]">
      <div className="pitch-grid relative hidden flex-col justify-between overflow-hidden rounded-3xl border border-line/60 bg-gradient-to-br from-card via-card to-elevated p-8 lg:flex">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-[11px] font-bold uppercase tracking-widest text-primary">
            ⚽ FIFA 2026 · 48 nations · 104 matches
          </span>
          <h1 className="text-gradient mt-6 text-4xl font-black leading-tight">
            Where data
            <br />
            meets destiny.
          </h1>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-muted">
            A self-driving World Cup engine: clock-run match phases, multi-source verified results, and a prediction
            model that retrains itself after every final whistle.
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <BrandStat value={liveNow > 0 ? `${liveNow} LIVE` : '—'} label="right now" accent={liveNow > 0} />
          <BrandStat value={completed.toString()} label="finals played" />
          <BrandStat value={(volume?.totalSimulations ?? 0).toLocaleString()} label="simulations run" />
        </div>
      </div>

      <div className="glass flex flex-col justify-center rounded-3xl border border-line/70 p-7 sm:p-9">
        <h2 className="text-2xl font-black tracking-tight">{title}</h2>
        <p className="mb-6 mt-1 text-sm text-muted">{subtitle}</p>
        {children}
      </div>
    </div>
  );
}

function BrandStat({ value, label, accent }: { value: string; label: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-line/60 bg-bg/40 px-3 py-2.5">
      <div className={`font-mono text-lg font-bold ${accent ? 'text-danger' : 'text-txt'}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
    </div>
  );
}
