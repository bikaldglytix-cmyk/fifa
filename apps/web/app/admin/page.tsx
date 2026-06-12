'use client';

import { useMemo, useState } from 'react';
import { get, patch, post } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { useAuth } from '../../lib/auth';
import { Badge, Button, Card, Flag, Input, Select, Stat, Tabs, useToast } from '../../components/ui';
import { PageSkeleton, SkeletonCard } from '../../components/intel';

interface AdminMatch {
  matchNumber: number;
  stage: string;
  groupLetter: string | null;
  homeCode: string | null;
  awayCode: string | null;
  homeScore: number | null;
  awayScore: number | null;
  status: string;
  localDate: string;
  localTime: string;
}

interface ResultEvent {
  minute: number;
  type: string;
  team: string;
  playerName?: string;
}

export default function AdminPage() {
  const { user, loading } = useAuth();
  const [tab, setTab] = useState('results');

  if (loading) return <PageSkeleton cards={2} />;
  if (!user || user.role !== 'admin') {
    return (
      <Card className="mx-auto max-w-md text-center">
        <p className="py-6 text-sm text-muted">This area is for tournament administrators.</p>
      </Card>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">
          Admin console <Badge color="danger">RESTRICTED</Badge>
        </h1>
      </div>
      <Tabs
        tabs={[
          { id: 'results', label: 'Match results' },
          { id: 'players', label: 'Player status' },
          { id: 'users', label: 'Users' },
          { id: 'ops', label: 'Fraud & data ops' },
        ]}
        active={tab}
        onChange={setTab}
      />
      {tab === 'results' && <ResultsTab />}
      {tab === 'players' && <PlayersTab />}
      {tab === 'users' && <UsersTab />}
      {tab === 'ops' && <OpsTab />}
    </div>
  );
}

/* ------------------------------- results ---------------------------------- */

function ResultsTab() {
  const { show, node } = useToast();
  const { data: matches, reload } = useApi<AdminMatch[]>('/matches');
  const [selected, setSelected] = useState<number | null>(null);
  const [homeScore, setHomeScore] = useState('0');
  const [awayScore, setAwayScore] = useState('0');
  const [homePens, setHomePens] = useState('');
  const [awayPens, setAwayPens] = useState('');
  const [events, setEvents] = useState<ResultEvent[]>([]);
  const [busy, setBusy] = useState(false);

  const playable = useMemo(
    () => (matches ?? []).filter((m) => m.status !== 'completed' && m.homeCode && m.awayCode),
    [matches],
  );
  const match = playable.find((m) => m.matchNumber === selected) ?? playable[0] ?? null;
  const knockout = match ? match.stage !== 'group' : false;
  const drawn = Number(homeScore) === Number(awayScore);

  const addEvent = () =>
    match && setEvents((e) => [...e, { minute: 1, type: 'goal', team: match.homeCode! }]);
  const setEvent = (i: number, patch: Partial<ResultEvent>) =>
    setEvents((e) => e.map((ev, j) => (j === i ? { ...ev, ...patch } : ev)));

  const submit = async () => {
    if (!match) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = {
        homeScore: Number(homeScore),
        awayScore: Number(awayScore),
        events: events.length ? events.map((e) => ({ ...e, minute: Number(e.minute) })) : undefined,
      };
      if (knockout && drawn && homePens !== '' && awayPens !== '') {
        body.homePenalties = Number(homePens);
        body.awayPenalties = Number(awayPens);
      }
      await post(`/admin/results/${match.matchNumber}`, body);
      show(`Result recorded: ${match.homeCode} ${homeScore}–${awayScore} ${match.awayCode} ✓`);
      setEvents([]);
      setSelected(null);
      await reload();
    } catch (e: any) {
      show(e.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const pipeline = async (path: string, label: string) => {
    try {
      const r = await post<any>(path);
      show(`${label}: ${JSON.stringify(r)}`);
      await reload();
    } catch (e: any) {
      show(e.message, 'error');
    }
  };

  if (!matches) {
    return (
      <div className="grid gap-4 lg:grid-cols-3">
        <SkeletonCard lines={8} />
        <SkeletonCard lines={8} />
        <SkeletonCard lines={8} />
      </div>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card title="Enter official result" className="lg:col-span-2">
        {!match ? (
          <p className="py-4 text-sm text-muted">No matches awaiting a result.</p>
        ) : (
          <div className="grid gap-3">
            <Select label="Match" value={match.matchNumber} onChange={(e) => setSelected(Number(e.target.value))}>
              {playable.map((m) => (
                <option key={m.matchNumber} value={m.matchNumber}>
                  #{m.matchNumber} · {m.stage === 'group' ? `Group ${m.groupLetter}` : m.stage} · {m.homeCode} vs {m.awayCode} · {m.localDate}
                </option>
              ))}
            </Select>

            <div className="flex items-center justify-center gap-4 rounded-lg bg-elevated p-4">
              <div className="flex items-center gap-2">
                <Flag code={match.homeCode!} size={28} />
                <b>{match.homeCode}</b>
              </div>
              <input
                type="number" min={0} max={20} value={homeScore}
                onChange={(e) => setHomeScore(e.target.value)}
                className="w-16 rounded-lg border border-line bg-card px-2 py-2 text-center font-mono text-xl outline-none focus:border-primary"
              />
              <span className="text-muted">–</span>
              <input
                type="number" min={0} max={20} value={awayScore}
                onChange={(e) => setAwayScore(e.target.value)}
                className="w-16 rounded-lg border border-line bg-card px-2 py-2 text-center font-mono text-xl outline-none focus:border-primary"
              />
              <div className="flex items-center gap-2">
                <b>{match.awayCode}</b>
                <Flag code={match.awayCode!} size={28} />
              </div>
            </div>

            {knockout && drawn && (
              <div className="grid grid-cols-2 gap-3">
                <Input label={`${match.homeCode} penalties`} type="number" min={0} value={homePens} onChange={(e) => setHomePens(e.target.value)} />
                <Input label={`${match.awayCode} penalties`} type="number" min={0} value={awayPens} onChange={(e) => setAwayPens(e.target.value)} />
              </div>
            )}

            <div>
              <div className="mb-1 flex items-center justify-between">
                <span className="text-xs font-medium text-muted">Match events (optional)</span>
                <Button size="sm" variant="ghost" onClick={addEvent}>+ add event</Button>
              </div>
              {events.map((ev, i) => (
                <div key={i} className="mb-1 grid grid-cols-[70px_1fr_90px_1fr_auto] items-center gap-2">
                  <Input type="number" min={1} max={130} value={ev.minute} onChange={(e) => setEvent(i, { minute: Number(e.target.value) })} />
                  <Select value={ev.type} onChange={(e) => setEvent(i, { type: e.target.value })}>
                    {['goal', 'penalty_goal', 'own_goal', 'yellow_card', 'second_yellow', 'red_card'].map((t) => (
                      <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
                    ))}
                  </Select>
                  <Select value={ev.team} onChange={(e) => setEvent(i, { team: e.target.value })}>
                    <option value={match.homeCode!}>{match.homeCode}</option>
                    <option value={match.awayCode!}>{match.awayCode}</option>
                  </Select>
                  <Input placeholder="player (optional)" value={ev.playerName ?? ''} onChange={(e) => setEvent(i, { playerName: e.target.value || undefined })} />
                  <Button size="sm" variant="danger" onClick={() => setEvents((es) => es.filter((_, j) => j !== i))}>✕</Button>
                </div>
              ))}
            </div>

            <Button onClick={() => void submit()} disabled={busy || (knockout && drawn && (homePens === '' || awayPens === ''))}>
              {busy ? 'Recording…' : 'Record result & run pipeline'}
            </Button>
            <p className="text-[11px] text-muted">
              Recording a result scores all user predictions and fantasy lineups, updates Elo and standings,
              resolves bracket slots, and broadcasts to live subscribers.
            </p>
          </div>
        )}
      </Card>

      <div className="grid gap-4 content-start">
        <Card title="Pipeline controls">
          <div className="grid gap-2">
            <Button variant="ghost" onClick={() => void pipeline('/admin/bracket/resolve', 'Bracket')}>Re-resolve bracket</Button>
            <Button variant="ghost" onClick={() => void pipeline('/admin/lineups/lock-due', 'Lineup lock')}>Lock due lineups</Button>
            <Button variant="ghost" onClick={() => void pipeline('/admin/engine/refresh', 'Engine')}>Refresh engine cache</Button>
          </div>
        </Card>
        <Card title="Recently completed">
          <div className="grid gap-1 text-sm">
            {(matches ?? []).filter((m) => m.status === 'completed').slice(-8).reverse().map((m) => (
              <div key={m.matchNumber} className="flex items-center justify-between rounded-lg bg-elevated px-3 py-1.5">
                <span>#{m.matchNumber} {m.homeCode} vs {m.awayCode}</span>
                <span className="font-mono font-bold">{m.homeScore}–{m.awayScore}</span>
              </div>
            ))}
            {!(matches ?? []).some((m) => m.status === 'completed') && (
              <p className="py-2 text-center text-xs text-muted">No results yet — tournament starts today.</p>
            )}
          </div>
        </Card>
      </div>
      {node}
    </div>
  );
}

/* ------------------------------- players ---------------------------------- */

function PlayersTab() {
  const { show, node } = useToast();
  const [search, setSearch] = useState('');
  const { data } = useApi<{ players: any[] }>(search.length >= 2 ? `/players?search=${encodeURIComponent(search)}&limit=12` : null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const setStatus = async (p: any, status: string) => {
    setBusyId(p.id);
    try {
      await patch(`/admin/players/${p.id}/injury`, {
        status,
        description: status === 'fit' ? undefined : `Marked ${status} by admin`,
      });
      show(`${p.name} → ${status} ✓`);
    } catch (e: any) {
      show(e.message, 'error');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card title="Player availability">
      <Input label="Search any of the 1,246 squad players" placeholder="e.g. Messi, Mbappé, Bellingham…" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="mt-3 grid gap-1">
        {(data?.players ?? []).map((p) => (
          <div key={p.id} className="flex flex-wrap items-center gap-3 rounded-lg bg-elevated px-3 py-2 text-sm">
            <Flag code={p.countryCode} size={22} />
            <b className="min-w-40">{p.name}</b>
            <span className="text-muted">{p.position} · {p.club}</span>
            <Badge color={p.injuryStatus === 'fit' ? 'success' : p.injuryStatus === 'doubtful' ? 'warning' : 'danger'}>
              {p.injuryStatus} {p.fitnessPercentage}%
            </Badge>
            <div className="ml-auto flex gap-1">
              {['fit', 'doubtful', 'out'].map((s) => (
                <Button key={s} size="sm" variant={s === 'out' ? 'danger' : 'ghost'} disabled={busyId === p.id || p.injuryStatus === s} onClick={() => void setStatus(p, s)}>
                  {s}
                </Button>
              ))}
            </div>
          </div>
        ))}
        {search.length >= 2 && data && !data.players.length && <p className="py-3 text-center text-sm text-muted">No players match “{search}”.</p>}
      </div>
      {node}
    </Card>
  );
}

/* -------------------------------- users ----------------------------------- */

function UsersTab() {
  const { show, node } = useToast();
  const [username, setUsername] = useState('');
  const [found, setFound] = useState<any | null>(null);
  const [multi, setMulti] = useState<any | null>(null);
  const [days, setDays] = useState('30');
  const [reason, setReason] = useState('');

  const lookup = async () => {
    setFound(null);
    setMulti(null);
    try {
      setFound(await get<any>(`/users/${encodeURIComponent(username.trim())}/profile`));
    } catch (e: any) {
      show(e.message, 'error');
    }
  };

  const act = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      show(msg);
      await lookup();
    } catch (e: any) {
      show(e.message, 'error');
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Find user">
        <div className="flex gap-2">
          <Input placeholder="exact username" value={username} onChange={(e) => setUsername(e.target.value)} className="flex-1" />
          <Button onClick={() => void lookup()} disabled={!username.trim()}>Look up</Button>
        </div>
        {found && (
          <div className="mt-4 grid gap-2 text-sm">
            <div className="flex items-center gap-2">
              <b className="text-base">{found.username}</b>
              <Badge color={found.role === 'admin' ? 'danger' : found.role === 'premium' ? 'gold' : 'primary'}>{found.role}</Badge>
              {found.countryCode && <Flag code={found.countryCode} size={20} />}
            </div>
            <p className="text-muted">
              id <span className="font-mono text-[11px]">{found.id}</span> · member since {new Date(found.memberSince).toLocaleDateString()} · {found.followers} followers
              {found.fantasyTeam && <> · manages {found.fantasyTeam.country} ({found.fantasyTeam.points} pts)</>}
            </p>
          </div>
        )}
      </Card>

      {found && (
        <Card title={`Actions — ${found.username}`}>
          <div className="grid gap-3">
            <div className="flex items-end gap-2">
              <Input label="Premium days" type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} className="w-24" />
              <Button variant="gold" onClick={() => void act(() => post(`/admin/users/${found.id}/premium?days=${days}`), `Premium granted for ${days} days ✓`)}>
                Grant premium
              </Button>
            </div>
            <div className="flex items-end gap-2">
              <Input label="Suspension reason" placeholder="reason" value={reason} onChange={(e) => setReason(e.target.value)} className="flex-1" />
              <Button variant="danger" onClick={() => void act(() => post(`/admin/users/${found.id}/suspend`, { reason: reason || undefined }), 'User suspended')}>
                Suspend
              </Button>
              <Button variant="ghost" onClick={() => void act(() => post(`/admin/users/${found.id}/reinstate`), 'User reinstated ✓')}>
                Reinstate
              </Button>
            </div>
            <Button
              variant="ghost"
              onClick={async () => {
                try {
                  setMulti(await get<any>(`/admin/fraud/multi-account/${found.id}`));
                } catch (e: any) {
                  show(e.message, 'error');
                }
              }}
            >
              Run multi-account check
            </Button>
            {multi && (
              <pre className="max-h-48 overflow-auto rounded-lg bg-elevated p-3 font-mono text-[11px] text-muted">{JSON.stringify(multi, null, 2)}</pre>
            )}
          </div>
        </Card>
      )}
      {node}
    </div>
  );
}

/* --------------------------------- ops ------------------------------------ */

function OpsTab() {
  const { show, node } = useToast();
  const { data: flags, reload } = useApi<any[]>('/admin/fraud/flags');
  const { data: logs } = useApi<any[]>('/admin/ingestion-logs');

  const resolve = async (id: number) => {
    try {
      await patch(`/admin/fraud/flags/${id}/resolve`);
      show('Flag resolved ✓');
      await reload();
    } catch (e: any) {
      show(e.message, 'error');
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Open fraud flags">
        {!flags?.length ? (
          <p className="py-4 text-center text-sm text-muted">No open flags — rate limiter, audit log and anomaly detection are running.</p>
        ) : (
          <div className="grid gap-1">
            {flags.map((f) => (
              <div key={f.id} className="flex items-center gap-3 rounded-lg bg-elevated px-3 py-2 text-sm">
                <Badge color={f.severity === 'high' ? 'danger' : f.severity === 'medium' ? 'warning' : 'muted'}>{f.severity ?? 'low'}</Badge>
                <span className="flex-1">
                  <b>{f.flagType ?? f.type}</b> <span className="text-muted">— {f.details ?? f.description ?? f.userId}</span>
                </span>
                <Button size="sm" variant="ghost" onClick={() => void resolve(f.id)}>Resolve</Button>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Data ingestion provenance">
        <div className="mb-3 grid grid-cols-3 gap-2">
          <Stat label="sources" value={new Set((logs ?? []).map((l) => l.source)).size} />
          <Stat label="ingestions" value={logs?.length ?? '—'} />
          <Stat label="records" value={(logs ?? []).reduce((s, l) => s + (l.recordsIngested ?? 0), 0).toLocaleString()} />
        </div>
        <div className="grid gap-1 text-sm">
          {(logs ?? []).slice(0, 12).map((l) => (
            <div key={l.id} className="flex items-center justify-between rounded-lg bg-elevated px-3 py-1.5">
              <span><b>{l.source}</b> <span className="text-muted">· {l.dataType}</span></span>
              <span className="font-mono text-xs text-muted">{l.recordsIngested} rec · conf {l.confidenceScore}</span>
            </div>
          ))}
        </div>
      </Card>
      {node}
    </div>
  );
}
