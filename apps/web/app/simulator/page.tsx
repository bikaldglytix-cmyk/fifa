'use client';

import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { post } from '../../lib/api';
import { useApi, fmtPct } from '../../lib/hooks';
import { useAuth } from '../../lib/auth';
import { Badge, Button, Card, Flag, ProbBar, ProgressBar, Select, Spinner, Stat, Tabs, useToast } from '../../components/ui';
import { PageSkeleton } from '../../components/intel';

export default function SimulatorPage() {
  return (
    <Suspense fallback={<PageSkeleton cards={3} />}>
      <Simulator />
    </Suspense>
  );
}

function Simulator() {
  const params = useSearchParams();
  const [tab, setTab] = useState<'match' | 'tournament'>('match');
  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">⚡ Simulator</h1>
        <div className="w-72">
          <Tabs
            tabs={[
              { id: 'match', label: 'Single Match' },
              { id: 'tournament', label: 'Full Tournament' },
            ]}
            active={tab}
            onChange={(t) => setTab(t as never)}
          />
        </div>
      </div>
      {tab === 'match' ? <MatchSimulator initialMatch={params.get('match')} initialPair={params.get('pair')} /> : <TournamentSimulator />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function MatchSimulator({ initialMatch, initialPair }: { initialMatch: string | null; initialPair: string | null }) {
  const { user } = useAuth();
  const { show, node } = useToast();
  const { data: countries } = useApi<any[]>('/countries', { auth: false });
  const { data: matches } = useApi<any[]>('/matches?stage=group', { auth: false });

  const [mode, setMode] = useState<'fixture' | 'custom'>(initialPair ? 'custom' : 'fixture');
  const [matchNumber, setMatchNumber] = useState<number>(initialMatch ? Number(initialMatch) : 1);
  const [homeCode, setHomeCode] = useState(initialPair ?? 'ARG');
  const [awayCode, setAwayCode] = useState('FRA');
  const [runs, setRuns] = useState(10_000);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);

  const maxRuns = user?.role === 'premium' || user?.role === 'admin' ? 100_000 : user ? 10_000 : 1_000;

  const run = async () => {
    setBusy(true);
    setResult(null);
    try {
      const body =
        mode === 'fixture'
          ? { matchNumber, runs: Math.min(runs, maxRuns) }
          : { homeCode, awayCode, runs: Math.min(runs, maxRuns) };
      setResult(await post<any>('/simulations/match', body, Boolean(user)));
    } catch (e: any) {
      show(e.message ?? 'Simulation failed', 'error');
    } finally {
      setBusy(false);
    }
  };

  const scheduled = useMemo(
    () => matches?.filter((m) => m.homeCode && m.awayCode && m.status !== 'completed') ?? [],
    [matches],
  );

  return (
    <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
      <Card title="Setup">
        <div className="grid gap-3">
          <Tabs
            tabs={[
              { id: 'fixture', label: 'Real fixture' },
              { id: 'custom', label: 'Any pairing' },
            ]}
            active={mode}
            onChange={(m) => setMode(m as never)}
          />
          {mode === 'fixture' ? (
            <Select label="Match" value={matchNumber} onChange={(e) => setMatchNumber(Number(e.target.value))}>
              {scheduled.map((m) => (
                <option key={m.matchNumber} value={m.matchNumber}>
                  M{m.matchNumber} · {m.homeCode} vs {m.awayCode} ({m.localDate})
                </option>
              ))}
            </Select>
          ) : (
            <>
              <Select label="Home" value={homeCode} onChange={(e) => setHomeCode(e.target.value)}>
                {countries?.map((c) => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </Select>
              <Select label="Away" value={awayCode} onChange={(e) => setAwayCode(e.target.value)}>
                {countries?.map((c) => (
                  <option key={c.code} value={c.code}>{c.name}</option>
                ))}
              </Select>
            </>
          )}
          <div>
            <div className="mb-1 flex justify-between text-xs text-muted">
              <span>Simulations</span>
              <span className="font-mono">{runs.toLocaleString()}</span>
            </div>
            <input
              type="range"
              min={100}
              max={maxRuns}
              step={100}
              value={Math.min(runs, maxRuns)}
              onChange={(e) => setRuns(Number(e.target.value))}
              className="w-full accent-[var(--color-primary)]"
            />
            {!user && <p className="mt-1 text-[10px] text-muted">Guests: 1,000 max — register for 10,000, premium for 100,000.</p>}
          </div>
          <Button onClick={run} disabled={busy} size="lg" className="w-full">
            {busy ? 'Running…' : '⚡ SIMULATE'}
          </Button>
        </div>
      </Card>

      <div className="grid gap-4">
        {busy && <Card><Spinner label={`Running ${runs.toLocaleString()} simulations…`} /></Card>}
        {result && <MatchResult result={result} />}
        {!result && !busy && (
          <Card>
            <p className="py-10 text-center text-sm text-muted">
              Pick a fixture (today: Mexico–South Africa at the Azteca) or any hypothetical pairing, then hit simulate.
            </p>
          </Card>
        )}
      </div>
      {node}
    </div>
  );
}

function MatchResult({ result }: { result: any }) {
  const p = result.prediction;
  const s = result.simulated;
  const sample = result.sampleMatch;
  return (
    <>
      <Card
        title={
          <span>
            {result.home} vs {result.away} · {result.runs.toLocaleString()} runs · {result.durationMs}ms
          </span>
        }
        action={<Badge>{p.confidence}% confidence</Badge>}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Monte Carlo outcome</h4>
            <div className="grid gap-2">
              <ProbBar label={result.home} value={s.homeWin} />
              <ProbBar label="DRAW" value={s.draw} color="var(--color-muted)" />
              <ProbBar label={result.away} value={s.awayWin} color="var(--color-info)" />
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Stat label="xG home" value={p.expectedHomeGoals} />
              <Stat label="avg score" value={`${s.avgHomeGoals}–${s.avgAwayGoals}`} />
              <Stat label="xG away" value={p.expectedAwayGoals} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Stat label="BTTS" value={fmtPct(p.bttsProbability)} />
              <Stat label="Over 2.5" value={fmtPct(p.over25Probability)} />
            </div>
          </div>
          <div>
            <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-muted">Most likely scorelines</h4>
            <div className="grid gap-1.5">
              {s.topScorelines.map((x: any) => (
                <div key={x.score} className="flex items-center gap-2">
                  <span className="w-10 font-mono text-sm font-bold">{x.score}</span>
                  <div className="h-2.5 flex-1 overflow-hidden rounded bg-elevated">
                    <div className="h-full bg-primary/70" style={{ width: `${x.probability * 100 * 4}%` }} />
                  </div>
                  <span className="w-12 text-right font-mono text-xs text-muted">{fmtPct(x.probability)}</span>
                </div>
              ))}
            </div>
            <h4 className="mb-2 mt-4 text-xs font-bold uppercase tracking-wide text-muted">Likely scorers</h4>
            <div className="flex flex-wrap gap-1.5">
              {p.likelyScorers.map((sc: any) => (
                <Badge key={sc.playerId} color="muted">
                  {sc.name} <span className="ml-1 text-primary">{fmtPct(sc.probability, 0)}</span>
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <Card title="AI Insights">
        <ul className="grid gap-2">
          {p.insights.map((i: string, idx: number) => (
            <li key={idx} className="flex gap-2 text-sm">
              <span className="text-primary">▸</span>
              {i}
            </li>
          ))}
        </ul>
      </Card>

      <Card title={`Sample match (seed ${result.seed})`}>
        <div className="mb-3 text-center font-mono text-3xl font-black">
          {result.home} {sample.homeScore} – {sample.awayScore} {result.away}
          {sample.wentToPenalties && (
            <span className="ml-2 text-base text-muted">(pens {sample.penalties.home}–{sample.penalties.away})</span>
          )}
        </div>
        <div className="mx-auto grid max-w-lg gap-1">
          {sample.events
            .filter((e: any) => ['goal', 'penalty_goal', 'own_goal', 'red_card', 'second_yellow'].includes(e.type))
            .map((e: any, i: number) => (
              <div key={i} className={`flex items-center gap-2 text-sm ${e.team === result.home ? '' : 'flex-row-reverse text-right'}`}>
                <span className="font-mono text-xs text-muted">{e.minute}&apos;</span>
                <span>
                  {e.type === 'red_card' || e.type === 'second_yellow' ? '🟥' : '⚽'} {e.playerName}
                  {e.type === 'penalty_goal' && <span className="text-muted"> (pen)</span>}
                  {e.type === 'own_goal' && <span className="text-muted"> (og)</span>}
                  {e.assistPlayerName && <span className="text-xs text-muted"> · {e.assistPlayerName}</span>}
                </span>
              </div>
            ))}
        </div>
        <div className="mt-3 grid grid-cols-4 gap-2 border-t border-line pt-3 text-center">
          <Stat label="possession" value={`${sample.stats.home.possession}–${sample.stats.away.possession}`} />
          <Stat label="shots" value={`${sample.stats.home.shots}–${sample.stats.away.shots}`} />
          <Stat label="xG" value={`${sample.stats.home.xG}–${sample.stats.away.xG}`} />
          <Stat label="MOTM" value={sample.manOfTheMatch?.name ?? '—'} mono={false} />
        </div>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------

function TournamentSimulator() {
  const { user } = useAuth();
  const { show, node } = useToast();
  const { data: countries } = useApi<any[]>('/countries', { auth: false });
  const [runs, setRuns] = useState(1000);
  const [job, setJob] = useState<{ jobId: string } | null>(null);
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState<string>('idle');
  const [result, setResult] = useState<any>(null);
  const esRef = useRef<EventSource | null>(null);

  const maxRuns = user?.role === 'premium' || user?.role === 'admin' ? 100_000 : user ? 10_000 : 1_000;

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopWatching = () => {
    esRef.current?.close();
    esRef.current = null;
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
  };

  const start = async () => {
    setResult(null);
    setProgress(0);
    setStatus('starting');
    stopWatching();
    try {
      const j = await post<{ jobId: string }>('/simulations/tournament', { runs: Math.min(runs, maxRuns) }, Boolean(user));
      setJob(j);
      setStatus('running');

      const finish = async (st: { status: string; result?: unknown }) => {
        stopWatching();
        setStatus(st.status);
        if (st.status === 'completed') {
          setProgress(1);
          setResult(st.result ?? (await fetch(`/api/v1/simulations/jobs/${j.jobId}`).then((r) => r.json())).result);
        } else {
          show(st.status === 'failed' ? 'Simulation failed on the server' : 'Simulation job was lost — try again', 'error');
        }
      };

      // SSE for smooth progress; polling below is the always-on safety net
      // (survives proxy buffering or dropped streams).
      const es = new EventSource(`/api/v1/simulations/jobs/${j.jobId}/stream`);
      esRef.current = es;
      es.onmessage = (ev) => {
        const data = JSON.parse(ev.data);
        if (typeof data.progress === 'number') setProgress(data.progress);
        if (data.status && data.status !== 'running') void finish(data);
      };
      es.onerror = () => es.close();

      pollRef.current = setInterval(async () => {
        try {
          const r = await fetch(`/api/v1/simulations/jobs/${j.jobId}`);
          if (r.status === 404) {
            void finish({ status: 'lost' });
            return;
          }
          const st = await r.json();
          if (typeof st.progress === 'number') setProgress(st.progress);
          if (st.status && st.status !== 'running') void finish(st);
        } catch {
          /* transient network hiccup — keep polling */
        }
      }, 1200);
    } catch (e: any) {
      setStatus('idle');
      show(e.message ?? 'Failed to start', 'error');
    }
  };

  useEffect(() => stopWatching, []);

  const nameOf = (code: string) => countries?.find((c) => c.code === code)?.name ?? code;

  return (
    <div className="grid gap-4">
      <Card>
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-56 flex-1">
            <div className="mb-1 flex justify-between text-xs text-muted">
              <span>Tournaments to simulate</span>
              <span className="font-mono">{Math.min(runs, maxRuns).toLocaleString()}</span>
            </div>
            <input
              type="range"
              min={100}
              max={maxRuns}
              step={100}
              value={Math.min(runs, maxRuns)}
              onChange={(e) => setRuns(Number(e.target.value))}
              className="w-full accent-[var(--color-primary)]"
            />
          </div>
          <Button onClick={start} disabled={status === 'running'} size="lg">
            {status === 'running' ? 'Simulating…' : '🏆 RUN MONTE CARLO'}
          </Button>
        </div>
        {status === 'running' && (
          <div className="mt-4">
            <ProgressBar value={progress} />
            <p className="mt-1 text-center font-mono text-xs text-muted">
              {Math.round(progress * 100)}% — playing {Math.min(runs, maxRuns).toLocaleString()} complete World Cups (104 matches each)
            </p>
          </div>
        )}
      </Card>

      {result && (
        <>
          <Card title={`Champion probabilities (${result.runs.toLocaleString()} tournaments, ${(result.durationMs / 1000).toFixed(1)}s)`}>
            <div className="grid gap-1.5">
              {result.stageProbabilities.slice(0, 16).map((sp: any) => (
                <div key={sp.team} className="flex items-center gap-2">
                  <Flag code={sp.team} size={22} />
                  <span className="w-10 text-sm font-bold">{sp.team}</span>
                  <div className="h-4 flex-1 overflow-hidden rounded bg-elevated">
                    <div
                      className="flex h-full items-center rounded bg-gradient-to-r from-primary/80 to-primary px-1"
                      style={{ width: `${Math.max(2, sp.champion * 100 * 3)}%` }}
                    />
                  </div>
                  <span className="w-14 text-right font-mono text-sm font-bold text-secondary">{fmtPct(sp.champion)}</span>
                  <span className="hidden w-40 text-right font-mono text-[10px] text-muted sm:block">
                    R16 {fmtPct(sp.reachR16, 0)} · SF {fmtPct(sp.reachSF, 0)} · F {fmtPct(sp.reachFinal, 0)}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid gap-4 md:grid-cols-3">
            <Card title="Most likely final">
              <div className="flex items-center justify-center gap-4 py-3">
                <Flag code={result.mostLikelyFinal.teams[0]} size={40} />
                <span className="text-xl font-black text-muted">vs</span>
                <Flag code={result.mostLikelyFinal.teams[1]} size={40} />
              </div>
              <p className="text-center text-sm">
                {nameOf(result.mostLikelyFinal.teams[0])} vs {nameOf(result.mostLikelyFinal.teams[1])}
              </p>
              <p className="text-center font-mono text-xs text-muted">{fmtPct(result.mostLikelyFinal.probability)} of runs</p>
            </Card>
            <Card title="Upset watch">
              <div className="py-2 text-center">
                <div className="font-mono text-3xl font-black text-warning">{fmtPct(result.upsetProbability)}</div>
                <p className="mt-1 text-xs text-muted">chance the champion comes from outside the Elo top 8</p>
                {result.surpriseTeam && (
                  <p className="mt-3 text-sm">
                    Surprise package: <Flag code={result.surpriseTeam.team} size={18} className="inline" />{' '}
                    <b>{nameOf(result.surpriseTeam.team)}</b>
                  </p>
                )}
              </div>
            </Card>
            <Card title="Sample run">
              <div className="grid gap-1 py-1 text-sm">
                <div>🏆 <b>{nameOf(result.sampleRun.champion)}</b></div>
                <div>🥈 {nameOf(result.sampleRun.runnerUp)}</div>
                <div>🥉 {nameOf(result.sampleRun.thirdPlace)}</div>
                {result.sampleRun.goldenBoot && (
                  <div className="mt-1 text-xs text-muted">
                    👟 {result.sampleRun.goldenBoot.name} ({result.sampleRun.goldenBoot.team}) — {result.sampleRun.goldenBoot.goals} goals
                  </div>
                )}
              </div>
            </Card>
          </div>

          <Card title="Golden Boot race">
            <div className="grid gap-1.5 sm:grid-cols-2">
              {result.goldenBoot.slice(0, 10).map((g: any) => (
                <div key={g.playerId} className="flex items-center gap-2 text-sm">
                  <Flag code={g.team} size={18} />
                  <span>{g.name}</span>
                  <span className="ml-auto font-mono text-xs text-muted">
                    {g.avgGoals} avg · <span className="text-secondary">{fmtPct(g.topScorerShare, 0)} boot</span>
                  </span>
                </div>
              ))}
            </div>
          </Card>
        </>
      )}
      {node}
    </div>
  );
}
