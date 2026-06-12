'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import type { LiveMatchStateDto } from '@fifa/shared';
import { useApi, useCountdown, useLiveMatch, fmtPct } from '../lib/hooks';
import { useAuth } from '../lib/auth';
import { Badge, Button, Card, Flag, ProbBar, Spinner, Stat } from '../components/ui';
import { ConfidenceMeter, PageSkeleton, PhaseChip, UpsetBadge } from '../components/intel';

const IN_PLAY = ['live', 'half_time', 'extra_time', 'penalties'];

interface MatchRow {
  matchNumber: number;
  stage: string;
  groupLetter: string | null;
  homeCode: string | null;
  awayCode: string | null;
  matchDate: string;
  localDate: string;
  localTime: string;
  venueId: string;
  status: string;
  homeScore: number | null;
  awayScore: number | null;
  live: LiveMatchStateDto | null;
}

export default function HomePage() {
  const { user } = useAuth();
  const { data: matches } = useApi<MatchRow[]>('/matches', {
    auth: false,
    refreshOn: ['MATCH_PHASE', 'STANDINGS_UPDATED', 'LIVE_SCORES_UPDATED'],
  });
  const { data: volume } = useApi<{ totalSimulations: number }>('/simulations/volume', { auth: false });
  const { data: countries } = useApi<any[]>('/countries', { auth: false });
  const { data: power } = useApi<any[]>('/tournament/power-rankings', {
    auth: false,
    refreshOn: ['PREDICTIONS_UPDATED'],
  });
  const { data: myTeam } = useApi<any>(user ? '/fantasy/my-team' : null);

  const marquee = useMemo(() => {
    if (!matches) return null;
    const candidates = matches.filter((m) => m.status !== 'completed' && m.status !== 'cancelled' && m.homeCode && m.awayCode);
    // a match that is in play right now beats the next kickoff
    const live = candidates.filter((m) => IN_PLAY.includes(m.status));
    const pool = live.length ? live : candidates;
    return pool.sort((a, b) => a.matchDate.localeCompare(b.matchDate))[0] ?? null;
  }, [matches]);

  const { data: marqueePrediction } = useApi<any>(
    marquee ? `/simulations/predict/${marquee.matchNumber}` : null,
    { auth: false, refreshOn: ['PREDICTIONS_UPDATED'] },
  );
  const { data: community } = useApi<any>(
    marquee ? `/predictions/community/${marquee.matchNumber}` : null,
    { auth: false },
  );
  const countdown = useCountdown(marquee?.matchDate ?? null);
  // real live feed: instant score/minute updates over the match room socket
  const live = useLiveMatch(marquee?.matchNumber ?? null, marquee?.live ?? null);

  const nameOf = (code: string | null) => countries?.find((c) => c.code === code)?.name ?? code ?? '?';
  const top5 = useMemo(
    () => (countries ? [...countries].sort((a, b) => (a.fifaRanking ?? 999) - (b.fifaRanking ?? 999)).slice(0, 8) : []),
    [countries],
  );

  if (!matches) return <PageSkeleton />;

  const p = marqueePrediction?.prediction;

  return (
    <div className="grid gap-4">
      {/* hero strip */}
      <div className="flex flex-wrap items-end justify-between gap-3 pt-2">
        <div>
          <h1 className="text-gradient text-3xl font-black tracking-tight sm:text-4xl">The 2026 World Cup, simulated.</h1>
          <p className="mt-1 text-sm text-muted">
            48 nations · 104 matches · a prediction engine that retrains itself after every final whistle.
          </p>
        </div>
        {!user && (
          <Link href="/register">
            <Button size="lg">Join free — build your XI</Button>
          </Link>
        )}
      </div>

      {/* marquee match */}
      <Card className="pitch-grid relative overflow-hidden">
        <div className="mb-2 flex items-center justify-between gap-2">
          <Badge color="gold">MARQUEE MATCH</Badge>
          <span className="flex items-center gap-2">
            {p?.upset && <UpsetBadge tier={p.upset.tier} score={p.upset.score} underdog={p.upset.underdog} />}
            {marquee && <PhaseChip phase={marquee.status} />}
            {marquee && !IN_PLAY.includes(marquee.status) && <span className="font-mono text-sm text-primary">{countdown}</span>}
          </span>
        </div>
        {marquee ? (
          <div className="grid gap-6 md:grid-cols-[1fr_280px]">
            <div>
              <div className="flex items-center justify-center gap-6 py-4 sm:gap-10">
                <TeamSide code={marquee.homeCode!} name={nameOf(marquee.homeCode)} />
                <div className="text-center">
                  {marquee.homeScore != null ? (
                    <div>
                      <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted">Actual Score</div>
                      <div className="font-mono text-4xl font-black">{marquee.homeScore}–{marquee.awayScore}</div>
                    </div>
                  ) : live ? (
                    <div>
                      <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-muted">Live Score</div>
                      <div className="font-mono text-4xl font-black">{live.homeScore}–{live.awayScore}</div>
                      <div className="font-mono text-sm font-bold text-danger">
                        {live.finished || marquee.status === 'awaiting_result' ? (
                          <span className="text-warning">FT · verifying</span>
                        ) : (
                          <>
                            <span className="live-dot mr-1 inline-block h-2 w-2 rounded-full bg-danger align-middle" />
                            {live.phase === 'half_time' ? 'HT' : live.minuteLabel ?? 'LIVE'}
                          </>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-3xl font-black text-muted">VS</div>
                  )}
                  <div className="mt-1 text-[11px] uppercase tracking-wide text-muted">
                    {marquee.stage === 'group' ? `Group ${marquee.groupLetter}` : marquee.stage} · M{marquee.matchNumber}
                  </div>
                  <div className="text-[11px] text-muted">
                    {new Date(marquee.matchDate).toLocaleString()} local
                  </div>
                </div>
                <TeamSide code={marquee.awayCode!} name={nameOf(marquee.awayCode)} />
              </div>
              <div className="flex justify-center gap-3">
                <Link href={`/match/${marquee.matchNumber}`}>
                  <Button>Match Center</Button>
                </Link>
                <Link href={`/simulator?match=${marquee.matchNumber}`}>
                  <Button variant="ghost">Simulate Now</Button>
                </Link>
              </div>
            </div>
            <div className="rounded-xl border border-line bg-bg/50 p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-muted">Official AI</span>
                {p && <Badge>{p.confidence}% conf</Badge>}
              </div>
              {p ? (
                <div className="grid gap-2">
                  <ProbBar label={marquee.homeCode!} value={p.homeWin} />
                  <ProbBar label="DRAW" value={p.draw} color="var(--color-muted)" />
                  <ProbBar label={marquee.awayCode!} value={p.awayWin} color="var(--color-info)" />
                  <div className="mt-4 text-center text-[10px] font-bold uppercase tracking-widest text-muted">Predicted Score</div>
                  <div className="text-center font-mono text-xl font-bold">
                    {p.predictedScore.home} – {p.predictedScore.away}
                  </div>
                  <div className="text-center text-[11px] text-muted">
                    most likely score ({fmtPct(p.mostLikelyScore.probability)})
                  </div>
                  {p.explanation && <ConfidenceMeter level={p.explanation.confidenceLevel} value={p.confidence} />}
                </div>
              ) : (
                <Spinner />
              )}
            </div>
          </div>
        ) : (
          <p className="py-6 text-center text-muted">Tournament complete — explore the simulator and final standings.</p>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* my team */}
        <Card title={user ? `Your Team` : 'Fantasy League'}>
          {user && myTeam ? (
            <div>
              <div className="mb-3 flex items-center gap-3">
                <Flag code={myTeam.countryCode} size={36} />
                <div>
                  <div className="font-bold">{myTeam.country?.name}</div>
                  <div className="text-xs text-muted">{myTeam.teamName ?? 'Unnamed XI'} · {myTeam.formation}</div>
                </div>
                <div className="ml-auto text-right">
                  <div className="font-mono text-xl font-bold text-secondary">{myTeam.totalPoints}</div>
                  <div className="text-[10px] uppercase text-muted">points</div>
                </div>
              </div>
              <Link href="/my-team">
                <Button className="w-full" variant="ghost">Manage lineup →</Button>
              </Link>
            </div>
          ) : user ? (
            <div className="py-2 text-center">
              <p className="mb-3 text-sm text-muted">Pick your nation and build your XI before kickoff.</p>
              <Link href="/my-team"><Button>Select Country</Button></Link>
            </div>
          ) : (
            <div className="py-2 text-center">
              <p className="mb-3 text-sm text-muted">Register to manage a nation, predict matches and climb the leaderboard.</p>
              <Link href="/register"><Button>Create free account</Button></Link>
            </div>
          )}
        </Card>

        {/* community intelligence */}
        <Card title="Community Intelligence">
          {community ? (
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Predictions" value={community.totalPredictions} />
              <Stat label="Crowd conf." value={`${community.crowdConfidenceIndex}%`} />
              <Stat label="Top scoreline" value={community.mostPredictedScoreline ?? '—'} />
              <Stat label="Simulations" value={(volume?.totalSimulations ?? 0).toLocaleString()} />
            </div>
          ) : (
            <Spinner />
          )}
        </Card>

        {/* power rankings (live model) */}
        <Card
          title="Power Rankings (live model)"
          action={<Link href="/tournament" className="text-xs text-primary">All 48 →</Link>}
        >
          <div className="grid gap-1.5">
            {(power && power.length ? power.slice(0, 8) : top5.map((c, i) => ({ rank: i + 1, team: c.code, name: c.name, elo: c.eloRating, champion: 0 }))).map((t: any) => (
              <Link key={t.team} href={`/simulator?pair=${t.team}`} className="flex items-center gap-2 rounded-lg px-2 py-1 hover:bg-elevated">
                <span className="w-5 font-mono text-xs text-muted">#{t.rank}</span>
                <Flag code={t.team} size={22} />
                <span className="text-sm">{t.name}</span>
                <span className="ml-auto font-mono text-xs text-muted">
                  {t.champion ? `Win ${fmtPct(t.champion, 1)}` : `Elo ${t.elo}`}
                </span>
              </Link>
            ))}
          </div>
        </Card>
      </div>

      {/* today's matches */}
      <Card title="Match Schedule — next up" action={<Link href="/matches" className="text-xs text-primary">Full schedule →</Link>}>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {matches
            .filter((m) => m.status !== 'completed' && m.homeCode)
            .slice(0, 6)
            .map((m) => (
              <Link key={m.matchNumber} href={`/match/${m.matchNumber}`} className="flex items-center gap-2 rounded-lg border border-line bg-elevated/50 px-3 py-2 hover:border-primary">
                <Flag code={m.homeCode!} size={20} />
                <span className="text-sm font-medium">{m.homeCode}</span>
                <span className="text-xs text-muted">
                  {m.homeScore != null ? (
                    `${m.homeScore}–${m.awayScore}`
                  ) : m.live ? (
                    <b className="font-mono text-danger">{m.live.homeScore}–{m.live.awayScore}</b>
                  ) : (
                    'vs'
                  )}
                </span>
                <span className="text-sm font-medium">{m.awayCode}</span>
                <Flag code={m.awayCode!} size={20} />
                <span className="ml-auto flex items-center gap-1.5">
                  {IN_PLAY.includes(m.status) ? <PhaseChip phase={m.status} /> : (
                    <span className="font-mono text-[11px] text-muted">{new Date(m.matchDate).toLocaleString()}</span>
                  )}
                </span>
              </Link>
            ))}
        </div>
      </Card>
    </div>
  );
}

function TeamSide({ code, name }: { code: string; name: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <Flag code={code} size={64} />
      <div className="text-center">
        <div className="text-lg font-bold">{code}</div>
        <div className="max-w-28 text-xs text-muted">{name}</div>
      </div>
    </div>
  );
}
