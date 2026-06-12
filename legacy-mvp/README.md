# FIFA 2026 World Cup Simulator — MVP

A fully functional MVP of the FIFA 2026 World Cup Simulator & Fantasy Prediction
League, built entirely in **JavaScript + React** (the architecture doc mentions
Python for the engine — this MVP implements the whole simulation engine in JS so
the entire app runs in the browser with no backend).

## What's included

| Feature | Where |
| --- | --- |
| **Monte Carlo match simulator** (Elo + Poisson goal model, win/draw/loss odds, scoreline distribution, goal timeline) | `Simulator` page · `src/engine/simulation.js` |
| **Full tournament simulator** (8 groups → R16 → QF → SF → Final, penalty shootouts, group tables, bracket view) | `Tournament` page · `src/engine/tournament.js` |
| **Monte Carlo title odds** (per-team stage probabilities over thousands of runs) | `Tournament` page |
| **Fantasy team builder** (pick a nation, choose formation, drag-free slot assignment, auto-fill best XI, chemistry & tactical-fit scoring, captain) | `My Team` page · `src/engine/chemistry.js` |
| **Lineup → simulation link** (your custom XI changes your team's expected goals) | `Simulator` applies `lineupStrength` |
| **Global leaderboard** (points from your activity vs AI managers) | `Leaderboard` page |
| **Home dashboard** (marquee match, your title odds, top contenders) | `Home` page |
| **Persistence** | `localStorage` via `src/context/AppContext.jsx` |
| **Dark-mode design system** (colours/typography from the spec) | `src/index.css` |

32 national teams with realistic Elo ratings; real headline players for the big
nations plus deterministically generated full 23-man squads for everyone.

## Run it

```bash
npm install
npm run dev      # opens http://localhost:5173
```

Other scripts:

```bash
npm run build    # production build to dist/
npm run preview  # preview the production build
```

## How the engine works

1. **Expected goals** — each team's Elo and best-XI rating combine into a power
   score; the differential is mapped through a logistic into per-side expected
   goals (lambda), anchored to a league-average baseline.
2. **Match** — goals are drawn from a Poisson distribution; running 1k–100k draws
   (Monte Carlo) yields win/draw/loss percentages and the modal scoreline.
3. **Tournament** — a full bracket is simulated round-robin groups first, then
   knockouts with Elo-weighted penalty shootouts on draws. Repeating thousands of
   tournaments produces each nation's stage-by-stage probabilities.

All randomness uses a seedable `mulberry32` PRNG, so seeded simulations are
reproducible.

## Project structure

```
src/
├── data/         countries.js (teams + groups), squads.js (squad generator)
├── engine/       simulation.js, tournament.js, chemistry.js
├── context/      AppContext.jsx (global state + localStorage)
├── components/   ProbabilityBar, TeamPicker
├── pages/        Home, Simulator, MyTeam, Tournament, Leaderboard
├── App.jsx       routing + top nav
└── main.jsx      entry
```

## Scope notes (MVP)

This MVP focuses on the platform's core differentiator — the simulation and
fantasy engine — running client-side. Auth, payments, real data ingestion,
WebSockets and the microservice/AWS backend from the full architecture doc are
intentionally out of scope here and would be the natural next phase.
