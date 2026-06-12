'use client';

import { useState } from 'react';
import { useApi, fmtPct } from '../../lib/hooks';
import { Badge, Button, Card, Flag, Input, Modal, Select } from '../../components/ui';
import { Skeleton } from '../../components/intel';

export default function PlayersPage() {
  const [search, setSearch] = useState('');
  const [country, setCountry] = useState('');
  const [position, setPosition] = useState('');
  const [sort, setSort] = useState('rating');
  const [compareA, setCompareA] = useState<any>(null);
  const [compareB, setCompareB] = useState<any>(null);

  const { data: countries } = useApi<any[]>('/countries', { auth: false });
  const qs = new URLSearchParams();
  if (search) qs.set('search', search);
  if (country) qs.set('country', country);
  if (position) qs.set('position', position);
  qs.set('sort', sort);
  qs.set('limit', '60');
  const { data, loading } = useApi<{ total: number; players: any[] }>(`/players?${qs.toString()}`, { auth: false });

  const { data: matchup } = useApi<any>(
    compareA && compareB ? `/players/${compareA.id}/vs/${compareB.id}` : null,
    { auth: false },
  );

  const pick = (p: any) => {
    if (!compareA || (compareA && compareB)) {
      setCompareA(p);
      setCompareB(null);
    } else if (p.id !== compareA.id) {
      setCompareB(p);
    }
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-2xl font-bold">⭐ Players</h1>
        <span className="text-xs text-muted">{data?.total ?? '…'} in the official squad lists</span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Input placeholder="Search name…" value={search} onChange={(e) => setSearch(e.target.value)} className="w-44" />
          <Select value={country} onChange={(e) => setCountry(e.target.value)} className="w-40">
            <option value="">All countries</option>
            {countries?.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
          </Select>
          <Select value={position} onChange={(e) => setPosition(e.target.value)} className="w-28">
            <option value="">All pos</option>
            <option>GK</option><option>DF</option><option>MF</option><option>FW</option>
          </Select>
          <Select value={sort} onChange={(e) => setSort(e.target.value)} className="w-28">
            <option value="rating">Rating</option>
            <option value="caps">Caps</option>
            <option value="goals">Goals</option>
            <option value="age">Age</option>
          </Select>
        </div>
      </div>

      {compareA && (
        <Card>
          <div className="flex items-center gap-3 text-sm">
            <Badge color="gold">COMPARE</Badge>
            <span>{compareA.name}</span>
            <span className="text-muted">vs</span>
            <span>{compareB ? compareB.name : <i className="text-muted">pick a second player…</i>}</span>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => { setCompareA(null); setCompareB(null); }}>Clear</Button>
          </div>
        </Card>
      )}

      <Card>
        {loading ? (
          <div className="grid gap-2 py-2">
            {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
          </div>
        ) : (
          <div className="grid gap-1">
            {data?.players.map((p) => (
              <button
                key={p.id}
                onClick={() => pick(p)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-elevated ${
                  compareA?.id === p.id || compareB?.id === p.id ? 'ring-1 ring-primary' : ''
                }`}
              >
                <Flag code={p.countryCode} size={22} />
                <span className="w-8 font-mono text-xs text-muted">#{p.jerseyNumber}</span>
                <span className="flex-1 font-medium">
                  {p.name}
                  {p.isCaptain && <span className="ml-1 text-secondary">©</span>}
                </span>
                <Badge color="muted">{p.position}</Badge>
                <span className="hidden w-36 truncate text-xs text-muted md:block">{p.club}</span>
                <span className="w-14 text-right font-mono text-xs text-muted">{p.caps} caps</span>
                <span className="w-12 text-right font-mono text-xs text-muted">{p.internationalGoals} ⚽</span>
                <span className="w-10 text-right font-mono text-sm font-bold text-primary">{Math.round(p.rating)}</span>
              </button>
            ))}
          </div>
        )}
      </Card>

      <Modal open={Boolean(matchup)} onClose={() => setCompareB(null)} title="Head-to-head duel (model-based)" wide>
        {matchup && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <b>{matchup.player1.name}</b>
              <Badge color={matchup.edge === 'even' ? 'muted' : 'gold'}>
                {matchup.edge === 'player1' ? '◀ edge' : matchup.edge === 'player2' ? 'edge ▶' : 'even'}
              </Badge>
              <b>{matchup.player2.name}</b>
            </div>
            <div className="grid gap-2">
              {matchup.factors.map((f: any) => (
                <div key={f.label} className="grid grid-cols-[60px_1fr_120px_1fr_60px] items-center gap-2 text-xs">
                  <span className={`text-right font-mono ${f.advantage === 'player1' ? 'font-bold text-primary' : 'text-muted'}`}>{f.p1}</span>
                  <div className="h-1.5 rounded-l bg-elevated">
                    <div className="ml-auto h-full rounded-l bg-primary" style={{ width: `${(f.p1 / (f.p1 + f.p2 || 1)) * 100}%` }} />
                  </div>
                  <span className="text-center text-muted">{f.label}</span>
                  <div className="h-1.5 rounded-r bg-elevated">
                    <div className="h-full rounded-r bg-warning" style={{ width: `${(f.p2 / (f.p1 + f.p2 || 1)) * 100}%` }} />
                  </div>
                  <span className={`font-mono ${f.advantage === 'player2' ? 'font-bold text-warning' : 'text-muted'}`}>{f.p2}</span>
                </div>
              ))}
            </div>
            <p className="mt-4 rounded-lg bg-elevated p-3 text-sm">{matchup.summary}</p>
            <p className="mt-2 text-center font-mono text-xs text-muted">duel win share: {fmtPct(matchup.winRateP1)} / {fmtPct(1 - matchup.winRateP1)}</p>
          </div>
        )}
      </Modal>
    </div>
  );
}
