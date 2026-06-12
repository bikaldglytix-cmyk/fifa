import { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext.jsx';
import { getSquad } from '../data/squads.js';
import { COUNTRY_BY_CODE } from '../data/countries.js';
import { FORMATIONS, calcChemistry, slotFit } from '../engine/chemistry.js';
import TeamPicker from '../components/TeamPicker.jsx';

// Rows of slot indices to lay out on the pitch (GK at the bottom).
function pitchRows(formation) {
  const slots = FORMATIONS[formation];
  const def = [];
  const mid = [];
  const att = [];
  const DEF = ['GK', 'RB', 'LB', 'CB', 'RWB', 'LWB'];
  const MID = ['CDM', 'CM', 'CAM', 'RM', 'LM'];
  slots.forEach((s, i) => {
    if (s === 'GK') return;
    if (DEF.includes(s)) def.push(i);
    else if (MID.includes(s)) mid.push(i);
    else att.push(i);
  });
  const gk = slots.findIndex((s) => s === 'GK');
  return [att, mid, def, [gk]]; // top to bottom
}

export default function MyTeam() {
  const { state, selectCountry, setFantasy } = useApp();
  const { country, formation, lineup, captain } = state.fantasy;
  const [pickingSlot, setPickingSlot] = useState(null);

  const squad = useMemo(() => (country ? getSquad(country) : []), [country]);
  const byId = useMemo(() => Object.fromEntries(squad.map((p) => [p.id, p])), [squad]);

  const assignments = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 11; i++) arr[i] = lineup[i] ? byId[lineup[i]] : null;
    return arr;
  }, [lineup, byId]);

  const chem = useMemo(() => calcChemistry(assignments, formation), [assignments, formation]);

  const usedIds = new Set(Object.values(lineup));

  function assign(slotIndex, playerId) {
    const next = { ...lineup };
    // Remove this player from any other slot first.
    for (const k of Object.keys(next)) if (next[k] === playerId) delete next[k];
    next[slotIndex] = playerId;
    setFantasy({ lineup: next });
    setPickingSlot(null);
  }

  function clearSlot(slotIndex) {
    const next = { ...lineup };
    delete next[slotIndex];
    setFantasy({ lineup: next });
  }

  function autoFill() {
    const slots = FORMATIONS[formation];
    const pool = [...squad].sort((a, b) => b.rating - a.rating);
    const next = {};
    const taken = new Set();
    slots.forEach((slot, i) => {
      // Best available player for this slot by fit*rating.
      let best = null;
      let bestScore = -1;
      for (const p of pool) {
        if (taken.has(p.id)) continue;
        const score = slotFit(p, slot) * p.rating;
        if (score > bestScore) { bestScore = score; best = p; }
      }
      if (best) { next[i] = best.id; taken.add(best.id); }
    });
    const cap = Object.values(next).map((id) => byId[id]).sort((a, b) => b.rating - a.rating)[0];
    setFantasy({ lineup: next, captain: cap ? cap.id : null });
  }

  if (!country) {
    return (
      <div className="stack" style={{ gap: '1.5rem' }}>
        <div>
          <h1>My Team</h1>
          <p className="muted">Pick a nation to manage its fantasy squad and build your starting XI.</p>
        </div>
        <div className="card" style={{ maxWidth: 460 }}>
          <TeamPicker label="Choose your country" value={country} onChange={selectCountry} />
        </div>
      </div>
    );
  }

  const c = COUNTRY_BY_CODE[country];
  const rows = pitchRows(formation);
  const slots = FORMATIONS[formation];

  return (
    <div className="stack" style={{ gap: '1.5rem' }}>
      <div className="row between wrap">
        <div className="row" style={{ gap: '0.75rem' }}>
          <span className="flag lg">{c.flag}</span>
          <div>
            <h1 style={{ margin: 0 }}>{c.name}</h1>
            <span className="muted">FIFA #{c.fifaRank} · Elo {c.elo}</span>
          </div>
        </div>
        <div className="row wrap">
          <select value={formation} onChange={(e) => setFantasy({ formation: e.target.value })}>
            {Object.keys(FORMATIONS).map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <button className="btn secondary sm" onClick={autoFill}>Auto-fill best XI</button>
          <button className="btn secondary sm" onClick={() => selectCountry(null)}>Change country</button>
        </div>
      </div>

      <div className="grid cols-3">
        <div className="stat"><div className="value primary">{chem.chemistry}</div><div className="label">Chemistry</div></div>
        <div className="stat"><div className="value">{chem.tacticalFit}</div><div className="label">Tactical fit</div></div>
        <div className="stat"><div className="value gold">{chem.avgRating || '–'}</div><div className="label">Avg rating ({chem.filledCount}/11)</div></div>
      </div>

      <div className="grid cols-2">
        {/* Pitch */}
        <div className="card">
          <div className="section-title">Starting XI · {formation}</div>
          <div className="pitch">
            {rows.map((row, ri) => (
              <div className="pitch-row" key={ri}>
                {row.map((slotIndex) => {
                  const p = assignments[slotIndex];
                  const isCap = p && captain === p.id;
                  return (
                    <div
                      key={slotIndex}
                      className={`pitch-slot ${p ? 'filled' : ''} ${isCap ? 'captain' : ''}`}
                      onClick={() => setPickingSlot(slotIndex)}
                      title={p ? `Fit ${slotFit(p, slots[slotIndex])}%` : 'Tap to assign'}
                    >
                      <span className="pos">{slots[slotIndex]}{isCap ? ' (C)' : ''}</span>
                      {p ? (
                        <>
                          <span className="nm">{p.name.split(' ').slice(-1)[0]}</span>
                          <span className="rt">{p.rating}</span>
                        </>
                      ) : (
                        <span className="nm muted">+ add</span>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <p className="muted" style={{ fontSize: '0.78rem', marginBottom: 0 }}>
            Tap a slot to assign a player. Your XI feeds directly into the Match Simulator when you
            play as {c.name}.
          </p>
        </div>

        {/* Squad / picker */}
        <div className="card">
          <div className="section-title">
            {pickingSlot !== null ? `Assign ${slots[pickingSlot]} — tap a player` : 'Full squad (23)'}
          </div>
          {pickingSlot !== null && (
            <div className="row between" style={{ marginBottom: '0.5rem' }}>
              <span className="muted" style={{ fontSize: '0.8rem' }}>Best fits shown first</span>
              <button className="btn secondary sm" onClick={() => clearSlot(pickingSlot) || setPickingSlot(null)}>
                Clear slot
              </button>
            </div>
          )}
          <div className="stack" style={{ gap: '0.4rem', maxHeight: 460, overflowY: 'auto' }}>
            {orderedSquad(squad, pickingSlot, slots).map((p) => {
              const inXi = usedIds.has(p.id);
              const fit = pickingSlot !== null ? slotFit(p, slots[pickingSlot]) : null;
              return (
                <div key={p.id} className={`list-row ${inXi ? 'active' : ''}`}>
                  <div className="row" style={{ gap: '0.5rem' }}>
                    <span className="badge">{p.position}</span>
                    <span>{p.name}</span>
                    {captain === p.id && <span className="badge gold">C</span>}
                  </div>
                  <div className="row" style={{ gap: '0.5rem' }}>
                    <span className="badge" title="Recent form">Form {p.form}</span>
                    <span className="mono">{p.rating}</span>
                    {fit !== null && <span className="badge primary">{fit}%</span>}
                    {pickingSlot !== null ? (
                      <button className="btn sm" onClick={() => assign(pickingSlot, p.id)}>Pick</button>
                    ) : (
                      <button className="btn secondary sm" onClick={() => setFantasy({ captain: p.id })}>
                        {captain === p.id ? '★' : 'Make C'}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function orderedSquad(squad, pickingSlot, slots) {
  if (pickingSlot === null) {
    const order = { GK: 0, RB: 1, RWB: 1, CB: 2, LB: 3, LWB: 3, CDM: 4, CM: 5, CAM: 6, RM: 7, LM: 7, RW: 8, LW: 8, ST: 9, CF: 9 };
    return [...squad].sort((a, b) => (order[a.position] - order[b.position]) || b.rating - a.rating);
  }
  const slot = slots[pickingSlot];
  return [...squad].sort((a, b) => slotFit(b, slot) * b.rating - slotFit(a, slot) * a.rating);
}
