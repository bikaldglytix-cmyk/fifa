'use client';

import { use, useEffect, useRef, useState } from 'react';
import { WS_EVENTS, STAGE_LABELS, type LiveTickPayload } from '@fifa/shared';
import { post } from '../../../lib/api';
import { fmtPct, useApi, useCountdown, useLiveMatch, useSocket } from '../../../lib/hooks';
import { useAuth } from '../../../lib/auth';
import { Badge, Button, Card, Flag, ProbBar, Select, Stat, Tabs, useToast } from '../../../components/ui';
import { AxesCompare, ConfidenceMeter, FreshnessBar, PageSkeleton, PhaseChip, SkeletonCard, TriProbBar, UpsetBadge } from '../../../components/intel';

export default function MatchPage({ params }: { params: Promise<{ n: string }> }) {
  const { n } = use(params);
  const matchNumber = Number(n);
  const { data: match } = useApi<any>(`/matches/${matchNumber}`, {
    auth: false,
    refreshOn: ['MATCH_PHASE', 'STANDINGS_UPDATED'],
  });
  const { data: prediction } = useApi<any>(`/simulations/predict/${matchNumber}`, {
    auth: false,
    refreshOn: ['PREDICTIONS_UPDATED'],
  });
  const countdown = useCountdown(match?.matchDate ?? null);
  // real live feed: room-broadcast updates land instantly, seeded by the API row
  const live = useLiveMatch(matchNumber, match?.live ?? null);
  const [tab, setTab] = useState('ai');

  if (!match) return <PageSkeleton cards={3} />;
  const decided = Boolean(match.homeCode && match.awayCode);
  const v2 = prediction?.prediction && !prediction.pending ? prediction.prediction : null;
  const showLive = match.homeScore == null && live != null;

  return (
    <div className="grid gap-4">
      <Card className="bg-gradient-to-br from-card to-elevated">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
          <Badge>{match.stage === 'group' ? `Group ${match.groupLetter}` : STAGE_LABELS[match.stage as keyof typeof STAGE_LABELS]}</Badge>
          <span>Match {match.matchNumber}</span>
          <span>· {match.venue?.name}, {match.venue?.city}</span>
          <span>· {new Date(match.matchDate).toLocaleString()} local</span>
          <span className="ml-auto flex items-center gap-2">
            {v2 && <UpsetBadge tier={v2.upset.tier} score={v2.upset.score} underdog={v2.upset.underdog} />}
            <PhaseChip phase={match.status} />
            {['scheduled', 'pre_match'].includes(match.status) && <span className="font-mono text-primary">{countdown}</span>}
          </span>
        </div>
        <div className="flex items-center justify-center gap-8 py-4">
          <SideBig code={match.homeCode} slot={match.homeSlot} />
          <div className="text-center">
            {match.homeScore != null ? (
              <div>
                <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted">Actual Score</div>
                <div className="font-mono text-4xl font-black">
                  {match.homeScore}–{match.awayScore}
                  {match.homePenalties != null && (
                    <div className="text-sm text-muted">({match.homePenalties}–{match.awayPenalties} pens)</div>
                  )}
                </div>
              </div>
            ) : showLive ? (
              <div>
                <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted">Live Score</div>
                <div className="font-mono text-4xl font-black">{live!.homeScore}–{live!.awayScore}</div>
                {live!.homePenalties != null && (
                  <div className="font-mono text-sm text-muted">({live!.homePenalties}–{live!.awayPenalties} pens)</div>
                )}
                <div className="mt-1 font-mono text-sm font-bold text-danger">
                  {live!.finished || match.status === 'awaiting_result' ? (
                    <span className="text-warning">FT · verifying result</span>
                  ) : (
                    <>
                      <span className="live-dot mr-1 inline-block h-2 w-2 rounded-full bg-danger align-middle" />
                      {live!.phase === 'half_time' ? 'HALF TIME' : live!.minuteLabel ?? 'LIVE'}
                    </>
                  )}
                </div>
              </div>
            ) : (
              <div className="text-3xl font-black text-muted">VS</div>
            )}
          </div>
          <SideBig code={match.awayCode} slot={match.awaySlot} />
        </div>
        {showLive && live!.events.length > 0 && (
          <div className="mx-auto grid max-w-md gap-1 pb-2">
            {[...live!.events].reverse().map((e, i) => (
              <div key={i} className="slide-up flex items-center justify-center gap-2 text-sm">
                <span className="font-mono text-xs text-muted">{e.minuteLabel}</span>
                <span>
                  {e.type === 'own_goal' ? 'Goal (og)' : e.type === 'penalty_goal' ? 'Goal (pen)' : 'Goal'}{' '}
                  <b>{e.player ?? 'Goal'}</b> <span className="text-xs text-muted">({e.teamCode})</span>
                </span>
              </div>
            ))}
            <div className="mt-1 text-center text-[10px] text-muted">
              Live data: FIFA match feed{live!.attendance ? ` · attendance ${live!.attendance.toLocaleString()}` : ''}
            </div>
          </div>
        )}
        {v2 && decided && (
          <div className="mx-auto max-w-xl pb-1">
            <TriProbBar home={v2.homeWin} draw={v2.draw} away={v2.awayWin} homeCode={match.homeCode} awayCode={match.awayCode} />
          </div>
        )}
      </Card>

      <Tabs
        tabs={[
          { id: 'ai', label: 'AI Prediction' },
          { id: 'intel', label: 'Intelligence' },
          { id: 'predict', label: 'Your Prediction' },
          { id: 'community', label: 'Community' },
          { id: 'live', label: 'Live Sim' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'ai' && <AiTab prediction={prediction} match={match} />}
      {tab === 'intel' && (decided ? <IntelTab v2={v2} match={match} /> : <Pending />)}
      {tab === 'predict' && (decided ? <PredictTab match={match} /> : <Pending />)}
      {tab === 'community' && <CommunityTab matchNumber={matchNumber} />}
      {tab === 'live' && (decided ? <LiveTab match={match} /> : <Pending />)}
    </div>
  );
}

/** Match Intelligence panel: explainability, tactics, battles, fitness, psychology, audit. */
function IntelTab({ v2, match }: { v2: any; match: any }) {
  const { data: history } = useApi<any[]>(`/intelligence/match/${match.matchNumber}/history`, { auth: false });
  if (!v2) return <SkeletonCard lines={6} />;
  const ex = v2.explanation;

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title={`Why the favourite is favoured`}>
          <BulletList items={ex.whyFavored} mark="▸" markClass="text-success" />
        </Card>
        <Card title="The underdog's path">
          <BulletList items={ex.whyUnderdogCanWin} mark="▸" markClass="text-warning" />
        </Card>
        <Card title="Biggest risks">
          <BulletList items={ex.biggestRisks} mark="⚠" markClass="text-danger" />
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Key variables (signed impact on expected goals)">
          <div className="grid gap-1.5">
            {ex.keyVariables.map((f: any) => (
              <div key={f.factor} className="flex items-center gap-2 text-sm">
                <span className="w-40 shrink-0 text-xs text-muted">{f.factor}</span>
                <div className="relative h-2.5 flex-1 rounded-full bg-elevated">
                  <div className="absolute left-1/2 top-0 h-full w-px bg-line" />
                  <div
                    className="prob-seg absolute top-0 h-full rounded-full"
                    style={{
                      left: f.impactPct >= 0 ? '50%' : `${50 - Math.min(48, Math.abs(f.impactPct) * 3)}%`,
                      width: `${Math.min(48, Math.abs(f.impactPct) * 3)}%`,
                      background: f.impactPct >= 0 ? 'var(--color-primary)' : 'var(--color-info)',
                    }}
                  />
                </div>
                <span className="w-16 text-right font-mono text-[11px]" style={{ color: f.impactPct >= 0 ? 'var(--color-primary)' : 'var(--color-info)' }}>
                  {f.impactPct >= 0 ? `${match.homeCode} +` : `${match.awayCode} +`}{Math.abs(f.impactPct).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
          <div className="mt-4">
            <ConfidenceMeter level={ex.confidenceLevel} value={v2.confidence} />
          </div>
          <div className="mt-3 text-[11px] text-muted">
            95% bands: {match.homeCode} {(v2.uncertainty.homeWin[0] * 100).toFixed(0)}–{(v2.uncertainty.homeWin[1] * 100).toFixed(0)}% ·
            draw {(v2.uncertainty.draw[0] * 100).toFixed(0)}–{(v2.uncertainty.draw[1] * 100).toFixed(0)}% ·
            {match.awayCode} {(v2.uncertainty.awayWin[0] * 100).toFixed(0)}–{(v2.uncertainty.awayWin[1] * 100).toFixed(0)}%
          </div>
        </Card>

        <Card title="Tactical matchup">
          <div className="mb-2 flex items-center justify-between text-xs">
            <span><b className="text-primary">{match.homeCode}</b> · {v2.tactics.home.style.replace(/_/g, ' ')} ({v2.tactics.home.formation})</span>
            <span>({v2.tactics.away.formation}) {v2.tactics.away.style.replace(/_/g, ' ')} · <b className="text-info">{match.awayCode}</b></span>
          </div>
          <AxesCompare
            home={v2.tactics.home.axes}
            away={v2.tactics.away.axes}
            labels={{
              pressing: 'Pressing', possession: 'Possession', directness: 'Directness',
              counterAttack: 'Counter', setPieces: 'Set pieces', defensiveBlock: 'Block',
            }}
          />
          {v2.tactics.edges.length > 0 && (
            <ul className="mt-3 grid gap-1.5 border-t border-line pt-3 text-sm">
              {v2.tactics.edges.map((e: string, i: number) => (
                <li key={i} className="flex gap-2 text-[13px]"><span className="text-info">▸</span>{e}</li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Key battles">
          <div className="grid gap-3">
            {v2.keyBattles.map((b: any) => (
              <div key={b.zone}>
                <div className="mb-1 text-[10px] uppercase tracking-wider text-muted">{b.zone}</div>
                <div className="flex items-center justify-between gap-2 text-sm">
                  <span className={b.edge === 'home' ? 'font-bold text-primary' : ''}>{b.home.name} <span className="font-mono text-[10px] text-muted">{b.home.rating}</span></span>
                  <span className="text-[10px] text-muted">vs</span>
                  <span className={`text-right ${b.edge === 'away' ? 'font-bold text-info' : ''}`}><span className="font-mono text-[10px] text-muted">{b.away.rating}</span> {b.away.name}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Fitness & travel">
          {v2.fatigue ? (
            <div className="grid gap-4">
              <FreshnessBar team={match.homeCode} freshness={v2.fatigue.home.freshness} label={v2.fatigue.home.label} notes={v2.fatigue.home.notes} />
              <FreshnessBar team={match.awayCode} freshness={v2.fatigue.away.freshness} label={v2.fatigue.away.label} notes={v2.fatigue.away.notes} />
              {v2.conditions && (
                <div className="border-t border-line pt-2 text-[11px] text-muted">
                  <b className="text-txt">{v2.conditions.venueName}</b> · {v2.conditions.city} · alt {v2.conditions.altitudeM}m ·
                  climatological high ~{v2.conditions.avgHighC}°C · humidity ~{v2.conditions.avgHumidityPct}%
                  {v2.conditions.notes.map((n: string, i: number) => <div key={i}>▸ {n}</div>)}
                </div>
              )}
            </div>
          ) : (
            <p className="py-4 text-center text-xs text-muted">Itinerary data activates once the tournament is underway.</p>
          )}
        </Card>

        <Card title="Psychology & narrative">
          {v2.psychology ? (
            <div className="grid gap-3 text-sm">
              {[{ code: match.homeCode, a: v2.psychology.home }, { code: match.awayCode, a: v2.psychology.away }].map(({ code, a }) => (
                <div key={code}>
                  <div className="mb-1 flex flex-wrap items-center gap-1">
                    <b>{code}</b>
                    {a.factorsApplied.map((f: string) => <Badge key={f} color="muted">{f}</Badge>)}
                  </div>
                  {a.notes.slice(0, 2).map((n: string, i: number) => (
                    <p key={i} className="text-[12px] text-muted">▸ {n}</p>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <p className="py-4 text-center text-xs text-muted">No elevated psychological factors detected.</p>
          )}
        </Card>
      </div>

      <Card title="Prediction audit trail (model transparency)">
        {!history?.length ? (
          <p className="py-3 text-center text-xs text-muted">First snapshot pending.</p>
        ) : (
          <div className="grid gap-1">
            {history.map((s) => (
              <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-elevated px-3 py-1.5 text-xs">
                <span className="font-mono text-muted">{new Date(s.computedAt).toLocaleString()}</span>
                <Badge color="muted">v{s.modelVersion}</Badge>
                <Badge color={s.trigger === 'initial' ? 'primary' : s.trigger === 'retraction' ? 'danger' : 'warning'}>{s.trigger}</Badge>
                <span className="ml-auto font-mono">
                  {(s.homeWin * 100).toFixed(1)}% / {(s.draw * 100).toFixed(1)}% / {(s.awayWin * 100).toFixed(1)}%
                </span>
                <span className="font-mono text-muted">→ {s.predictedScore.home}–{s.predictedScore.away}</span>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-[10px] text-muted">
          Data coverage: {ex.dataCoverage.filter((d: any) => d.status === 'measured').length} measured ·{' '}
          {ex.dataCoverage.filter((d: any) => d.status === 'proxy').length} proxy ·{' '}
          {ex.dataCoverage.filter((d: any) => d.status === 'unavailable').length} unavailable (
          {ex.dataCoverage.filter((d: any) => d.status === 'unavailable').map((d: any) => d.factor).join(', ')})
        </p>
      </Card>
    </div>
  );
}

const BulletList = ({ items, mark, markClass }: { items: string[]; mark: string; markClass: string }) => (
  <ul className="grid gap-2 text-sm">
    {items.map((t, i) => (
      <li key={i} className="flex gap-2 text-[13px]"><span className={markClass}>{mark}</span>{t}</li>
    ))}
  </ul>
);

const Pending = () => (
  <Card><p className="py-8 text-center text-sm text-muted">Participants not decided yet — check back once the bracket resolves.</p></Card>
);

function SideBig({ code, slot }: { code: string | null; slot: any }) {
  return (
    <div className="flex flex-col items-center gap-2">
      {code ? <Flag code={code} size={72} /> : <div className="h-14 w-[72px] rounded bg-elevated" />}
      <span className="text-xl font-bold">{code ?? slotText(slot)}</span>
    </div>
  );
}

const slotText = (s: any): string => {
  if (!s) return 'TBD';
  switch (s.type) {
    case 'groupWinner': return `1${s.group}`;
    case 'groupRunnerUp': return `2${s.group}`;
    case 'thirdPlace': return `3rd ${s.allowedGroups?.join('/')}`;
    case 'matchWinner': return `W${s.match}`;
    case 'matchLoser': return `L${s.match}`;
    default: return 'TBD';
  }
};

function AiTab({ prediction, match }: { prediction: any; match: any }) {
  if (!prediction) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <SkeletonCard lines={6} />
        <SkeletonCard lines={6} />
      </div>
    );
  }
  if (prediction.pending) return <Pending />;
  const p = prediction.prediction;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="Outcome probabilities" action={<Badge>{p.confidence}% confidence</Badge>}>
        <div className="grid gap-2">
          <ProbBar label={prediction.home} value={p.homeWin} />
          <ProbBar label="DRAW" value={p.draw} color="var(--color-muted)" />
          <ProbBar label={prediction.away} value={p.awayWin} color="var(--color-info)" />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Stat label="Predicted Score" value={`${p.predictedScore.home}–${p.predictedScore.away}`} />
          <Stat label="xG" value={`${p.expectedHomeGoals}–${p.expectedAwayGoals}`} />
          <Stat label="BTTS" value={fmtPct(p.bttsProbability, 0)} />
        </div>
        <h4 className="mb-2 mt-4 text-xs font-bold uppercase text-muted">Likely scorers</h4>
        <div className="flex flex-wrap gap-1.5">
          {p.likelyScorers.map((s: any) => (
            <Badge key={s.playerId} color="muted">
              {s.name} <span className="ml-1 text-primary">{fmtPct(s.probability, 0)}</span>
            </Badge>
          ))}
        </div>
      </Card>
      <div className="grid content-start gap-4">
        <Card title="AI insights">
          <ul className="grid gap-2 text-sm">
            {p.insights.map((i: string, idx: number) => (
              <li key={idx} className="flex gap-2"><span className="text-primary">▸</span>{i}</li>
            ))}
          </ul>
        </Card>
        <Card title="Score matrix (probability heatmap)">
          <ScoreMatrix matrix={p.scoreMatrix} home={prediction.home} away={prediction.away} />
        </Card>
      </div>
    </div>
  );
}

function ScoreMatrix({ matrix, home, away }: { matrix: number[][]; home: string; away: string }) {
  const max = Math.max(...matrix.flat());
  const N = 6;
  return (
    <div>
      <div className="mb-1 text-center text-[10px] text-muted">{away} goals →</div>
      <div className="grid gap-0.5" style={{ gridTemplateColumns: `auto repeat(${N}, 1fr)` }}>
        <div />
        {Array.from({ length: N }, (_, a) => (
          <div key={a} className="text-center font-mono text-[10px] text-muted">{a}</div>
        ))}
        {Array.from({ length: N }, (_, h) => (
          <Row key={h} h={h} row={matrix[h]} max={max} N={N} />
        ))}
      </div>
      <div className="mt-1 text-[10px] text-muted">↓ {home} goals</div>
    </div>
  );
}

function Row({ h, row, max, N }: { h: number; row: number[]; max: number; N: number }) {
  return (
    <>
      <div className="pr-1 text-right font-mono text-[10px] text-muted">{h}</div>
      {Array.from({ length: N }, (_, a) => {
        const p = row?.[a] ?? 0;
        return (
          <div
            key={a}
            title={`${h}-${a}: ${(p * 100).toFixed(1)}%`}
            className="flex aspect-square items-center justify-center rounded text-[9px] font-mono"
            style={{
              background: `color-mix(in srgb, var(--color-primary) ${Math.round((p / max) * 85)}%, var(--color-elevated))`,
              color: p / max > 0.5 ? '#fff' : 'var(--color-muted)',
            }}
          >
            {(p * 100).toFixed(0)}
          </div>
        );
      })}
    </>
  );
}

function PredictTab({ match }: { match: any }) {
  const { user } = useAuth();
  const { show, node } = useToast();
  const { data: homeSquad } = useApi<any[]>(`/fantasy/squads/${match.homeCode}`, { auth: false });
  const { data: awaySquad } = useApi<any[]>(`/fantasy/squads/${match.awayCode}`, { auth: false });
  const { data: mine, reload } = useApi<any[]>(user ? '/predictions/mine' : null);
  const [home, setHome] = useState(1);
  const [away, setAway] = useState(1);
  const [scorer, setScorer] = useState<number | ''>('');
  const [cleanSheet, setCleanSheet] = useState('');
  const [busy, setBusy] = useState(false);
  const openedAt = useRef(Date.now());

  const existing = mine?.find((p) => p.matchNumber === match.matchNumber);
  const closed = match.status !== 'scheduled' || new Date(match.matchDate).getTime() <= Date.now();

  const submit = async () => {
    setBusy(true);
    try {
      await post('/predictions', {
        matchNumber: match.matchNumber,
        homeScore: home,
        awayScore: away,
        firstGoalscorerId: scorer || undefined,
        cleanSheetTeam: cleanSheet || undefined,
        submissionMs: Date.now() - openedAt.current,
      });
      show('Prediction locked in ✓');
      reload();
    } catch (e: any) {
      show(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!user) return <Card><p className="py-8 text-center text-sm text-muted">Log in to submit predictions and earn leaderboard points.</p></Card>;

  return (
    <Card title={closed ? 'Predictions closed' : `Predict ${match.homeCode} vs ${match.awayCode}`}>
      {existing && (
        <div className="mb-4 rounded-lg bg-primary/10 p-3 text-sm">
          Your current call: <b className="font-mono">{existing.predictedHomeScore}–{existing.predictedAwayScore}</b>
          {existing.isScored && <Badge color="gold">+{existing.pointsAwarded} pts</Badge>}
          {!closed && <span className="ml-2 text-xs text-muted">(you can update until kickoff)</span>}
        </div>
      )}
      {!closed && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex items-end justify-center gap-3">
            <ScoreSpinner label={match.homeCode} value={home} onChange={setHome} />
            <span className="pb-3 text-2xl text-muted">:</span>
            <ScoreSpinner label={match.awayCode} value={away} onChange={setAway} />
          </div>
          <div className="grid gap-3">
            <Select label="First goalscorer (+3 pts)" value={scorer} onChange={(e) => setScorer(Number(e.target.value) || '')}>
              <option value="">No pick</option>
              {[...(homeSquad ?? []), ...(awaySquad ?? [])]
                .filter((p) => p.position !== 'GK')
                .map((p) => (
                  <option key={p.id} value={p.id}>{p.name} ({p.countryCode})</option>
                ))}
            </Select>
            <Select label="Clean sheet call (+2 pts)" value={cleanSheet} onChange={(e) => setCleanSheet(e.target.value)}>
              <option value="">No pick</option>
              <option value={match.homeCode}>{match.homeCode} keeps clean sheet</option>
              <option value={match.awayCode}>{match.awayCode} keeps clean sheet</option>
            </Select>
            <Button onClick={() => void submit()} disabled={busy}>
              {busy ? '…' : existing ? 'Update prediction' : 'Submit prediction'}
            </Button>
          </div>
        </div>
      )}
      {node}
    </Card>
  );
}

function ScoreSpinner({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <div className="text-center">
      <div className="mb-1 text-xs font-bold">{label}</div>
      <div className="flex flex-col items-center gap-1">
        <button onClick={() => onChange(Math.min(15, value + 1))} className="text-muted hover:text-primary">▲</button>
        <div className="w-16 rounded-lg bg-elevated py-2 text-center font-mono text-2xl font-black">{value}</div>
        <button onClick={() => onChange(Math.max(0, value - 1))} className="text-muted hover:text-primary">▼</button>
      </div>
    </div>
  );
}

function CommunityTab({ matchNumber }: { matchNumber: number }) {
  const { data: ci } = useApi<any>(`/predictions/community/${matchNumber}`, { auth: false, refreshMs: 15_000 });
  if (!ci) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        <SkeletonCard lines={5} />
        <SkeletonCard lines={5} />
      </div>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card title="Crowd consensus">
        <div className="grid gap-2">
          <ProbBar label="HOME" value={ci.outcomeSplit.homeWin} />
          <ProbBar label="DRAW" value={ci.outcomeSplit.draw} color="var(--color-muted)" />
          <ProbBar label="AWAY" value={ci.outcomeSplit.awayWin} color="var(--color-info)" />
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Stat label="Predictions" value={ci.totalPredictions} />
          <Stat label="Top scoreline" value={ci.mostPredictedScoreline ?? '—'} />
          <Stat label="Crowd confidence" value={`${ci.crowdConfidenceIndex}%`} />
        </div>
      </Card>
      <Card title="Popular first-scorer picks">
        {ci.popularScorers.length ? (
          <div className="grid gap-2">
            {ci.popularScorers.map((s: any) => (
              <div key={s.playerId} className="flex items-center gap-2 text-sm">
                <span>Goal: {s.name}</span>
                <span className="ml-auto font-mono text-xs text-muted">{s.count} picks</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="py-6 text-center text-sm text-muted">No scorer picks yet — be the first.</p>
        )}
      </Card>
    </div>
  );
}

function LiveTab({ match }: { match: any }) {
  const socket = useSocket();
  const [speed, setSpeed] = useState(4);
  const [running, setRunning] = useState(false);
  const [tick, setTick] = useState<LiveTickPayload | null>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [final, setFinal] = useState<any>(null);

  useEffect(() => {
    if (!socket) return;
    const onTick = (t: LiveTickPayload) => {
      setTick(t);
      if (t.event && ['goal', 'penalty_goal', 'own_goal', 'red_card', 'second_yellow'].includes(t.event.type)) {
        setEvents((e) => [t.event, ...e].slice(0, 30));
      }
    };
    const onDone = (payload: any) => {
      setRunning(false);
      setFinal(payload.result);
    };
    socket.on(WS_EVENTS.LIVE_TICK, onTick);
    socket.on(WS_EVENTS.LIVE_FINISHED, onDone);
    return () => {
      socket.off(WS_EVENTS.LIVE_TICK, onTick);
      socket.off(WS_EVENTS.LIVE_FINISHED, onDone);
    };
  }, [socket]);

  const start = () => {
    if (!socket) return;
    setEvents([]);
    setFinal(null);
    setTick(null);
    setRunning(true);
    socket.emit(WS_EVENTS.START_LIVE_SIM, { matchNumber: match.matchNumber, speed });
  };

  return (
    <div className="grid gap-4">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm text-muted">Watch this fixture play out minute-by-minute (server-simulated broadcast):</span>
          <Select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} className="w-36">
            <option value={2}>2× (slow)</option>
            <option value={4}>4× (normal)</option>
            <option value={10}>10× (fast)</option>
            <option value={30}>30× (instant-ish)</option>
          </Select>
          <Button onClick={start} disabled={running || !socket}>{running ? 'Broadcasting…' : '▶ Kick off'}</Button>
        </div>
      </Card>

      {(tick || final) && (
        <Card>
          <div className="flex items-center justify-center gap-6 py-2">
            <Flag code={match.homeCode} size={40} />
            <div className="text-center">
              <div className="font-mono text-4xl font-black">
                {tick?.homeScore ?? 0}–{tick?.awayScore ?? 0}
              </div>
              <div className="font-mono text-sm text-primary">
                {running ? <>{tick?.minute ?? 0}&apos; <span className="live-dot text-danger">●</span></> : 'FT'}
              </div>
            </div>
            <Flag code={match.awayCode} size={40} />
          </div>
          {tick && (
            <div className="mx-auto mt-2 max-w-md">
              <div className="mb-1 flex justify-between text-[10px] text-muted">
                <span>{match.homeCode} momentum</span>
                <span>{match.awayCode} momentum</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-warning/60">
                <div className="h-full bg-primary transition-all duration-700" style={{ width: `${tick.momentum}%` }} />
              </div>
            </div>
          )}
          <div className="mx-auto mt-4 grid max-w-md gap-1">
            {events.map((e, i) => (
              <div key={i} className="slide-up flex items-center gap-2 text-sm">
                <span className="font-mono text-xs text-muted">{e.minute}&apos;</span>
                <span>
                  {e.type.includes('goal') ? 'Goal' : 'Red Card'} <b>{e.playerName}</b> ({e.team})
                  {e.assistPlayerName && <span className="text-xs text-muted"> assist {e.assistPlayerName}</span>}
                </span>
              </div>
            ))}
          </div>
          {final && (
            <div className="mt-4 border-t border-line pt-3 text-center text-sm text-muted">
              Full time. MOTM: <b className="text-txt">{final.manOfTheMatch?.name}</b> · xG {final.stats.home.xG}–{final.stats.away.xG} · possession{' '}
              {final.stats.home.possession}%–{final.stats.away.possession}%
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
