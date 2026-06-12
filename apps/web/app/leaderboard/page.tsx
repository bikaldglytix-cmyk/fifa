'use client';

import { useState } from 'react';
import { useApi } from '../../lib/hooks';
import { useAuth } from '../../lib/auth';
import { Card, Flag, Select, Tabs } from '../../components/ui';
import { Skeleton } from '../../components/intel';

export default function LeaderboardPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('global');
  const [country, setCountry] = useState('BRA');
  const { data: countries } = useApi<any[]>('/countries', { auth: false });

  const path =
    tab === 'global'
      ? '/leaderboards/global?limit=100'
      : tab === 'country'
        ? `/leaderboards/country/${country}?limit=100`
        : user
          ? '/leaderboards/friends'
          : null;
  // realtime: results, retractions and fantasy scoring all reshuffle the board
  const { data: rows, loading } = useApi<any[]>(path, {
    auth: tab === 'friends',
    refreshMs: 60_000,
    refreshOn: ['STANDINGS_UPDATED', 'PREDICTIONS_UPDATED'],
  });

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold">Leaderboards</h1>
        <div className="ml-auto w-80">
          <Tabs
            tabs={[
              { id: 'global', label: 'Global' },
              { id: 'country', label: 'By country' },
              { id: 'friends', label: 'Friends' },
            ]}
            active={tab}
            onChange={setTab}
          />
        </div>
        {tab === 'country' && (
          <Select value={country} onChange={(e) => setCountry(e.target.value)} className="w-44">
            {countries?.map((c) => (
              <option key={c.code} value={c.code}>{c.name}</option>
            ))}
          </Select>
        )}
      </div>

      <Card>
        {loading ? (
          <div className="grid gap-2 py-2">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-9" />)}
          </div>
        ) : !rows?.length ? (
          <p className="py-10 text-center text-sm text-muted">
            {tab === 'friends' && !user ? 'Log in to see your friends board.' : 'No entries yet — points land as soon as predictions are scored and lineups earn.'}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-muted">
                <th className="w-12 pb-2">Rank</th>
                <th className="pb-2">Manager</th>
                <th className="w-20 pb-2 text-right">Points</th>
                <th className="hidden w-24 pb-2 text-right sm:table-cell">Accuracy</th>
                <th className="hidden w-24 pb-2 text-right md:table-cell">Exact</th>
                <th className="hidden w-28 pb-2 text-right md:table-cell">Sims run</th>
                <th className="hidden w-24 pb-2 text-right lg:table-cell">Reputation</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.userId} className={`border-t border-line/50 ${r.userId === user?.id ? 'bg-primary/5' : ''}`}>
                  <td className="py-2 font-mono">
                    {r.rank === 1 ? '1st' : r.rank === 2 ? '2nd' : r.rank === 3 ? '3rd' : `#${r.rank}`}
                  </td>
                  <td className="flex items-center gap-2 py-2">
                    {r.countryCode && <Flag code={r.countryCode} size={18} />}
                    <a href={`/u/${r.username}`} className="font-medium hover:text-primary">{r.username}</a>
                    {r.userId === user?.id && <span className="text-[10px] text-primary">(you)</span>}
                  </td>
                  <td className="py-2 text-right font-mono font-bold text-secondary">{r.totalPoints}</td>
                  <td className="hidden py-2 text-right font-mono text-xs sm:table-cell">{r.predictionAccuracy.toFixed(0)}%</td>
                  <td className="hidden py-2 text-right font-mono text-xs md:table-cell">{r.exactScoreAccuracy.toFixed(0)}%</td>
                  <td className="hidden py-2 text-right font-mono text-xs md:table-cell">{r.simulationsRun.toLocaleString()}</td>
                  <td className="hidden py-2 text-right font-mono text-xs lg:table-cell">{r.reputationScore.toFixed(0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
