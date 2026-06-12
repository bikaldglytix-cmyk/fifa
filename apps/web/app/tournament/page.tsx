'use client';

import { useMemo, useState } from 'react';
import { STAGE_LABELS } from '@fifa/shared';
import { fmtPct, useApi } from '../../lib/hooks';
import { Badge, Card, Flag, Tabs } from '../../components/ui';
import { Skeleton, SkeletonCard } from '../../components/intel';

export default function TournamentPage() {
  const [tab, setTab] = useState<'groups' | 'bracket' | 'power' | 'qualification'>('groups');
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Tournament</h1>
        <div className="w-full max-w-xl">
          <Tabs
            tabs={[
              { id: 'groups', label: 'Groups' },
              { id: 'bracket', label: 'Bracket' },
              { id: 'power', label: 'Power Rankings' },
              { id: 'qualification', label: 'Projections' },
            ]}
            active={tab}
            onChange={(t) => setTab(t as never)}
          />
        </div>
      </div>
      {tab === 'groups' && <Groups />}
      {tab === 'bracket' && <Bracket />}
      {tab === 'power' && <PowerRankings />}
      {tab === 'qualification' && <Qualification />}
    </div>
  );
}

/** Power rankings: Elo + live tournament forecast + form, recomputed by the model service. */
function PowerRankings() {
  const { data } = useApi<any[]>('/tournament/power-rankings', {
    auth: false,
    refreshOn: ['PREDICTIONS_UPDATED', 'STANDINGS_UPDATED'],
  });
  const { data: countries } = useApi<any[]>('/countries', { auth: false });
  if (!data) return <div className="grid gap-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div>;
  const nameOf = (code: string) => countries?.find((c) => c.code === code)?.name ?? code;

  return (
    <Card>
      <div className="grid gap-1">
        {data.map((t) => (
          <div key={t.team} className="flex items-center gap-3 rounded-lg px-3 py-1.5 transition hover:bg-elevated">
            <span className="w-7 text-right font-mono text-sm font-bold text-muted">{t.rank}</span>
            <span className={`w-3 text-xs ${t.delta === 'up' ? 'text-success' : t.delta === 'down' ? 'text-danger' : 'text-muted'}`}>
              {t.delta === 'up' ? 'Up' : t.delta === 'down' ? 'Down' : '–'}
            </span>
            <Flag code={t.team} size={22} />
            <span className="min-w-28 font-medium">{nameOf(t.team)}</span>
            <div className="hidden h-2 flex-1 overflow-hidden rounded-full bg-elevated sm:block">
              <div className="prob-seg h-full rounded-full bg-gradient-to-r from-primary/60 to-primary" style={{ width: `${t.score}%` }} />
            </div>
            <span className="w-12 text-right font-mono text-sm font-bold">{t.score}</span>
            <span className="hidden w-32 text-right font-mono text-[10px] text-muted md:block">
              Elo {t.elo} · Win {fmtPct(t.champion, 1)}
            </span>
            <span className="hidden w-14 text-right font-mono text-[10px] text-muted lg:block">{t.form}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-center text-[10px] text-muted">
        55% Elo · 25% championship probability · 10% semi-final reach · 10% form — recomputed automatically after every verified result.
      </p>
    </Card>
  );
}

/** Qualification & progression probabilities from the system Monte Carlo forecast. */
function Qualification() {
  const { data } = useApi<{ computedAt: string | null; runs: number | null; teams: any[] }>('/tournament/qualification', {
    auth: false,
    refreshOn: ['PREDICTIONS_UPDATED', 'STANDINGS_UPDATED'],
  });
  const { data: countries } = useApi<any[]>('/countries', { auth: false });
  const [sortBy, setSortBy] = useState<'champion' | 'reachFinal' | 'reachSF' | 'reachQF' | 'reachR16'>('champion');

  const rows = useMemo(() => {
    if (!data?.teams) return [];
    return [...data.teams].sort((a, b) => (b[sortBy] ?? 0) - (a[sortBy] ?? 0));
  }, [data, sortBy]);

  if (!data) return <div className="grid gap-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10" />)}</div>;
  if (!data.teams.length) {
    return <Card><p className="py-8 text-center text-sm text-muted">The system forecast is being computed — projections appear automatically.</p></Card>;
  }
  const nameOf = (code: string) => countries?.find((c) => c.code === code)?.name ?? code;
  const cols: Array<{ id: typeof sortBy; label: string }> = [
    { id: 'reachR16', label: 'R16' },
    { id: 'reachQF', label: 'QF' },
    { id: 'reachSF', label: 'SF' },
    { id: 'reachFinal', label: 'Final' },
    { id: 'champion', label: 'Win' },
  ];

  return (
    <Card
      title={`Knockout projections — ${data.runs?.toLocaleString()} simulated tournaments`}
      action={<Badge color="muted">{data.computedAt ? `as of ${new Date(data.computedAt).toLocaleTimeString()}` : ''}</Badge>}
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase text-muted">
              <th className="pb-2 font-medium">Team</th>
              {cols.map((c) => (
                <th key={c.id} className="w-16 pb-2 text-right font-medium">
                  <button onClick={() => setSortBy(c.id)} className={sortBy === c.id ? 'text-primary' : 'hover:text-txt'}>
                    {c.label}{sortBy === c.id ? ' ↓' : ''}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.team} className="border-t border-line/50">
                <td className="flex items-center gap-2 py-1.5">
                  <Flag code={t.team} size={20} />
                  <span className="truncate">{nameOf(t.team)}</span>
                </td>
                {cols.map((c) => {
                  const v = t[c.id] ?? 0;
                  return (
                    <td key={c.id} className="text-right font-mono text-xs">
                      <span
                        className="inline-block rounded px-1.5 py-0.5"
                        style={{ background: `color-mix(in srgb, var(--color-primary) ${Math.round(Math.min(1, v * (c.id === 'champion' ? 4 : 1.6)) * 60)}%, transparent)` }}
                      >
                        {fmtPct(v, v >= 0.1 ? 0 : 1)}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-center text-[10px] text-muted">
        Probabilities re-simulate automatically after every verified result and model recalibration — no refresh needed.
      </p>
    </Card>
  );
}

function Groups() {
  const { data: standings } = useApi<Record<string, any[]>>('/standings', {
    auth: false,
    refreshOn: ['STANDINGS_UPDATED'],
  });
  const { data: countries } = useApi<any[]>('/countries', { auth: false });
  if (!standings) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => <SkeletonCard key={i} lines={5} />)}
      </div>
    );
  }
  const nameOf = (code: string) => countries?.find((c) => c.code === code)?.name ?? code;

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {Object.entries(standings).map(([letter, rows]) => (
        <Card key={letter} title={`Group ${letter}`}>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase text-muted">
                <th className="pb-1 font-medium">Team</th>
                <th className="w-7 pb-1 text-center font-medium">P</th>
                <th className="w-7 pb-1 text-center font-medium">GD</th>
                <th className="w-8 pb-1 text-center font-medium">Pts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.team} className={`border-t border-line/50 ${r.position <= 2 ? 'text-txt' : r.position === 3 ? 'text-muted' : 'text-muted/60'}`}>
                  <td className="flex items-center gap-2 py-1.5">
                    <span className={`w-4 text-center font-mono text-[10px] ${r.position <= 2 ? 'text-success' : ''}`}>{r.position}</span>
                    <Flag code={r.team} size={20} />
                    <span className="truncate">{nameOf(r.team)}</span>
                  </td>
                  <td className="text-center font-mono text-xs">{r.played}</td>
                  <td className="text-center font-mono text-xs">{r.goalDifference > 0 ? `+${r.goalDifference}` : r.goalDifference}</td>
                  <td className="text-center font-mono font-bold">{r.points}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  );
}

function Bracket() {
  const { data: bracket } = useApi<any[]>('/bracket', { auth: false });
  if (!bracket) {
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {Array.from({ length: 10 }).map((_, i) => <SkeletonCard key={i} lines={2} />)}
      </div>
    );
  }

  const stages: Array<{ id: string; label: string }> = [
    { id: 'round32', label: STAGE_LABELS.round32 },
    { id: 'round16', label: STAGE_LABELS.round16 },
    { id: 'quarterfinal', label: STAGE_LABELS.quarterfinal },
    { id: 'semifinal', label: STAGE_LABELS.semifinal },
    { id: 'final', label: 'Final & Bronze' },
  ];

  const slotLabel = (s: any): string => {
    if (typeof s === 'string') return s;
    if (!s) return 'TBD';
    switch (s.type) {
      case 'groupWinner': return `1${s.group}`;
      case 'groupRunnerUp': return `2${s.group}`;
      case 'thirdPlace': return `3rd ${s.allowedGroups.join('/')}`;
      case 'matchWinner': return `W${s.match}`;
      case 'matchLoser': return `L${s.match}`;
      default: return 'TBD';
    }
  };

  return (
    <div className="overflow-x-auto pb-4">
      <div className="flex min-w-[1100px] gap-3">
        {stages.map((stage) => {
          const items = bracket.filter((m) =>
            stage.id === 'final' ? m.stage === 'final' || m.stage === 'third_place' : m.stage === stage.id,
          );
          return (
            <div key={stage.id} className="flex flex-1 flex-col gap-2">
              <h3 className="text-center text-xs font-bold uppercase tracking-wider text-muted">{stage.label}</h3>
              <div className="flex flex-1 flex-col justify-around gap-2">
                {items.map((m) => (
                  <a
                    key={m.matchNumber}
                    href={`/match/${m.matchNumber}`}
                    className={`rounded-lg border p-2 text-xs transition hover:border-primary ${
                      m.stage === 'final' ? 'border-stage-champion/50 bg-stage-champion/5' : 'border-line bg-card'
                    }`}
                  >
                    <div className="mb-1 flex justify-between text-[9px] text-muted">
                      <span>M{m.matchNumber}{m.stage === 'third_place' ? ' · Bronze' : ''}</span>
                      <span>{new Date(m.matchDate).toISOString().slice(5, 10)}</span>
                    </div>
                    {[['home', m.homeScore], ['away', m.awayScore]].map(([side, score]) => {
                      const slot = m[side as 'home' | 'away'];
                      const isCode = typeof slot === 'string';
                      const winner = m.winner && isCode && m.winner === slot;
                      return (
                        <div key={side as string} className={`flex items-center gap-1.5 py-0.5 ${winner ? 'font-bold' : ''}`}>
                          {isCode ? <Flag code={slot} size={16} /> : <span className="inline-block h-3 w-4 rounded-sm bg-elevated" />}
                          <span className={isCode ? '' : 'text-muted'}>{slotLabel(slot)}</span>
                          <span className="ml-auto font-mono">{score ?? ''}</span>
                          {winner && <span className="text-stage-champion">✓</span>}
                        </div>
                      );
                    })}
                  </a>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-center text-xs text-muted">
        Slots fill automatically as real results come in — the round of 32 resolves via FIFA&apos;s official Annex C third-place allocation.
      </p>
    </div>
  );
}
