'use client';

import { useState } from 'react';
import { post } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { useAuth } from '../../lib/auth';
import { Badge, Button, Card, Flag, Input, Modal, useToast } from '../../components/ui';
import { PageSkeleton, Skeleton } from '../../components/intel';

export default function LeaguesPage() {
  const { user, loading } = useAuth();
  const { show, node } = useToast();
  const { data: leagues, reload } = useApi<any[]>(user ? '/leagues/mine' : null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [selected, setSelected] = useState<any>(null);
  const { data: board } = useApi<any[]>(selected ? `/leagues/${selected.id}/leaderboard` : null, {
    refreshOn: ['STANDINGS_UPDATED'],
  });

  if (loading) return <PageSkeleton cards={3} />;
  if (!user) {
    return (
      <Card className="mx-auto max-w-md text-center">
        <p className="py-6 text-sm text-muted">Private leagues: compete with friends on a closed board. Log in to create or join one.</p>
        <a href="/login"><Button>Log in</Button></a>
      </Card>
    );
  }

  const create = async () => {
    try {
      const league = await post<any>('/leagues', { name });
      show(`League created — code ${league.joinCode}`);
      setCreateOpen(false);
      setName('');
      reload();
    } catch (e: any) {
      show(e.message, 'error');
    }
  };

  const join = async () => {
    try {
      const league = await post<any>('/leagues/join', { joinCode: joinCode.trim().toUpperCase() });
      show(`Joined ${league.name} ✓`);
      setJoinCode('');
      reload();
    } catch (e: any) {
      show(e.message, 'error');
    }
  };

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">👥 Private Leagues</h1>
        <div className="ml-auto flex gap-2">
          <Input placeholder="JOIN CODE" value={joinCode} onChange={(e) => setJoinCode(e.target.value)} className="w-32 uppercase" />
          <Button variant="ghost" onClick={() => void join()} disabled={joinCode.length < 6}>Join</Button>
          <Button onClick={() => setCreateOpen(true)}>+ Create league</Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-[300px_1fr]">
        <Card title="Your leagues">
          {!leagues?.length ? (
            <p className="py-6 text-center text-xs text-muted">No leagues yet. Create one and share the code.</p>
          ) : (
            <div className="grid gap-1">
              {leagues.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setSelected(l)}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                    selected?.id === l.id ? 'bg-primary/15 text-primary' : 'hover:bg-elevated'
                  }`}
                >
                  <span className="font-medium">{l.name}</span>
                  <span className="text-xs text-muted">{l.members} 👤</span>
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card title={selected ? `${selected.name} — join code: ${selected.joinCode}` : 'Standings'}>
          {!selected ? (
            <p className="py-10 text-center text-sm text-muted">Pick a league to see its board.</p>
          ) : !board ? (
            <div className="grid gap-2 py-2">
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
              <Skeleton className="h-8" />
            </div>
          ) : (
            <div className="grid gap-1">
              {board.map((r) => (
                <div key={r.userId} className={`flex items-center gap-2 rounded-lg px-3 py-2 ${r.userId === user.id ? 'bg-primary/5' : ''}`}>
                  <span className="w-8 font-mono text-sm">{r.rank === 1 ? '🥇' : `#${r.rank}`}</span>
                  {r.countryCode && <Flag code={r.countryCode} size={18} />}
                  <span className="text-sm font-medium">{r.username}</span>
                  <span className="ml-auto font-mono font-bold text-secondary">{r.totalPoints}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Create a private league">
        <div className="grid gap-3">
          <Input label="League name" value={name} onChange={(e) => setName(e.target.value)} placeholder="The Office Sweepstake" />
          <Button onClick={() => void create()} disabled={name.length < 3}>Create</Button>
        </div>
      </Modal>
      {node}
    </div>
  );
}
