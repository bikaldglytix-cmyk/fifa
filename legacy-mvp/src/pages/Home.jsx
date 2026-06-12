import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { simulateMatch } from '../engine/simulation.js';
import { simulateTournamentMonteCarlo } from '../engine/tournament.js';
import { COUNTRY_BY_CODE } from '../data/countries.js';
import { useApp } from '../context/AppContext.jsx';
import ProbabilityBar from '../components/ProbabilityBar.jsx';

export default function Home() {
  const { state } = useApp();
  const [marquee, setMarquee] = useState(null);
  const [odds, setOdds] = useState(null);

  // Compute the marquee match + a quick title-odds snapshot on mount.
  useEffect(() => {
    setMarquee(simulateMatch('ARG', 'FRA', { simulations: 10000, seed: 42 }));
    // Light Monte Carlo for the dashboard so the page stays snappy.
    setOdds(simulateTournamentMonteCarlo(400));
  }, []);

  const myCountry = state.user.country ? COUNTRY_BY_CODE[state.user.country] : null;
  const myOdds = useMemo(() => {
    if (!odds || !state.user.country) return null;
    return odds.table.find((r) => r.code === state.user.country);
  }, [odds, state.user.country]);

  const arg = COUNTRY_BY_CODE.ARG;
  const fra = COUNTRY_BY_CODE.FRA;

  return (
    <div className="stack" style={{ gap: '1.5rem' }}>
      <div className="hero">
        <span className="badge">World Cup 2026</span>
        <h1 style={{ marginTop: '0.5rem' }}>Match &amp; tournament simulation.</h1>
        <p className="muted" style={{ maxWidth: 560, margin: 0 }}>
          A Monte Carlo engine for the 2026 World Cup — match odds, full-tournament brackets and a
          fantasy lineup builder. Runs entirely in your browser.
        </p>
        <div className="row wrap" style={{ marginTop: '1.25rem' }}>
          <Link to="/simulator" className="btn">Simulate a match</Link>
          <Link to="/tournament" className="btn secondary">Simulate the tournament</Link>
          <Link to="/my-team" className="btn secondary">Build your team</Link>
        </div>
      </div>

      <div className="grid cols-2">
        {/* Marquee match */}
        <div className="card">
          <div className="row between">
            <div className="section-title" style={{ margin: 0 }}>Marquee match</div>
            <span className="badge">10,000 sims</span>
          </div>
          <div className="row between" style={{ margin: '1rem 0' }}>
            <div className="stack" style={{ alignItems: 'center', gap: '0.25rem' }}>
              <span className="flag lg">{arg.flag}</span><strong>{arg.name}</strong>
            </div>
            <div className="mono" style={{ fontSize: '1.8rem', fontWeight: 700 }}>
              {marquee ? `${marquee.mostLikelyScore.a} – ${marquee.mostLikelyScore.b}` : '– – –'}
            </div>
            <div className="stack" style={{ alignItems: 'center', gap: '0.25rem' }}>
              <span className="flag lg">{fra.flag}</span><strong>{fra.name}</strong>
            </div>
          </div>
          {marquee ? (
            <>
              <ProbabilityBar home={marquee.homeWin} draw={marquee.draw} away={marquee.awayWin} />
              <div className="row between" style={{ marginTop: '0.4rem', fontSize: '0.76rem' }}>
                <span className="muted">ARG {marquee.homeWin}%</span>
                <span className="muted">Draw {marquee.draw}%</span>
                <span className="muted">FRA {marquee.awayWin}%</span>
              </div>
              <Link to="/simulator" className="btn secondary" style={{ width: '100%', marginTop: '1.25rem' }}>
                Open simulator
              </Link>
            </>
          ) : (
            <p className="muted"><span className="spinner" /> Crunching simulations…</p>
          )}
        </div>

        {/* Your team */}
        <div className="card">
          <div className="section-title">Your team</div>
          {myCountry ? (
            <>
              <div className="row" style={{ gap: '0.6rem', marginBottom: '1rem' }}>
                <span className="flag lg">{myCountry.flag}</span>
                <div>
                  <strong style={{ fontSize: '1.1rem' }}>{myCountry.name}</strong>
                  <div className="muted">Formation {state.fantasy.formation} · FIFA #{myCountry.fifaRank}</div>
                </div>
              </div>
              {myOdds ? (
                <div className="grid cols-3">
                  <div className="stat"><div className="value primary">{myOdds.r16}%</div><div className="label">Reach R16</div></div>
                  <div className="stat"><div className="value">{myOdds.sf}%</div><div className="label">Reach SF</div></div>
                  <div className="stat"><div className="value gold">{myOdds.champion}%</div><div className="label">Champion</div></div>
                </div>
              ) : (
                <p className="muted"><span className="spinner" /> Estimating title odds…</p>
              )}
              <Link to="/my-team" className="btn secondary" style={{ width: '100%', marginTop: '1.25rem' }}>
                Manage lineup
              </Link>
            </>
          ) : (
            <div className="stack">
              <p className="muted">You haven't picked a nation yet. Choose one to manage its squad and
                track its title odds.</p>
              <Link to="/my-team" className="btn">Pick your country</Link>
            </div>
          )}
        </div>
      </div>

      {/* Title contenders */}
      <div className="card">
        <div className="section-title">Top contenders</div>
        {odds ? (
          <div className="grid cols-3">
            {odds.table.slice(0, 6).map((row) => {
              const c = COUNTRY_BY_CODE[row.code];
              return (
                <div key={row.code} className="list-row">
                  <span><span className="flag">{c.flag}</span> {c.name}</span>
                  <span className="mono muted">{row.champion}%</span>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="muted"><span className="spinner" /> Running tournament simulations…</p>
        )}
      </div>
    </div>
  );
}
