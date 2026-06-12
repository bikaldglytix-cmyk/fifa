import { useEffect, useMemo } from 'react';
import { useApp } from '../context/AppContext.jsx';

// Deterministic-ish bot managers so the global board feels populated.
const BOT_NAMES = [
  'xG_Wizard', 'PoissonPete', 'TikiTakaTom', 'CatenaccioKate', 'GegenpressGус',
  'MonteCarloMo', 'BracketBoss', 'TheOracle', 'SambaStats', 'CruyffTurner',
  'ParkTheBus', 'TotalFootballFan', 'VAR_Victim', 'GoldenBootGuru', 'PenaltyKing',
];

function makeBots() {
  return BOT_NAMES.map((name, i) => {
    const points = 1200 - i * 47 + Math.floor((Math.sin(i * 13.7) + 1) * 60);
    const accuracy = 68 - i * 1.6 + (i % 3) * 2;
    return { name, points, accuracy: Math.round(accuracy * 10) / 10, bot: true };
  });
}

export default function Leaderboard() {
  const { state, seedLeaderboard } = useApp();

  useEffect(() => {
    if (!state.leaderboard || state.leaderboard.length === 0) {
      seedLeaderboard(makeBots());
    }
  }, [state.leaderboard, seedLeaderboard]);

  // User's points are derived from their activity in this MVP.
  const userPoints = useMemo(() => {
    const sims = (state.history || []).length;
    const preds = Object.keys(state.predictions || {}).length;
    return 300 + sims * 25 + preds * 40;
  }, [state.history, state.predictions]);

  const rows = useMemo(() => {
    const bots = state.leaderboard?.length ? state.leaderboard : makeBots();
    const all = [
      ...bots,
      { name: `${state.user.username} (you)`, points: userPoints, accuracy: 64.5, you: true },
    ];
    return all.sort((a, b) => b.points - a.points);
  }, [state.leaderboard, userPoints, state.user.username]);

  return (
    <div className="stack" style={{ gap: '1.5rem' }}>
      <div>
        <h1>Global Leaderboard</h1>
        <p className="muted">
          Earn points by running simulations and submitting predictions. Your rank updates live as
          you play (stored locally for this MVP).
        </p>
      </div>
      <div className="card">
        <table>
          <thead>
            <tr><th>Rank</th><th>Manager</th><th className="num">Points</th><th className="num">Accuracy</th></tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.name} style={r.you ? { background: 'var(--accent-soft)' } : undefined}>
                <td className="muted mono">{i + 1}</td>
                <td>
                  {r.name}
                  {r.you && <span className="badge primary" style={{ marginLeft: 6 }}>you</span>}
                </td>
                <td className="num" style={r.you ? { color: 'var(--ink)', fontWeight: 600 } : undefined}>
                  {r.points.toLocaleString()}
                </td>
                <td className="num">{r.accuracy}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
