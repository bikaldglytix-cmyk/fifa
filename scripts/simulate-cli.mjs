/**
 * FIFA 2026 simulation CLI — runs the real engine against the real dataset.
 *
 *   npm run simulate                  → AI prediction + sim of Match 1 (Mexico–South Africa)
 *   npm run simulate -- --match 7     → any of the 72 scheduled group matches
 *   npm run simulate -- --pair ARG-FRA  → hypothetical pairing
 *   npm run simulate -- --tournament 1000 → full Monte Carlo (N runs)
 *
 * Requires: npm run setup (build packages — no DB needed for the CLI; it reads
 * the seed JSON directly).
 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const shared = require(join(ROOT, 'packages/shared/dist/index.js'));
const engine = require(join(ROOT, 'packages/sim-engine/dist/index.js'));

const DATA = join(ROOT, 'packages', 'db', 'data');
const load = (f) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));

// ---------------------------------------------------------------------------
// Assemble engine inputs from the seed dataset (same derivations as the seeder)
// ---------------------------------------------------------------------------
const countries = load('countries.json');
const squads = load('squads.json');
const matches = load('matches.json');
const h2hJson = load('h2h.json');
const form = load('recent-form.json');
const thirdPlaceTable = load('third-place-table.json');
const venues = load('venues.json');

let pid = 1;
const teams = new Map();
for (const c of countries) {
  const p24 = c.profile24mo;
  const played = Math.max(1, p24.played);
  const winRate = p24.wins / played;
  const eloPct = Math.max(0, Math.min(1, (c.eloRating - 1300) / (2160 - 1300)));
  const gfAvg = p24.gf / played;
  const gaAvg = p24.ga / played;
  const results = (form[c.code] ?? []).map((f) => (f.gf > f.ga ? 'W' : f.gf === f.ga ? 'D' : 'L')).join('');
  teams.set(c.code, {
    code: c.code,
    name: c.name,
    elo: c.eloRating,
    fifaRanking: c.fifaRanking,
    confederation: c.confederation,
    group: c.group,
    isHostNation: ['USA', 'MEX', 'CAN'].includes(c.code),
    manager: {
      name: c.coach,
      tacticalRating: Math.round(45 + eloPct * 50),
      adaptabilityRating: Math.round(40 + winRate * 55),
      substitutionRating: Math.round(45 + winRate * 40 + eloPct * 10),
      pressureHandling: Math.round(40 + eloPct * 35 + Math.min(15, (c.worldCupAppearances ?? 0) * 1.2)),
      knockoutRating: Math.round(40 + eloPct * 35 + (c.shootouts.taken > 0 ? (c.shootouts.won / c.shootouts.taken) * 20 : 8)),
      preferredStyle:
        gfAvg >= 1.9 && gaAvg <= 1.0 ? (c.eloRating >= 1900 ? 'possession' : 'high_press')
        : gfAvg < 1.25 && gaAvg <= 1.15 ? 'defensive_block'
        : gaAvg >= 1.4 && gfAvg >= 1.4 ? 'direct'
        : gfAvg >= 1.6 ? 'possession' : 'counter_attack',
    },
    squad: squads[c.code].players.map((p) => {
      const age = shared.ageOn(p.dateOfBirth, shared.TOURNAMENT_START);
      return {
        id: pid++,
        name: p.name,
        position: p.position,
        rating: shared.computePlayerRating({
          position: p.position, caps: p.caps, internationalGoals: p.goals,
          age, clubCountry: p.clubCountry, captain: p.captain,
        }),
        caps: p.caps,
        internationalGoals: p.goals,
        age,
        club: p.club,
        clubCountry: p.clubCountry,
        captain: p.captain,
        jerseyNumber: p.number,
        fitness: 100,
      };
    }),
    form: { results, score: engine.formScore(results) },
    shootouts: c.shootouts,
  });
}

const h2h = new Map();
for (const [key, v] of Object.entries(h2hJson)) {
  const [c1, c2] = key.split('-');
  h2h.set(key, {
    played: v.played, wins1: v.wins[c1] ?? 0, wins2: v.wins[c2] ?? 0, draws: v.draws,
    goals1: v.goals[c1] ?? 0, goals2: v.goals[c2] ?? 0, wcMeetings: v.wcMeetings ?? 0,
    lastMeeting: v.lastMeeting ? { date: v.lastMeeting.date, score: v.lastMeeting.score, tournament: v.lastMeeting.tournament } : null,
  });
}

const venueCountryByMatch = new Map(
  matches.map((m) => [m.matchNumber, venues[m.venueId].country === 'Mexico' ? 'MEX' : venues[m.venueId].country === 'Canada' ? 'CAN' : 'USA']),
);

const h2hFor = (a, b) => h2h.get([a, b].sort().join('-')) ?? null;
const pct = (x) => `${(x * 100).toFixed(1)}%`;
const bar = (x, w = 24) => '█'.repeat(Math.round(x * w)).padEnd(w, '░');

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const getArg = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : null;
};

if (args.includes('--tournament')) {
  const runs = Number(getArg('tournament') ?? 1000);
  console.log(`\n⚽ FIFA World Cup 2026 — Monte Carlo (${runs.toLocaleString()} tournaments)\n`);
  const inputs = { teams, schedule: matches, thirdPlaceTable, h2h, venueCountryByMatch };
  const t0 = Date.now();
  const mc = await engine.runMonteCarlo(inputs, { runs, seed: Date.now() >>> 0 });
  console.log(`completed in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
  console.log('CHAMPION PROBABILITIES');
  for (const sp of mc.stageProbabilities.slice(0, 15)) {
    const t = teams.get(sp.team);
    console.log(`  ${sp.team}  ${bar(sp.champion)} ${pct(sp.champion).padStart(6)}  (R16 ${pct(sp.reachR16)}, SF ${pct(sp.reachSF)})  ${t.name}`);
  }
  console.log(`\nMost likely final: ${mc.mostLikelyFinal.teams.join(' vs ')} (${pct(mc.mostLikelyFinal.probability)})`);
  console.log(`Upset champion (outside Elo top 8): ${pct(mc.upsetProbability)}`);
  if (mc.surpriseTeam) console.log(`Surprise package: ${teams.get(mc.surpriseTeam.team).name}`);
  console.log('\nGOLDEN BOOT (top scorer share | avg goals)');
  for (const g of mc.goldenBoot.slice(0, 8)) {
    console.log(`  ${pct(g.topScorerShare).padStart(6)} | ${String(g.avgGoals).padStart(4)}  ${g.name} (${g.team})`);
  }
  const sample = mc.sampleRun;
  console.log(`\nSample run: 🏆 ${teams.get(sample.champion).name} beat ${teams.get(sample.runnerUp).name} — bronze ${teams.get(sample.thirdPlace).name}`);
  process.exit(0);
}

let homeCode;
let awayCode;
let ctxStage = 'group';
let venueCountry = 'USA';
let matchLabel = '';

const pair = getArg('pair');
if (pair) {
  [homeCode, awayCode] = pair.toUpperCase().split('-');
  matchLabel = 'Hypothetical fixture';
} else {
  const n = Number(getArg('match') ?? 1);
  const m = matches.find((x) => x.matchNumber === n);
  if (!m) { console.error(`no match #${n}`); process.exit(1); }
  if (m.home.type !== 'team') { console.error(`match #${n} teams not decided yet — knockout slots resolve from results`); process.exit(1); }
  homeCode = m.home.code;
  awayCode = m.away.code;
  ctxStage = m.stage;
  venueCountry = venueCountryByMatch.get(n);
  const v = venues[m.venueId];
  matchLabel = `Match ${n} · ${v.name}, ${v.city} · ${m.localDate} ${m.localTime} (UTC${m.utcOffset})`;
}

const home = teams.get(homeCode);
const away = teams.get(awayCode);
if (!home || !away) { console.error('unknown team code'); process.exit(1); }

const ctx = { stage: ctxStage, matchNumber: 0, venueCountry, knockout: ctxStage !== 'group' };
const inputs = { home, away, ctx, h2h: h2hFor(homeCode, awayCode) };

console.log(`\n⚽ ${home.name} vs ${away.name}`);
if (matchLabel) console.log(`   ${matchLabel}`);
console.log(`   FIFA #${home.fifaRanking} (Elo ${home.elo}) vs FIFA #${away.fifaRanking} (Elo ${away.elo})`);
console.log(`   Coaches: ${home.manager.name} vs ${away.manager.name}\n`);

const p = engine.predictMatch(inputs);
console.log('AI PREDICTION');
console.log(`  ${home.code} win  ${bar(p.homeWin)} ${pct(p.homeWin)}`);
console.log(`  draw     ${bar(p.draw)} ${pct(p.draw)}`);
console.log(`  ${away.code} win  ${bar(p.awayWin)} ${pct(p.awayWin)}`);
console.log(`  expected goals ${p.expectedHomeGoals} – ${p.expectedAwayGoals} · most likely ${p.mostLikelyScore.home}-${p.mostLikelyScore.away} (${pct(p.mostLikelyScore.probability)}) · confidence ${p.confidence}%`);
console.log(`  likely scorers: ${p.likelyScorers.slice(0, 4).map((s) => `${s.name} ${pct(s.probability)}`).join(', ')}`);
console.log('\nINSIGHTS');
for (const i of p.insights) console.log(`  • ${i}`);

const seed = (Date.now() ^ 0x5eed) >>> 0;
const r = engine.simulateMatch(inputs, { rng: engine.mulberry32(seed), knockout: ctx.knockout });
console.log(`\nONE SIMULATION (seed ${seed})`);
console.log(`  FT ${home.code} ${r.homeScore} – ${r.awayScore} ${away.code}${r.wentToPenalties ? ` (pens ${r.penalties.home}-${r.penalties.away})` : r.wentToExtraTime ? ' (aet)' : ''}`);
for (const ev of r.events.filter((e) => ['goal', 'penalty_goal', 'own_goal', 'red_card'].includes(e.type))) {
  const tag = ev.type === 'penalty_goal' ? ' (pen)' : ev.type === 'own_goal' ? ' (og)' : ev.type === 'red_card' ? ' 🟥' : '';
  console.log(`   ${String(ev.minute).padStart(3)}' ${ev.team} ${ev.playerName}${tag}${ev.assistPlayerName ? ` (assist ${ev.assistPlayerName})` : ''}`);
}
console.log(`  possession ${r.stats.home.possession}% / ${r.stats.away.possession}% · shots ${r.stats.home.shots}/${r.stats.away.shots} · xG ${r.stats.home.xG}/${r.stats.away.xG}`);
console.log(`  MOTM: ${r.manOfTheMatch?.name} (${r.manOfTheMatch?.team})\n`);
