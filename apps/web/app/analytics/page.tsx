'use client';

import { useMemo, useState } from 'react';
import { useApi } from '../../lib/hooks';
import { Badge, Card, Flag, Stat, Tabs } from '../../components/ui';
import { PageSkeleton, Section } from '../../components/intel';
import {
  Bars,
  CHART,
  ChartLegend,
  DivergingBars,
  Donut,
  HBars,
  HeatTable,
  LineChart,
  MirrorBars,
  Radar,
  Scatter,
} from '../../components/charts';

const REFRESH = ['STANDINGS_UPDATED', 'PREDICTIONS_UPDATED'];

const POSITION_COLOR: Record<string, string> = {
  GK: CHART.gold,
  DF: CHART.info,
  MF: CHART.success,
  FW: CHART.primary,
};

const AXES_LABELS = [
  { key: 'pressing', label: 'Pressing' },
  { key: 'possession', label: 'Possession' },
  { key: 'directness', label: 'Directness' },
  { key: 'counterAttack', label: 'Counter' },
  { key: 'setPieces', label: 'Set pieces' },
  { key: 'defensiveBlock', label: 'Def. block' },
];

const STAGE_LABEL: Record<string, string> = {
  group: 'Groups',
  round32: 'R32',
  round16: 'R16',
  quarterfinal: 'QF',
  semifinal: 'SF',
  third_place: '3rd place',
  final: 'Final',
};

