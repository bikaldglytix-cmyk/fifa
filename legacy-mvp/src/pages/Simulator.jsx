import { useState } from 'react';
import { simulateMatch, buildGoalTimeline } from '../engine/simulation.js';
import { lineupStrength } from '../engine/chemistry.js';
import { getSquad } from '../data/squads.js';
import { COUNTRY_BY_CODE } from '../data/countries.js';
import { useApp } from '../context/AppContext.jsx';
import TeamPicker, { TeamName } from '../components/TeamPicker.jsx';
import ProbabilityBar from '../components/ProbabilityBar.jsx';

export default function Simulator() {
  const { state, addHistory } = useApp();
  const [home, setHome] = useState('ARG');
  const [away, setAway] = useState('FRA');
  const [sims, setSims] = useState(10000);
  const [result, setResult] = useState(null);
  const [timeline, setTimeline] = useState([]);
  const [running, setRunning] = useState(false);

  // If the user's fantasy team is one of the sides, apply their built lineup strength.
  function lineupOverride(code, key) {
    const f = state.fantasy;
    if (f.country !== code) return undefined;
    const squad = getSquad(code);
    const byId = Object.fromEntries(squad.map((p) => [p.id, p]));
    const assignments = [];
    for (let i = 0; i < 11; i++) assignments[i] = f.lineup[i] ? byId[f.lineup[i]] : null;
    if (assignments.every((a) => !a)) return undefined;
    return { [key]: lineupStrength(assignments, f.formation) };
  }

  function run() {
    if (!home || !away || home === away) return;
    setRunning(true);
    setResult(null);
    // Defer to next tick so the spinner can paint before the (synchronous) crunch.
    setTimeout(() => {
      const opts = {
        simulations: sims,
        ...lineupOverride(home, 'lineupStrengthA'),
        ...lineupOverride(away, 'lineupStrengthB'),
      };
      const res = simulateMatch(home, away, opts);
      setResult(res);
      const tl = buildGoalTimeline(home, away, res.mostLikelyScore.a, res.mostLikelyScore.b, sims);
      setTimeline(tl);
      addHistory({
        type: 'match',
        teams: `${home} v ${away}`,
        score: `${res.mostLikelyScore.a}-${res.mostLikelyScore.b}`,
        at: Date.now(),
      });
      setRunning(false);
    }, 30);
  }

  return (
    <div className="stack" style={{ gap: '1.5rem' }}>
      <div>
        <h1>Match Simulator</h1>
        <p className="muted">
          Monte Carlo engine — Elo + Poisson goal model. Pick two teams and run thousands of
          simulations to get win probabilities and the most likely scoreline.
        </p>
      </div>

      <div className="card">
        <div className="row wrap" style={{ alignItems: 'flex-end' }}>
          <TeamPicker label="Home / Team A" value={home} onChange={setHome} exclude={away} />
          <div style={{ fontWeight: 800, padding: '0 0.5rem', alignSelf: 'center' }}>VS</div>
          <TeamPicker label="Away / Team B" value={away} onChange={setAway} exclude={home} />
          <label className="stack" style={{ gap: '0.35rem' }}>
            <span className="section-title" style={{ margin: 0 }}>Simulations</span>
            <select value={sims} onChange={(e) => setSims(Number(e.target.value))}>
              <option value={1000}>1,000</option>
              <option value={10000}>10,000</option>
              <option value={50000}>50,000</option>
              <option value={100000}>100,000</option>
            </select>
          </label>
          <button className="btn" onClick={run} disabled={running || home === away}>
            {running ? <><span className="spinner" /> Simulating…</> : 'Simulate'}
          </button>
        </div>
        {state.fantasy.country && (home === state.fantasy.country || away === state.fantasy.country) && (
          <p className="muted" style={{ marginBottom: 0, marginTop: '0.85rem', fontSize: '0.82rem' }}>
            Your custom <TeamName code={state.fantasy.country} /> lineup ({state.fantasy.formation}) is
            being applied to this simulation.
          </p>
        )}
      </div>

      {result && <ResultView result={result} timeline={timeline} home={home} away={away} />}
    </div>
  );
}

function ResultView({ result, timeline, home, away }) {
  const h = COUNTRY_BY_CODE[home];
  const a = COUNTRY_BY_CODE[away];
  return (
    <div className="stack" style={{ gap: '1rem' }}>
      <div className="card elevated">
        <div className="row between wrap">
          <div className="row" style={{ gap: '0.5rem' }}>
            <span className="flag lg">{h.flag}</span>
            <strong>{h.name}</strong>
          </div>
          <div className="mono" style={{ fontSize: '2rem', fontWeight: 700 }}>
            {result.mostLikelyScore.a} – {result.mostLikelyScore.b}
          </div>
          <div className="row" style={{ gap: '0.5rem' }}>
            <strong>{a.name}</strong>
            <span className="flag lg">{a.flag}</span>
          </div>
        </div>
        <p className="muted" style={{ textAlign: 'center', margin: '0.5rem 0 1rem' }}>
          Most likely scoreline · {result.mostLikelyScore.probability}% of runs · confidence{' '}
          <strong style={{ color: 'var(--ink)' }}>{result.confidence}%</strong>
        </p>
        <ProbabilityBar home={result.homeWin} draw={result.draw} away={result.awayWin} />
        <div className="row between" style={{ marginTop: '0.4rem', fontSize: '0.78rem' }}>
          <span className="muted">{h.name} win {result.homeWin}%</span>
          <span className="muted">Draw {result.draw}%</span>
          <span className="muted">{a.name} win {result.awayWin}%</span>
        </div>
      </div>

      <div className="grid cols-3">
        <div className="stat">
          <div className="value primary">{result.expectedScore.a} – {result.expectedScore.b}</div>
          <div className="label">Expected goals (avg)</div>
        </div>
        <div className="stat">
          <div className="value">{result.simulations.toLocaleString()}</div>
          <div className="label">Simulations run</div>
        </div>
        <div className="stat">
          <div className="value gold">{result.durationMs} ms</div>
          <div className="label">Compute time</div>
        </div>
      </div>

      <div className="grid cols-2">
        <div className="card">
          <div className="section-title">Scoreline distribution</div>
          <table>
            <thead><tr><th>Score</th><th className="num">Probability</th></tr></thead>
            <tbody>
              {result.scoreDistribution.map((s) => (
                <tr key={s.score}>
                  <td className="mono">{s.score}</td>
                  <td className="num">{s.probability}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <div className="section-title">Goal timeline (sample match)</div>
          {timeline.length === 0 ? (
            <p className="muted">Goalless draw in the most likely scoreline.</p>
          ) : (
            <div className="stack" style={{ gap: '0.4rem' }}>
              {timeline.map((e, i) => (
                <div key={i} className="list-row">
                  <span><span className="badge primary">{e.minute}'</span> {e.scorer}</span>
                  <span className="flag">{COUNTRY_BY_CODE[e.team].flag}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
