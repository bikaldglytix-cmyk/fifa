import { useState } from 'react';
import { simulateTournamentOnce, simulateTournamentMonteCarlo } from '../engine/tournament.js';
import { COUNTRY_BY_CODE } from '../data/countries.js';
import { useApp } from '../context/AppContext.jsx';

export default function Tournament() {
  const { state, addHistory } = useApp();
  const [run, setRun] = useState(null);
  const [mc, setMc] = useState(null);
  const [busy, setBusy] = useState(false);
  const [mcRuns, setMcRuns] = useState(2000);

  function runOnce() {
    setBusy(true);
    setTimeout(() => {
      const result = simulateTournamentOnce((Math.random() * 1e9) | 0);
      setRun(result);
      addHistory({ type: 'tournament', teams: 'World Cup', score: `Champion: ${result.champion}`, at: Date.now() });
      setBusy(false);
    }, 30);
  }

  function runMonteCarlo() {
    setBusy(true);
    setTimeout(() => {
      const res = simulateTournamentMonteCarlo(mcRuns);
      setMc(res);
      setBusy(false);
    }, 30);
  }

  return (
    <div className="stack" style={{ gap: '1.5rem' }}>
      <div>
        <h1>Tournament Simulator</h1>
        <p className="muted">
          Full World Cup: 8 groups of 4 → Round of 16 → Quarters → Semis → Final, with penalty
          shootouts in the knockouts. Run it once for a bracket, or thousands of times for title odds.
        </p>
      </div>

      <div className="card">
        <div className="row wrap">
          <button className="btn" onClick={runOnce} disabled={busy}>
            {busy ? <><span className="spinner" /> Working…</> : 'Simulate one tournament'}
          </button>
          <div className="row" style={{ gap: '0.5rem' }}>
            <select value={mcRuns} onChange={(e) => setMcRuns(Number(e.target.value))}>
              <option value={500}>500 runs</option>
              <option value={2000}>2,000 runs</option>
              <option value={5000}>5,000 runs</option>
            </select>
            <button className="btn secondary" onClick={runMonteCarlo} disabled={busy}>
              Monte Carlo title odds
            </button>
          </div>
        </div>
      </div>

      {mc && <MonteCarloTable mc={mc} myCountry={state.user.country} />}
      {run && <BracketView run={run} />}
    </div>
  );
}

function MonteCarloTable({ mc, myCountry }) {
  return (
    <div className="card">
      <div className="row between">
        <div className="section-title" style={{ margin: 0 }}>Title odds — {mc.runs.toLocaleString()} tournaments</div>
        <span className="badge">{mc.durationMs} ms</span>
      </div>
      <table style={{ marginTop: '0.75rem' }}>
        <thead>
          <tr>
            <th>#</th><th>Team</th>
            <th className="num">R16</th><th className="num">QF</th>
            <th className="num">SF</th><th className="num">Final</th><th className="num">Champion</th>
          </tr>
        </thead>
        <tbody>
          {mc.table.slice(0, 16).map((row, i) => {
            const c = COUNTRY_BY_CODE[row.code];
            const mine = row.code === myCountry;
            return (
              <tr key={row.code} style={mine ? { background: 'var(--accent-soft)' } : undefined}>
                <td className="muted mono">{i + 1}</td>
                <td><span className="flag">{c.flag}</span> {c.name} {mine && <span className="badge primary">you</span>}</td>
                <td className="num">{row.r16}%</td>
                <td className="num">{row.qf}%</td>
                <td className="num">{row.sf}%</td>
                <td className="num">{row.final}%</td>
                <td className="num" style={{ color: 'var(--accent)', fontWeight: 600 }}>{row.champion}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Side({ code, score, win }) {
  const c = COUNTRY_BY_CODE[code];
  return (
    <div className={`side ${win ? 'win' : ''}`}>
      <span>{c.flag} {c.code}</span>
      <span className="sc">{score}</span>
    </div>
  );
}

function Node({ m }) {
  return (
    <div className="match-node">
      <Side code={m.a} score={m.goalsA + (m.pens ? ` (${m.pens.a})` : '')} win={m.winner === m.a} />
      <Side code={m.b} score={m.goalsB + (m.pens ? ` (${m.pens.b})` : '')} win={m.winner === m.b} />
    </div>
  );
}

function BracketView({ run }) {
  const r = run.rounds;
  const champ = COUNTRY_BY_CODE[run.champion];
  return (
    <div className="stack" style={{ gap: '1rem' }}>
      <div className="card row between wrap">
        <div>
          <div className="section-title" style={{ margin: 0 }}>Champion</div>
          <div className="row" style={{ gap: '0.6rem', marginTop: '0.35rem' }}>
            <span className="flag lg">{champ.flag}</span>
            <h2 style={{ margin: 0 }}>{champ.name}</h2>
          </div>
        </div>
        <div className="row wrap" style={{ gap: '2rem' }}>
          <div className="stat"><div className="value">{COUNTRY_BY_CODE[run.runnerUp].code}</div><div className="label">Runner-up</div></div>
          <div className="stat"><div className="value">{COUNTRY_BY_CODE[run.thirdPlaceTeam].code}</div><div className="label">Third place</div></div>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Knockout bracket</div>
        <div className="bracket">
          <div className="bracket-col">
            <h4>Round of 16</h4>
            {r.round16.map((m, i) => <Node key={i} m={m} />)}
          </div>
          <div className="bracket-col">
            <h4>Quarter-finals</h4>
            {r.quarterfinal.map((m, i) => <Node key={i} m={m} />)}
          </div>
          <div className="bracket-col">
            <h4>Semi-finals</h4>
            {r.semifinal.map((m, i) => <Node key={i} m={m} />)}
          </div>
          <div className="bracket-col">
            <h4>Final</h4>
            <Node m={r.final} />
            <h4 style={{ marginTop: '1rem' }}>Third place</h4>
            <Node m={r.thirdPlace} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="section-title">Group stage results</div>
        <div className="grid cols-2">
          {Object.entries(run.standings).map(([letter, table]) => (
            <div key={letter}>
              <strong>Group {letter}</strong>
              <table style={{ marginTop: '0.35rem' }}>
                <thead><tr><th>Team</th><th className="num">Pts</th><th className="num">GD</th></tr></thead>
                <tbody>
                  {table.map((row, i) => {
                    const c = COUNTRY_BY_CODE[row.code];
                    const q = i < 2;
                    return (
                      <tr key={row.code} style={q ? { color: 'var(--ink)', fontWeight: 500 } : { color: 'var(--muted)' }}>
                        <td>{c.flag} {c.code}{q ? ' ✓' : ''}</td>
                        <td className="num">{row.pts}</td>
                        <td className="num">{row.gd > 0 ? '+' : ''}{row.gd}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