export default function AnalyticsPage() {
  const [tab, setTab] = useState('overview');
  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-2xl font-bold">Data Analysis</h1>
        <p className="text-sm text-muted">
          Real results, team output, Elo movement and the model&apos;s own forecast — updating live as matches finish.
        </p>
      </div>
      <Tabs
        tabs={[
          { id: 'overview', label: 'Tournament' },
          { id: 'team', label: 'Team analysis' },
          { id: 'model', label: 'Model & forecast' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'overview' && <OverviewTab />}
      {tab === 'team' && <TeamTab />}
      {tab === 'model' && <ModelTab />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function OverviewTab() {
  const { data, loading } = useApi<any>('/analytics/overview', { auth: false, refreshOn: REFRESH });
  if (loading || !data) return <PageSkeleton cards={6} />;
  const t = data.totals;

  const movers = [...data.teams]
    .filter((x: any) => x.eloChange !== 0)
    .sort((a: any, b: any) => b.eloChange - a.eloChange);
  const topMovers = [...movers.slice(0, 5), ...movers.slice(-5)].filter(
    (x: any, i: number, arr: any[]) => arr.findIndex((y) => y.code === x.code) === i,
  );

  const playedTeams = data.teams.filter((x: any) => x.played > 0);
  const hasPossession = playedTeams.some((x: any) => x.possessionAvg != null);

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Matches played" value={`${t.completed}/${t.total}`} />
        <Stat label="Goals" value={t.goals} />
        <Stat label="Goals / match" value={t.avgGoals} />
        <Stat label="Clean sheets" value={playedTeams.reduce((a: number, x: any) => a + x.cleanSheets, 0)} />
        <Stat label="Avg attendance" value={t.attendanceAvg ? t.attendanceAvg.toLocaleString() : '—'} />
        <Stat label="Cards" value={`${playedTeams.reduce((a: number, x: any) => a + x.yellows, 0)}🟨 ${playedTeams.reduce((a: number, x: any) => a + x.reds, 0)}🟥`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Goals per matchday">
          <LineChart
            series={[{ name: 'Goals', points: data.goalsByDate.map((d: any) => ({ label: d.date.slice(5), y: d.goals })), area: true }]}
          />
        </Card>
        <Card title="Result split">
          <Donut
            centerLabel={`${t.completed} played`}
            segments={[
              { label: 'Home/first-listed wins', value: t.homeWins, color: CHART.primary },
              { label: 'Draws', value: t.draws, color: CHART.line },
              { label: 'Away wins', value: t.awayWins, color: CHART.info },
            ]}
          />
          {data.stages.length > 0 && (
            <div className="mt-4">
              <Section title="Avg goals by stage">
                <HBars
                  data={data.stages.map((s: any) => ({
                    label: STAGE_LABEL[s.stage] ?? s.stage,
                    value: s.avgGoals,
                    suffix: `${s.avgGoals} (${s.played}m)`,
                  }))}
                  max={5}
                />
              </Section>
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Golden Boot race — real goals only">
          {data.topScorers.length ? (
            <HBars
              labelWidth="w-40"
              data={data.topScorers.map((p: any) => ({
                label: (
                  <span className="inline-flex items-center gap-1.5">
                    <Flag code={p.code} size={16} /> {p.name}
                  </span>
                ),
                value: p.goals,
                suffix: `${p.goals}g ${p.assists}a`,
              }))}
            />
          ) : (
            <p className="py-6 text-center text-xs text-muted">No goals ingested yet.</p>
          )}
        </Card>
        <Card title="Elo movers — net change since kickoff">
          <DivergingBars
            data={topMovers.map((x: any) => ({
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <Flag code={x.code} size={16} /> {x.code}
                </span>
              ),
              value: x.eloChange,
            }))}
          />
          {data.scorelines.length > 0 && (
            <div className="mt-4">
              <Section title="Most common scorelines">
                <HBars
                  labelWidth="w-12"
                  data={data.scorelines.map((s: any) => ({ label: s.score, value: s.count, suffix: `×${s.count}` }))}
                />
              </Section>
            </div>
          )}
        </Card>
      </div>

      <Card title={`Team table — every team, real results${hasPossession ? '' : ' (possession appears when measured data is available)'}`}>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
                <th className="px-2 py-1.5">Team</th>
                <th className="px-1 text-center">Grp</th>
                <th className="px-1 text-center">P</th>
                <th className="px-1 text-center">W-D-L</th>
                <th className="px-1 text-center">GF</th>
                <th className="px-1 text-center">GA</th>
                <th className="px-2">Goal difference</th>
                <th className="px-1 text-center">CS</th>
                <th className="px-1 text-center">Cards</th>
                {hasPossession && <th className="px-1 text-center">Poss%</th>}
                <th className="px-1 text-right">Elo</th>
                <th className="px-1 text-right">Δ</th>
              </tr>
            </thead>
            <tbody>
              {data.teams.map((x: any) => (
                <tr key={x.code} className="border-t border-line/60">
                  <td className="whitespace-nowrap px-2 py-1.5 font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      <Flag code={x.code} size={18} /> {x.name}
                    </span>
                  </td>
                  <td className="text-center text-muted">{x.group ?? '—'}</td>
                  <td className="text-center font-mono">{x.played}</td>
                  <td className="text-center font-mono text-muted">{x.w}-{x.d}-{x.l}</td>
                  <td className="text-center font-mono">{x.gf}</td>
                  <td className="text-center font-mono">{x.ga}</td>
                  <td className="px-2">
                    <GdBar gd={x.gd} />
                  </td>
                  <td className="text-center font-mono">{x.cleanSheets}</td>
                  <td className="whitespace-nowrap text-center font-mono text-muted">{x.yellows}/{x.reds}</td>
                  {hasPossession && <td className="text-center font-mono">{x.possessionAvg ?? '—'}</td>}
                  <td className="text-right font-mono">{x.elo}</td>
                  <td className={`text-right font-mono font-semibold ${x.eloChange > 0 ? 'text-success' : x.eloChange < 0 ? 'text-danger' : 'text-muted'}`}>
                    {x.eloChange > 0 ? `+${x.eloChange}` : x.eloChange || '·'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function GdBar({ gd }: { gd: number }) {
  const w = Math.min(40, Math.abs(gd) * 8);
  return (
    <div className="relative mx-auto h-2.5 w-24 overflow-hidden rounded-full bg-elevated">
      <div className="absolute inset-y-0 left-1/2 w-px bg-line" />
      {gd !== 0 && (
        <div
          className="absolute inset-y-0 rounded-full"
          style={
            gd > 0
              ? { left: '50%', width: `${w}%`, background: CHART.success }
              : { right: '50%', width: `${w}%`, background: CHART.danger }
          }
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function TeamTab() {
  const { data: countries } = useApi<any[]>('/countries', { auth: false });
  const [code, setCode] = useState<string | null>(null);
  const selected = code ?? countries?.[0]?.code ?? null;
  const { data, loading } = useApi<any>(selected ? `/analytics/team/${selected}` : null, {
    auth: false,
    refreshOn: REFRESH,
  });

  const squadByPosition = useMemo(() => {
    if (!data?.squad) return [];
    const groups: Record<string, number[]> = {};
    for (const p of data.squad) (groups[p.position] ??= []).push(p.rating ?? 0);
    return ['GK', 'DF', 'MF', 'FW']
      .filter((pos) => groups[pos]?.length)
      .map((pos) => ({
        label: `${pos} (${groups[pos].length})`,
        value: Math.round(groups[pos].reduce((a, b) => a + b, 0) / groups[pos].length),
        color: POSITION_COLOR[pos],
      }));
  }, [data?.squad]);

  if (!countries) return <PageSkeleton cards={4} />;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-1.5">
        {countries.map((c) => (
          <button
            key={c.code}
            onClick={() => setCode(c.code)}
            title={c.name}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
              selected === c.code ? 'border-primary bg-primary/10 text-primary' : 'border-line bg-card text-muted hover:border-primary/40'
            }`}
          >
            <Flag code={c.code} size={16} /> {c.code}
          </button>
        ))}
      </div>

      {loading || !data ? (
        <PageSkeleton cards={4} />
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Flag code={data.country.code} size={44} />
            <div>
              <h2 className="text-xl font-bold">{data.country.name}</h2>
              <p className="text-xs text-muted">
                Coach {data.country.coach ?? '—'} · {String(data.country.style).replace('_', ' ')} · Group {data.country.group} · FIFA #
                {data.country.fifaRanking}
              </p>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Badge color="primary">Elo {data.country.elo}</Badge>
              {data.country.eloChange !== 0 && (
                <Badge color={data.country.eloChange > 0 ? 'success' : 'danger'}>
                  {data.country.eloChange > 0 ? '+' : ''}
                  {data.country.eloChange} this tournament
                </Badge>
              )}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Tactical identity (model-derived)">
              <Radar axes={AXES_LABELS} series={[{ name: data.country.code, values: data.axes }]} />
              <p className="mt-1 text-center text-[10px] text-muted">
                From the manager&apos;s preferred style and shape — not measured match data.
              </p>
            </Card>

            <Card title="Elo trajectory">
              {data.eloSeries.length > 1 ? (
                <LineChart series={[{ name: 'Elo', points: data.eloSeries.map((e: any) => ({ label: e.label, y: e.elo })), area: true }]} />
              ) : (
                <p className="py-8 text-center text-xs text-muted">
                  No completed matches yet — the line starts moving after the first final whistle.
                </p>
              )}
            </Card>

            <Card title="Path through the tournament (forecast)">
              {data.qualification ? (
                <HBars
                  data={[
                    { label: 'Win group', value: data.qualification.winGroup },
                    { label: 'Reach R32', value: data.qualification.reachR32 },
                    { label: 'Reach R16', value: data.qualification.reachR16 },
                    { label: 'Quarter-final', value: data.qualification.reachQF },
                    { label: 'Semi-final', value: data.qualification.reachSF },
                    { label: 'Final', value: data.qualification.reachFinal },
                    { label: 'CHAMPION', value: data.qualification.champion, color: CHART.gold },
                  ].map((r) => ({ ...r, suffix: `${(r.value * 100).toFixed(1)}%` }))}
                  max={1}
                />
              ) : (
                <p className="py-8 text-center text-xs text-muted">Forecast not computed yet.</p>
              )}
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Goals for / against by match">
              {data.matches.some((m: any) => m.result) ? (
                <>
                  <MirrorBars
                    data={data.matches
                      .filter((m: any) => m.result)
                      .map((m: any) => ({
                        label: `M${m.matchNumber}`,
                        up: m.gf ?? 0,
                        down: m.ga ?? 0,
                        title: `vs ${m.opponent} (${m.result})`,
                      }))}
                  />
                  <ChartLegend items={[{ label: 'Scored', color: CHART.primary }, { label: 'Conceded', color: CHART.info }]} />
                </>
              ) : (
                <p className="py-8 text-center text-xs text-muted">No completed matches yet.</p>
              )}
              <div className="mt-3 grid gap-1">
                {data.matches.map((m: any) => (
                  <div key={m.matchNumber} className="flex items-center gap-2 rounded-lg bg-elevated/60 px-2.5 py-1.5 text-xs">
                    <span className="w-9 font-mono text-muted">M{m.matchNumber}</span>
                    <span className="w-14 text-[10px] uppercase tracking-wide text-muted">{STAGE_LABEL[m.stage] ?? m.stage}</span>
                    <span className="flex flex-1 items-center gap-1.5">
                      {m.home ? 'vs' : '@'} {m.opponent ? <Flag code={m.opponent} size={14} /> : null} {m.opponentName ?? 'TBD'}
                    </span>
                    {m.possession != null && <span className="font-mono text-[10px] text-muted">{m.possession}% poss</span>}
                    {m.result ? (
                      <>
                        <span className="font-mono font-bold">
                          {m.gf}–{m.ga}
                        </span>
                        <span
                          className={`grid h-5 w-5 place-items-center rounded-full text-[10px] font-black text-white ${
                            m.result === 'W' ? 'bg-success' : m.result === 'D' ? 'bg-warning' : 'bg-danger'
                          }`}
                        >
                          {m.result}
                        </span>
                      </>
                    ) : (
                      <span className="text-[10px] text-muted">{m.date}</span>
                    )}
                  </div>
                ))}
              </div>
            </Card>

            <div className="grid content-start gap-4">
              <Card title="Squad — age vs rating">
                <Scatter
                  xLabel="Age"
                  yLabel="Rating"
                  points={data.squad.map((p: any) => ({
                    x: p.age,
                    y: p.rating ?? 0,
                    label: `${p.name} (${p.position})`,
                    color: POSITION_COLOR[p.position] ?? CHART.primary,
                  }))}
                />
                <ChartLegend
                  items={['GK', 'DF', 'MF', 'FW'].map((pos) => ({ label: pos, color: POSITION_COLOR[pos] }))}
                />
              </Card>
              <Card title="Average rating by position">
                <HBars data={squadByPosition} max={100} />
              </Card>
              <Card title="Goal contributions (real)">
                {data.contributors.length ? (
                  <HBars
                    labelWidth="w-40"
                    data={data.contributors.slice(0, 8).map((p: any) => ({
                      label: p.name,
                      value: p.goals + p.assists,
                      suffix: `${p.goals}g ${p.assists}a`,
                    }))}
                  />
                ) : (
                  <p className="py-4 text-center text-xs text-muted">No goal involvements recorded yet.</p>
                )}
              </Card>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------

function ModelTab() {
  const { data: qual } = useApi<any>('/tournament/qualification', { auth: false, refreshOn: REFRESH });
  const { data: overview } = useApi<any>('/analytics/overview', { auth: false, refreshOn: REFRESH });

  if (!qual || !overview) return <PageSkeleton cards={4} />;

  const ranked = [...(qual.teams ?? [])].sort((a: any, b: any) => b.champion - a.champion);
  const cal = overview.calibration;

  return (
    <div className="grid gap-4">
      <p className="text-xs text-muted">
        {qual.runs ? `${qual.runs.toLocaleString()}-run Monte Carlo of the remaining tournament` : 'Forecast pending'} ·{' '}
        {qual.computedAt ? `computed ${new Date(qual.computedAt).toLocaleString()}` : ''} — refreshed automatically after every result.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Champion probability — top 12">
          <HBars
            labelWidth="w-32"
            max={Math.max(ranked[0]?.champion ?? 0.01, 0.01)}
            data={ranked.slice(0, 12).map((t: any, i: number) => ({
              label: (
                <span className="inline-flex items-center gap-1.5">
                  <Flag code={t.team} size={16} /> {t.team}
                </span>
              ),
              value: t.champion,
              color: i === 0 ? CHART.gold : CHART.primary,
              suffix: `${(t.champion * 100).toFixed(1)}%`,
            }))}
          />
        </Card>

        <Card title="Model calibration — Brier score per scored match">
          {cal.history.length ? (
            <>
              <LineChart
                series={[
                  {
                    name: 'Brier',
                    points: cal.history.map((h: any) => ({ label: `M${h.matchNumber}`, y: h.brier })),
                  },
                ]}
                yFmt={(v) => v.toFixed(2)}
                baseline={0.667}
                baselineLabel="uniform guess (0.667)"
              />
              <div className="mt-2 flex items-center justify-between text-xs">
                <span className="text-muted">Lower is better · 0 = perfect, 0.667 = always guessing ⅓/⅓/⅓</span>
                <Badge color={cal.brierMean != null && cal.brierMean < 0.6 ? 'success' : 'warning'}>
                  mean {cal.brierMean?.toFixed(3) ?? '—'} over {cal.scored}
                </Badge>
              </div>
              <div className="mt-3 grid gap-1">
                {cal.history.slice(-6).reverse().map((h: any) => (
                  <div key={h.matchNumber} className="flex items-center gap-2 rounded-lg bg-elevated/60 px-2.5 py-1 font-mono text-[11px]">
                    <span className="w-10 text-muted">M{h.matchNumber}</span>
                    <span className="flex-1">
                      predicted {h.predicted} · actual {h.actual}
                    </span>
                    <span className={h.brier < 0.5 ? 'text-success' : 'text-warning'}>{h.brier.toFixed(3)}</span>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="py-8 text-center text-xs text-muted">The model scores itself after each completed match.</p>
          )}
        </Card>
      </div>

      <Card title="Stage probability heatmap — every modelled team">
        <HeatTable
          columns={[
            { key: 'winGroup', label: 'Win grp' },
            { key: 'reachR32', label: 'R32' },
            { key: 'reachR16', label: 'R16' },
            { key: 'reachQF', label: 'QF' },
            { key: 'reachSF', label: 'SF' },
            { key: 'reachFinal', label: 'Final' },
            { key: 'champion', label: 'Champ' },
          ]}
          rows={ranked.map((t: any) => ({
            label: (
              <span className="inline-flex items-center gap-1.5">
                <Flag code={t.team} size={16} /> {t.team}
              </span>
            ),
            values: t,
          }))}
        />
      </Card>
    </div>
  );
}
