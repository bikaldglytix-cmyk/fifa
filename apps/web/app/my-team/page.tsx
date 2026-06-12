'use client';

import { useEffect, useMemo, useState } from 'react';
import { FORMATIONS, type FormationId } from '@fifa/shared';
import { post, put } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { useAuth } from '../../lib/auth';
import { Badge, Button, Card, Flag, Meter, Modal, Select, useToast } from '../../components/ui';
import { PageSkeleton } from '../../components/intel';
import { CHART, ChartLegend, HBars, Scatter } from '../../components/charts';

const POSITION_COLOR: Record<string, string> = {
  GK: CHART.gold,
  DF: CHART.info,
  MF: CHART.success,
  FW: CHART.primary,
};

export default function MyTeamPage() {
  const { user, loading } = useAuth();
  if (loading) return <PageSkeleton cards={3} />;
  if (!user) {
    return (
      <Card className="mx-auto max-w-md text-center">
        <p className="py-6 text-sm text-muted">Log in to select your nation and build your starting XI.</p>
        <a href="/login"><Button>Log in</Button></a>
      </Card>
    );
  }
  return <TeamManager />;
}

function TeamManager() {
  const { data: myTeam, loading, reload } = useApi<any>('/fantasy/my-team');
  if (loading) return <PageSkeleton cards={3} />;
  if (!myTeam) return <CountryPicker onPicked={reload} />;
  return <LineupBuilder myTeam={myTeam} onChanged={reload} />;
}

