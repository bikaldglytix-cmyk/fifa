'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { STAGE_LABELS } from '@fifa/shared';
import { useApi } from '../../lib/hooks';
import { Badge, Card, Flag, Select } from '../../components/ui';
import { PhaseChip, SkeletonCard, Skeleton, Section } from '../../components/intel';
import { MatchCard, type BoardMatch } from '../../components/match-card';

export default function MatchesPage() {
  // realtime: phase changes, live feed ticks and model updates refresh the board on their own
  const { data: board, loading: boardLoading } = useApi<BoardMatch[]>('/intelligence/board', {
    auth: false,
    refreshOn: ['MATCH_PHASE', 'PREDICTIONS_UPDATED', 'STANDINGS_UPDATED', 'LIVE_SCORES_UPDATED'],
    refreshMs: 120_000,
  });
  const { data: matches } = useApi<any[]>('/matches', { auth: false, refreshOn: ['MATCH_PHASE', 'LIVE_SCORES_UPDATED'] });
  const { data: venues } = useApi<any[]>('/venues', { auth: false });
  const [stage, setStage] = useState('all');
  const [group, setGroup] = useState('all');

  const venueName = (id: string) => venues?.find((v) => v.id === id)?.name ?? id;

  const grouped = useMemo(() => {
    if (!matches) return [];
    const filtered = matches.filter(
      (m) => (stage === 'all' || m.stage === stage) && (group === 'all' || m.groupLetter === group),
    );
    const byDate = new Map<number, any[]>();
    for (const m of filtered) {
      const d = new Date(m.matchDate);
      d.setHours(0,0,0,0);
      const key = d.getTime();
      const list = byDate.get(key) ?? [];
      list.push(m);
      byDate.set(key, list);
    }
    return [...byDate.entries()].sort((a, b) => a[0] - b[0]);
  }, [matches, stage, group]);

  return (
    <div className="grid gap-6">
      <Section title="Match board — live & next 72 hours">
        {boardLoading ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            <SkeletonCard lines={4} />
            <SkeletonCard lines={4} />
            <SkeletonCard lines={4} />
          </div>
        ) : board?.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {board.map((m) => (
              <MatchCard key={m.matchNumber} m={m} venueName={venueName(m.venueId)} />
            ))}
          </div>
        ) : (
          <Card><p className="py-3 text-center text-sm text-muted">No matches in the next 72 hours.</p></Card>
        )}
      </Section>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold">Full schedule — all 104 matches</h1>
        <div className="ml-auto flex gap-2">
          <Select value={stage} onChange={(e) => setStage(e.target.value)} className="w-40">
            <option value="all">All stages</option>
            {Object.entries(STAGE_LABELS).map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </Select>
          <Select value={group} onChange={(e) => setGroup(e.target.value)} className="w-32">
            <option value="all">All groups</option>
            {'ABCDEFGHIJKL'.split('').map((g) => (
              <option key={g} value={g}>Group {g}</option>
            ))}
          </Select>
        </div>
      </div>

      {!matches && (
        <div className="grid gap-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      )}

      {grouped.map(([dateKey, list]) => (
        <Card key={dateKey} title={new Date(dateKey).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}>
          <div className="grid gap-1.5">
            {list.map((m) => (
              <Link
                key={m.matchNumber}
                href={`/match/${m.matchNumber}`}
                className="flex items-center gap-3 rounded-lg px-3 py-2 transition hover:bg-elevated"
              >
                <span className="w-9 font-mono text-[10px] text-muted">M{m.matchNumber}</span>
                <Badge color={m.stage === 'group' ? 'muted' : 'primary'}>
                  {m.stage === 'group' ? `Grp ${m.groupLetter}` : STAGE_LABELS[m.stage as keyof typeof STAGE_LABELS]}
                </Badge>
                <div className="flex flex-1 items-center justify-center gap-2">
                  <span className="text-right text-sm font-medium sm:w-32">{m.homeCode ?? slotText(m.homeSlot)}</span>
                  {m.homeCode && <Flag code={m.homeCode} size={20} />}
                  <span className="w-14 text-center font-mono text-sm">
                    {m.homeScore != null ? (
                      `${m.homeScore}–${m.awayScore}`
                    ) : m.live ? (
                      <b className="text-danger">{m.live.homeScore}–{m.live.awayScore}</b>
                    ) : (
                      new Date(m.matchDate).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                    )}
                  </span>
                  {m.awayCode && <Flag code={m.awayCode} size={20} />}
                  <span className="text-sm font-medium sm:w-32">{m.awayCode ?? slotText(m.awaySlot)}</span>
                </div>
                <span className="hidden w-40 text-right text-[10px] text-muted md:block">{venueName(m.venueId)}</span>
                <PhaseChip phase={m.status} />
              </Link>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

const slotText = (s: any): string => {
  if (!s) return 'TBD';
  switch (s.type) {
    case 'groupWinner': return `Winner ${s.group}`;
    case 'groupRunnerUp': return `Runner-up ${s.group}`;
    case 'thirdPlace': return `3rd of ${s.allowedGroups.join('/')}`;
    case 'matchWinner': return `Winner M${s.match}`;
    case 'matchLoser': return `Loser M${s.match}`;
    default: return 'TBD';
  }
};