function CountryPicker({ onPicked }: { onPicked: () => void }) {
  const { data: countries } = useApi<any[]>('/countries', { auth: false });
  const { show, node } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const pick = async (code: string) => {
    setBusy(code);
    try {
      await post('/fantasy/select-country', { countryCode: code });
      show(`You now manage ${code}!`);
      onPicked();
    } catch (e: any) {
      show(e.message, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <h1 className="mb-1 text-2xl font-bold">Choose your nation</h1>
      <p className="mb-4 text-sm text-muted">
        You manage one country for the whole tournament — its real 26-man squad, your lineup, your points. Choose well.
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {countries?.map((c) => (
          <button
            key={c.code}
            onClick={() => pick(c.code)}
            disabled={Boolean(busy)}
            className="group flex flex-col items-center gap-2 rounded-xl border border-line bg-card p-4 transition hover:border-primary hover:bg-elevated disabled:opacity-50"
          >
            <Flag code={c.code} size={48} />
            <div className="text-sm font-semibold">{c.name}</div>
            <div className="font-mono text-[10px] text-muted">
              #{c.fifaRanking} · Group {c.group} · Elo {c.eloRating}
            </div>
            {busy === c.code && <span className="text-xs text-primary">selecting…</span>}
          </button>
        ))}
      </div>
      {node}
    </div>
  );
}

// ---------------------------------------------------------------------------

function LineupBuilder({ myTeam, onChanged }: { myTeam: any; onChanged: () => void }) {
  const { show, node } = useToast();
  const { data: fixtures, reload: reloadFixtures } = useApi<any[]>('/fantasy/fixtures');
  const squad: any[] = myTeam.squad ?? [];

  const [formationId, setFormationId] = useState<FormationId>(myTeam.formation ?? '4-3-3');
  const [assignments, setAssignments] = useState<Record<string, number>>({});
  const [captainId, setCaptainId] = useState<number | null>(null);
  const [viceId, setViceId] = useState<number | null>(null);
  const [pickerSlot, setPickerSlot] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<any>(null);
  const [matchNumber, setMatchNumber] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const formation = FORMATIONS[formationId];
  const byId = useMemo(() => new Map(squad.map((p) => [p.id, p])), [squad]);

  const nextFixture = useMemo(() => fixtures?.find((f) => !f.locked && f.status === 'scheduled') ?? null, [fixtures]);
  useEffect(() => {
    if (nextFixture && matchNumber === null) setMatchNumber(nextFixture.matchNumber);
  }, [nextFixture, matchNumber]);

  // hydrate from an existing saved lineup for the selected fixture
  useEffect(() => {
    const fx = fixtures?.find((f) => f.matchNumber === matchNumber);
    if (fx?.lineup) {
      setFormationId(fx.lineup.formation);
      const map: Record<string, number> = {};
      for (const a of fx.lineup.startingXi as Array<{ slotId: string; playerId: number }>) map[a.slotId] = a.playerId;
      setAssignments(map);
      setCaptainId(fx.lineup.captainPlayerId);
      setViceId(fx.lineup.viceCaptainPlayerId);
    }
  }, [fixtures, matchNumber]);

  const assignedIds = new Set(Object.values(assignments));
  const complete = formation.slots.every((s) => assignments[s.id]);

  // average rating of the assigned XI per natural position line
  const lineStrength = useMemo(() => {
    const assigned = Object.values(assignments)
      .map((id) => byId.get(id))
      .filter(Boolean) as any[];
    return ['GK', 'DF', 'MF', 'FW']
      .map((pos) => {
        const ps = assigned.filter((p) => p.position === pos);
        return ps.length
          ? { label: `${pos} ×${ps.length}`, value: Math.round(ps.reduce((a, p) => a + (p.rating ?? 0), 0) / ps.length), color: POSITION_COLOR[pos] }
          : null;
      })
      .filter(Boolean) as Array<{ label: string; value: number; color: string }>;
  }, [assignments, byId]);

  const autoFill = async () => {
    const sug = await fetch(`/api/v1/fantasy/suggest/${myTeam.countryCode}?formation=${formationId}`).then((r) => r.json());
    const map: Record<string, number> = {};
    for (const a of sug.startingXi) map[a.slotId] = a.playerId;
    setAssignments(map);
    setCaptainId(sug.suggestedCaptain);
    const vice = sug.startingXi.find((a: any) => a.playerId !== sug.suggestedCaptain);
    setViceId(vice?.playerId ?? null);
  };

  // live chemistry/fit analysis when XI completes
  useEffect(() => {
    if (!complete || !captainId) {
      setAnalysis(null);
      return;
    }
    const xi = formation.slots.map((s) => ({ slotId: s.id, role: s.role, playerId: assignments[s.id] }));
    post<any>('/fantasy/lineup/analyze', { formation: formationId, startingXi: xi, captainId })
      .then(setAnalysis)
      .catch(() => setAnalysis(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(assignments), formationId, captainId]);

  const save = async () => {
    if (!matchNumber) return show('No unlocked fixture to save for', 'error');
    if (!complete || !captainId || !viceId) return show('Fill all 11 slots and pick captain + vice', 'error');
    setBusy(true);
    try {
      const xi = formation.slots.map((s) => ({ slotId: s.id, role: s.role, playerId: assignments[s.id] }));
      const bench = squad
        .filter((p) => !assignedIds.has(p.id))
        .slice(0, 5)
        .map((p) => p.id);
      await put('/fantasy/lineup', {
        matchNumber,
        formation: formationId,
        startingXi: xi,
        substitutes: bench,
        captainId,
        viceCaptainId: viceId,
      });
      show('Lineup saved ✓');
      reloadFixtures();
      onChanged();
    } catch (e: any) {
      show(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Flag code={myTeam.countryCode} size={40} />
        <div>
          <h1 className="text-xl font-bold">{myTeam.country?.name}</h1>
          <p className="text-xs text-muted">
            Coach {myTeam.country?.coach} · Group {myTeam.country?.group} · FIFA #{myTeam.country?.fifaRanking}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge color="gold">{myTeam.totalPoints} pts</Badge>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_330px]">
        {/* pitch */}
        <Card>
          <div className="mb-3 flex flex-wrap items-center gap-3">
            <Select value={formationId} onChange={(e) => { setFormationId(e.target.value as FormationId); setAssignments({}); }} className="w-32">
              {Object.keys(FORMATIONS).map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </Select>
            <Select
              value={matchNumber ?? ''}
              onChange={(e) => setMatchNumber(Number(e.target.value))}
              className="w-56"
            >
              {fixtures?.map((f) => (
                <option key={f.matchNumber} value={f.matchNumber} disabled={f.locked}>
                  M{f.matchNumber} vs {f.opponent} {f.locked ? '(Locked)' : ''}
                </option>
              ))}
            </Select>
            <Button variant="ghost" size="sm" onClick={() => void autoFill()}>Best XI</Button>
            <Button variant="ghost" size="sm" onClick={() => { setAssignments({}); setCaptainId(null); setViceId(null); }}>Clear</Button>
          </div>

          <div className="relative mx-auto aspect-[3/4] max-w-md overflow-hidden rounded-2xl border border-line bg-gradient-to-b from-[#3aa765] to-[#22824a]">
            {/* pitch markings */}
            <div className="absolute inset-x-0 top-1/2 h-px bg-white/20" />
            <div className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/20" />
            <div className="absolute left-1/2 top-0 h-16 w-44 -translate-x-1/2 border border-t-0 border-white/20" />
            <div className="absolute bottom-0 left-1/2 h-16 w-44 -translate-x-1/2 border border-b-0 border-white/20" />

            {formation.slots.map((slot) => {
              const pid = assignments[slot.id];
              const player = pid ? byId.get(pid) : null;
              return (
                <button
                  key={slot.id}
                  onClick={() => setPickerSlot(slot.id)}
                  className="absolute -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${slot.x}%`, top: `${100 - slot.y}%` }}
                >
                  <div className={`flex h-12 w-12 flex-col items-center justify-center rounded-full border-2 text-[9px] font-bold transition sm:h-14 sm:w-14 ${
                    player ? 'border-primary bg-card' : 'border-dashed border-white/60 bg-white/15 text-white/90 hover:border-white hover:bg-white/25'
                  }`}>
                    {player ? (
                      <>
                        <span className="font-mono text-[11px]">{player.jerseyNumber}</span>
                        <span className="max-w-12 truncate px-0.5">{lastName(player.name)}</span>
                      </>
                    ) : (
                      slot.id
                    )}
                  </div>
                  {player && captainId === player.id && (
                    <span className="absolute -right-1 -top-1 rounded-full bg-secondary px-1 text-[9px] font-black text-white">C</span>
                  )}
                  {player && viceId === player.id && (
                    <span className="absolute -right-1 -top-1 rounded-full bg-info px-1 text-[9px] font-black text-white">V</span>
                  )}
                </button>
              );
            })}
          </div>
        </Card>

        {/* side panel */}
        <div className="grid content-start gap-4">
          <Card title="Team analysis">
            {analysis ? (
              <div className="grid gap-3">
                <Meter label="Chemistry" value={analysis.chemistry.total} />
                <HBars
                  labelWidth="w-24"
                  max={25}
                  data={[
                    { label: 'Club links', value: analysis.chemistry.clubLinks, suffix: `${analysis.chemistry.clubLinks}/25` },
                    { label: 'League links', value: analysis.chemistry.leagueLinks, suffix: `${analysis.chemistry.leagueLinks}/15` },
                    { label: 'Experience', value: analysis.chemistry.experienceBalance, suffix: `${analysis.chemistry.experienceBalance}/25` },
                    { label: 'Age balance', value: analysis.chemistry.ageBalance, suffix: `${analysis.chemistry.ageBalance}/20` },
                    { label: 'Captain', value: analysis.chemistry.captainBonus, suffix: `${analysis.chemistry.captainBonus}/15`, color: CHART.gold },
                  ]}
                />
                <Meter label="Tactical fit" value={analysis.tacticalFit.total} />
                <HBars
                  labelWidth="w-24"
                  max={60}
                  data={[
                    { label: 'In position', value: analysis.tacticalFit.positionFit, suffix: `${analysis.tacticalFit.positionFit}/60` },
                    { label: 'Suits style', value: analysis.tacticalFit.styleFit, suffix: `${analysis.tacticalFit.styleFit}/25`, color: CHART.info },
                    { label: 'Familiarity', value: analysis.tacticalFit.formationFamiliarity, suffix: `${analysis.tacticalFit.formationFamiliarity}/15`, color: CHART.info },
                  ]}
                />
                {analysis.tacticalFit.warnings.length > 0 && (
                  <ul className="grid gap-1 rounded-lg bg-warning/10 p-2 text-[11px] text-warning">
                    {analysis.tacticalFit.warnings.slice(0, 4).map((w: string, i: number) => (
                      <li key={i}>Warning: {w}</li>
                    ))}
                  </ul>
                )}
              </div>
            ) : (
              <p className="py-2 text-center text-xs text-muted">Complete the XI and name a captain to see chemistry & tactical fit.</p>
            )}
            {lineStrength.length > 0 && (
              <div className="mt-3 border-t border-line/60 pt-3">
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">XI strength by line</p>
                <HBars labelWidth="w-24" max={100} data={lineStrength} />
              </div>
            )}
          </Card>

          <Card title="Captaincy">
            <div className="grid gap-2">
              <Select label="Captain (2× points)" value={captainId ?? ''} onChange={(e) => setCaptainId(Number(e.target.value) || null)}>
                <option value="">—</option>
                {[...assignedIds].map((id) => (
                  <option key={id} value={id}>{byId.get(id)?.name}</option>
                ))}
              </Select>
              <Select label="Vice-captain (1.5× if captain absent)" value={viceId ?? ''} onChange={(e) => setViceId(Number(e.target.value) || null)}>
                <option value="">—</option>
                {[...assignedIds].filter((id) => id !== captainId).map((id) => (
                  <option key={id} value={id}>{byId.get(id)?.name}</option>
                ))}
              </Select>
            </div>
          </Card>

          <Button onClick={() => void save()} disabled={busy || !complete} size="lg">
            {busy ? 'Saving…' : `Save lineup ${matchNumber ? `for M${matchNumber}` : ''}`}
          </Button>
          {nextFixture && (
            <p className="text-center text-[11px] text-muted">
              Locks 75 minutes before kickoff · {new Date(nextFixture.lockAt).toLocaleString()}
            </p>
          )}
        </div>
      </div>

      <Card title="Squad insights — age vs rating (selected XI highlighted)">
        <Scatter
          xLabel="Age"
          yLabel="Rating"
          points={squad.map((p) => ({
            x: p.age,
            y: p.rating ?? 0,
            label: `${p.name} (${p.position})${assignedIds.has(p.id) ? ' — in XI' : ''}`,
            color: assignedIds.has(p.id) ? POSITION_COLOR[p.position] ?? CHART.primary : 'var(--color-line)',
          }))}
        />
        <ChartLegend
          items={[
            ...['GK', 'DF', 'MF', 'FW'].map((pos) => ({ label: `${pos} (in XI)`, color: POSITION_COLOR[pos] })),
            { label: 'Not selected', color: 'var(--color-line)' },
          ]}
        />
      </Card>

      {/* player picker modal */}
      <Modal open={Boolean(pickerSlot)} onClose={() => setPickerSlot(null)} title={`Pick ${pickerSlot}`} wide>
        {pickerSlot && (
          <div className="grid gap-1">
            {squad
              .filter((p) => {
                const slot = formation.slots.find((s) => s.id === pickerSlot)!;
                return slot.natural.includes(p.position) || p.position === 'MF' || slot.natural.includes('MF');
              })
              .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0))
              .map((p) => {
                const taken = assignedIds.has(p.id) && assignments[pickerSlot] !== p.id;
                const natural = formation.slots.find((s) => s.id === pickerSlot)!.natural.includes(p.position);
                return (
                  <button
                    key={p.id}
                    disabled={taken || p.injuryStatus === 'out'}
                    onClick={() => {
                      setAssignments((a) => ({ ...a, [pickerSlot]: p.id }));
                      setPickerSlot(null);
                    }}
                    className="flex items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-elevated disabled:opacity-35"
                  >
                    <span className="w-7 font-mono text-xs text-muted">#{p.jerseyNumber}</span>
                    <span className="flex-1">
                      {p.name}
                      {p.isCaptain && <span className="ml-1 text-secondary">(C)</span>}
                      {p.injuryStatus !== 'fit' && <span className="ml-1 text-danger">{p.injuryStatus === 'out' ? '+ out' : '+/- doubtful'}</span>}
                    </span>
                    <Badge color={natural ? 'success' : 'warning'}>{p.position}</Badge>
                    <span className="w-16 text-right font-mono text-xs text-muted">{p.caps} caps</span>
                    <span className="hidden h-2 w-20 overflow-hidden rounded-full bg-elevated sm:block">
                      <span
                        className="block h-full rounded-full"
                        style={{ width: `${Math.round(p.rating ?? 0)}%`, background: POSITION_COLOR[p.position] ?? CHART.primary }}
                      />
                    </span>
                    <span className="w-10 text-right font-mono text-sm font-bold text-primary">{Math.round(p.rating ?? 0)}</span>
                  </button>
                );
              })}
          </div>
        )}
      </Modal>
      {node}
    </div>
  );
}

const lastName = (full: string) => {
  const parts = full.split(' ');
  return parts.length > 1 ? parts.slice(1).join(' ') : full;
};
