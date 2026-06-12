/**
 * FIFA 2026 World Cup — research data parser.
 *
 * Converts raw downloaded sources (research/raw/*) into the canonical seed JSON
 * consumed by packages/db (packages/db/data/*.json).
 *
 * Sources:
 *  - Wikipedia wikitext: 12 group pages, knockout-stage page, squads page,
 *    third-place allocation template (FIFA Annex C, all 495 combinations),
 *    FIFA rankings Lua data module (1 April 2026 release).
 *  - eloratings.net World.tsv (live World Football Elo Ratings).
 *  - martj42/international_results (results.csv + shootouts.csv) for
 *    head-to-head records, recent form and penalty-shootout priors.
 *
 * The script is intentionally strict: any unmapped team/venue aborts the run.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const RAW = join(ROOT, 'raw');
const OUT = join(ROOT, '..', 'packages', 'db', 'data');
mkdirSync(OUT, { recursive: true });

const read = (f) => readFileSync(join(RAW, f), 'utf8');
const writeJson = (name, data) => {
  writeFileSync(join(OUT, name), JSON.stringify(data, null, 2) + '\n', 'utf8');
  console.log(`  wrote ${name}`);
};
const fail = (msg) => {
  console.error(`FATAL: ${msg}`);
  process.exit(1);
};

// ---------------------------------------------------------------------------
// Team registry: FIFA code -> canonical name, flagcdn ISO2, eloratings code,
// and aliases as they appear across sources (results.csv, rankings, squads).
// ---------------------------------------------------------------------------
const TEAMS = {
  MEX: { name: 'Mexico', iso2: 'mx', elo: 'MX', aliases: [] },
  RSA: { name: 'South Africa', iso2: 'za', elo: 'ZA', aliases: [] },
  KOR: { name: 'South Korea', iso2: 'kr', elo: 'KR', aliases: ['Korea Republic'] },
  CZE: { name: 'Czechia', iso2: 'cz', elo: 'CZ', aliases: ['Czech Republic'] },
  CAN: { name: 'Canada', iso2: 'ca', elo: 'CA', aliases: [] },
  BIH: { name: 'Bosnia and Herzegovina', iso2: 'ba', elo: 'BA', aliases: ['Bosnia-Herzegovina', 'Bosnia'] },
  QAT: { name: 'Qatar', iso2: 'qa', elo: 'QA', aliases: [] },
  SUI: { name: 'Switzerland', iso2: 'ch', elo: 'CH', aliases: [] },
  BRA: { name: 'Brazil', iso2: 'br', elo: 'BR', aliases: [] },
  MAR: { name: 'Morocco', iso2: 'ma', elo: 'MA', aliases: [] },
  HAI: { name: 'Haiti', iso2: 'ht', elo: 'HT', aliases: [] },
  SCO: { name: 'Scotland', iso2: 'gb-sct', elo: 'SC', aliases: [] },
  USA: { name: 'United States', iso2: 'us', elo: 'US', aliases: ['USA', 'United States of America'] },
  PAR: { name: 'Paraguay', iso2: 'py', elo: 'PY', aliases: [] },
  AUS: { name: 'Australia', iso2: 'au', elo: 'AU', aliases: [] },
  TUR: { name: 'Türkiye', iso2: 'tr', elo: 'TR', aliases: ['Turkey', 'Turkiye'] },
  GER: { name: 'Germany', iso2: 'de', elo: 'DE', aliases: [] },
  CUW: { name: 'Curaçao', iso2: 'cw', elo: 'CW', aliases: ['Curacao'] },
  CIV: { name: 'Ivory Coast', iso2: 'ci', elo: 'CI', aliases: ["Côte d'Ivoire", "Cote d'Ivoire"] },
  ECU: { name: 'Ecuador', iso2: 'ec', elo: 'EC', aliases: [] },
  NED: { name: 'Netherlands', iso2: 'nl', elo: 'NL', aliases: ['Holland'] },
  JPN: { name: 'Japan', iso2: 'jp', elo: 'JP', aliases: [] },
  SWE: { name: 'Sweden', iso2: 'se', elo: 'SE', aliases: [] },
  TUN: { name: 'Tunisia', iso2: 'tn', elo: 'TN', aliases: [] },
  BEL: { name: 'Belgium', iso2: 'be', elo: 'BE', aliases: [] },
  EGY: { name: 'Egypt', iso2: 'eg', elo: 'EG', aliases: [] },
  IRN: { name: 'Iran', iso2: 'ir', elo: 'IR', aliases: ['IR Iran'] },
  NZL: { name: 'New Zealand', iso2: 'nz', elo: 'NZ', aliases: ['Aotearoa New Zealand'] },
  ESP: { name: 'Spain', iso2: 'es', elo: 'ES', aliases: [] },
  CPV: { name: 'Cape Verde', iso2: 'cv', elo: 'CV', aliases: ['Cabo Verde'] },
  KSA: { name: 'Saudi Arabia', iso2: 'sa', elo: 'SA', aliases: [] },
  URU: { name: 'Uruguay', iso2: 'uy', elo: 'UY', aliases: [] },
  FRA: { name: 'France', iso2: 'fr', elo: 'FR', aliases: [] },
  SEN: { name: 'Senegal', iso2: 'sn', elo: 'SN', aliases: [] },
  IRQ: { name: 'Iraq', iso2: 'iq', elo: 'IQ', aliases: [] },
  NOR: { name: 'Norway', iso2: 'no', elo: 'NO', aliases: [] },
  ARG: { name: 'Argentina', iso2: 'ar', elo: 'AR', aliases: [] },
  ALG: { name: 'Algeria', iso2: 'dz', elo: 'DZ', aliases: [] },
  AUT: { name: 'Austria', iso2: 'at', elo: 'AT', aliases: [] },
  JOR: { name: 'Jordan', iso2: 'jo', elo: 'JO', aliases: [] },
  POR: { name: 'Portugal', iso2: 'pt', elo: 'PT', aliases: [] },
  COD: { name: 'DR Congo', iso2: 'cd', elo: 'CD', aliases: ['Congo DR', 'Democratic Republic of the Congo'] },
  UZB: { name: 'Uzbekistan', iso2: 'uz', elo: 'UZ', aliases: [] },
  COL: { name: 'Colombia', iso2: 'co', elo: 'CO', aliases: [] },
  ENG: { name: 'England', iso2: 'gb-eng', elo: 'EN', aliases: [] },
  CRO: { name: 'Croatia', iso2: 'hr', elo: 'HR', aliases: [] },
  GHA: { name: 'Ghana', iso2: 'gh', elo: 'GH', aliases: [] },
  PAN: { name: 'Panama', iso2: 'pa', elo: 'PA', aliases: [] },
};

const normalize = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const nameToCode = new Map();
for (const [code, t] of Object.entries(TEAMS)) {
  nameToCode.set(normalize(t.name), code);
  for (const a of t.aliases) nameToCode.set(normalize(a), code);
}
const codeFromName = (name, ctx) => {
  const c = nameToCode.get(normalize(name));
  if (!c) fail(`unmapped team name "${name}" (${ctx})`);
  return c;
};

const CONFEDS = [
  ['CONCACAF', 'CONCACAF'],
  ['Confederation of African Football', 'CAF'],
  ['CAF', 'CAF'],
  ['Asian Football Confederation', 'AFC'],
  ['AFC', 'AFC'],
  ['UEFA', 'UEFA'],
  ['CONMEBOL', 'CONMEBOL'],
  ['Oceania Football Confederation', 'OFC'],
  ['OFC', 'OFC'],
];

// ---------------------------------------------------------------------------
// Venues: stadium link name (as in wikitext) -> canonical venue facts.
// Capacities per FIFA / venue operators (WC configuration where announced).
// ---------------------------------------------------------------------------
const VENUES = {
  'Estadio Azteca': { city: 'Mexico City', country: 'Mexico', capacity: 87523, tz: 'America/Mexico_City' },
  'Estadio Akron': { city: 'Zapopan', country: 'Mexico', capacity: 49813, tz: 'America/Mexico_City' },
  'Estadio BBVA': { city: 'Guadalupe', country: 'Mexico', capacity: 53500, tz: 'America/Monterrey' },
  'BMO Field': { city: 'Toronto', country: 'Canada', capacity: 45736, tz: 'America/Toronto' },
  'BC Place': { city: 'Vancouver', country: 'Canada', capacity: 54500, tz: 'America/Vancouver' },
  'MetLife Stadium': { city: 'East Rutherford', country: 'United States', capacity: 82500, tz: 'America/New_York' },
  'SoFi Stadium': { city: 'Inglewood', country: 'United States', capacity: 70240, tz: 'America/Los_Angeles' },
  'AT&T Stadium': { city: 'Arlington', country: 'United States', capacity: 80000, tz: 'America/Chicago' },
  'NRG Stadium': { city: 'Houston', country: 'United States', capacity: 72220, tz: 'America/Chicago' },
  'Mercedes-Benz Stadium': { city: 'Atlanta', country: 'United States', capacity: 71000, tz: 'America/New_York' },
  'Hard Rock Stadium': { city: 'Miami Gardens', country: 'United States', capacity: 64767, tz: 'America/New_York' },
  'Lincoln Financial Field': { city: 'Philadelphia', country: 'United States', capacity: 69796, tz: 'America/New_York' },
  "Levi's Stadium": { city: 'Santa Clara', country: 'United States', capacity: 68500, tz: 'America/Los_Angeles' },
  'Lumen Field': { city: 'Seattle', country: 'United States', capacity: 68740, tz: 'America/Los_Angeles' },
  'Arrowhead Stadium': { city: 'Kansas City', country: 'United States', capacity: 76416, tz: 'America/Chicago' },
  'Gillette Stadium': { city: 'Foxborough', country: 'United States', capacity: 64628, tz: 'America/New_York' },
};
// FIFA tournament (sponsor-neutral) names -> real venue
const VENUE_ALIASES = {
  'Estadio Ciudad de México': 'Estadio Azteca',
  'Mexico City Stadium': 'Estadio Azteca',
  'Estadio Banorte': 'Estadio Azteca',
  'Estadio Guadalajara': 'Estadio Akron',
  'Guadalajara Stadium': 'Estadio Akron',
  'Estadio Monterrey': 'Estadio BBVA',
  'Monterrey Stadium': 'Estadio BBVA',
  'Toronto Stadium': 'BMO Field',
  'Vancouver Stadium': 'BC Place',
  'BC Place Vancouver': 'BC Place',
  'New York New Jersey Stadium': 'MetLife Stadium',
  'Los Angeles Stadium': 'SoFi Stadium',
  'Dallas Stadium': 'AT&T Stadium',
  'Houston Stadium': 'NRG Stadium',
  'Atlanta Stadium': 'Mercedes-Benz Stadium',
  'Miami Stadium': 'Hard Rock Stadium',
  'Philadelphia Stadium': 'Lincoln Financial Field',
  'San Francisco Bay Area Stadium': "Levi's Stadium",
  'Seattle Stadium': 'Lumen Field',
  'Kansas City Stadium': 'Arrowhead Stadium',
  'Boston Stadium': 'Gillette Stadium',
};
const resolveVenue = (target, display) => {
  for (const cand of [target, display]) {
    if (!cand) continue;
    if (VENUES[cand]) return cand;
    if (VENUE_ALIASES[cand]) return VENUE_ALIASES[cand];
  }
  return null;
};
const venueId = (n) => normalize(n).replace(/ /g, '-');

// ---------------------------------------------------------------------------
// Wikitext helpers
// ---------------------------------------------------------------------------

/** Extract every `{{#invoke:football box|main ...}}` block via brace counting. */
function footballBoxes(wiki) {
  const blocks = [];
  const needle = '{{#invoke:football box|main';
  let idx = 0;
  while ((idx = wiki.indexOf(needle, idx)) !== -1) {
    let depth = 0;
    let end = idx;
    for (let i = idx; i < wiki.length - 1; i++) {
      if (wiki[i] === '{' && wiki[i + 1] === '{') { depth++; i++; }
      else if (wiki[i] === '}' && wiki[i + 1] === '}') {
        depth--; i++;
        if (depth === 0) { end = i + 1; break; }
      }
    }
    blocks.push(wiki.slice(idx, end));
    idx = end;
  }
  return blocks;
}

const stripComments = (s) => s.replace(/<!--[\s\S]*?-->/g, '');
const stripTemplates = (s) => {
  // remove {{...}} (non-nested is enough for our cells, applied repeatedly)
  let prev;
  do { prev = s; s = s.replace(/\{\{[^{}]*\}\}/g, ''); } while (s !== prev);
  return s;
};
const linkDisplay = (link) => {
  const m = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(link);
  return m ? (m[2] ?? m[1]).trim() : null;
};

function parseTeamSlot(raw) {
  const cleaned = stripComments(raw).trim();
  const flag = /\{\{#invoke:flag\|fb(?:-rt)?\|([A-Z]{3})/.exec(cleaned);
  if (flag) return { type: 'team', code: flag[1] };
  const text = stripTemplates(cleaned).replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/g, '$1').trim();
  let m;
  if ((m = /^Winner Group ([A-L])$/.exec(text))) return { type: 'groupWinner', group: m[1] };
  if ((m = /^Runner-up Group ([A-L])$/.exec(text))) return { type: 'groupRunnerUp', group: m[1] };
  if ((m = /^3rd Group ([A-L](?:\/[A-L])+)$/.exec(text))) return { type: 'thirdPlace', allowedGroups: m[1].split('/') };
  if ((m = /^Winner Match (\d+)$/.exec(text))) return { type: 'matchWinner', match: Number(m[1]) };
  if ((m = /^Loser Match (\d+)$/.exec(text))) return { type: 'matchLoser', match: Number(m[1]) };
  fail(`unparseable team slot "${text}"`);
}

function parseFootballBox(block, ctx) {
  const date = /\|date=\{\{Start date\|(\d{4})\|(\d{1,2})\|(\d{1,2})\}\}/.exec(block);
  if (!date) fail(`no date in football box (${ctx})`);
  const timeM = /\|time=([^\n]+)/.exec(block);
  if (!timeM) fail(`no time in football box (${ctx})`);
  const t = timeM[1];
  const clock = /(\d{1,2}):(\d{2})\s*(?:&nbsp;|\s)*([ap])\.?m\.?/i.exec(t);
  if (!clock) fail(`unparseable time "${t}" (${ctx})`);
  let hour = Number(clock[1]) % 12;
  if (clock[3].toLowerCase() === 'p') hour += 12;
  const minute = Number(clock[2]);
  const off = /UTC[−–-](\d{1,2})/.exec(t);
  if (!off) fail(`no UTC offset in "${t}" (${ctx})`);
  const offsetHours = Number(off[1]); // western hemisphere: all negative offsets
  const utc = new Date(Date.UTC(+date[1], +date[2] - 1, +date[3], hour + offsetHours, minute));

  const team1 = /\|team1=([^\n]+)/.exec(block);
  const team2 = /\|team2=([^\n]+)/.exec(block);
  const matchNo = /\|score=\{\{score link\|[^|]*\|Match (\d+)(?:\|[^}]*)?\}\}/.exec(block);
  const stadiumLine = /\|stadium=([^\n]+)/.exec(block);
  if (!team1 || !team2 || !matchNo || !stadiumLine) fail(`incomplete football box (${ctx})`);

  const links = [...stadiumLine[1].matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)];
  if (links.length < 2) fail(`stadium line "${stadiumLine[1]}" lacks stadium+city links (${ctx})`);
  const stadium = resolveVenue(links[0][1].trim(), (links[0][2] ?? links[0][1]).trim());
  if (!stadium) fail(`unknown venue "${links[0][1]}" (${ctx})`);

  return {
    matchNumber: Number(matchNo[1]),
    kickoffUtc: utc.toISOString(),
    localDate: `${date[1]}-${String(date[2]).padStart(2, '0')}-${String(date[3]).padStart(2, '0')}`,
    localTime: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    utcOffset: -offsetHours,
    venueId: venueId(stadium),
    home: parseTeamSlot(team1[1]),
    away: parseTeamSlot(team2[1]),
  };
}

// ---------------------------------------------------------------------------
// 1. Group pages -> teams (pot/draw position/confed/Nov-2025 seed rank) + 72 matches
// ---------------------------------------------------------------------------
console.log('Parsing group pages...');
const groups = {}; // letter -> [{code, drawPos, pot, confed, seedRank, appearances}]
const matches = []; // all 104

for (const letter of 'ABCDEFGHIJKL') {
  const wiki = read(`2026_FIFA_World_Cup_Group_${letter}.wiki`);
  const teams = [];
  const rowRe = new RegExp(`^\\|\\s*${letter}(\\d)\\s*\\|\\|(.+)$`, 'gm');
  let m;
  while ((m = rowRe.exec(wiki))) {
    const drawPos = Number(m[1]);
    const row = m[2];
    const flag = /\{\{#invoke:flag\|fb\|([A-Z]{3})\}\}/.exec(row);
    if (!flag) fail(`no flag in Group ${letter} row ${drawPos}`);
    const code = flag[1];
    if (!TEAMS[code]) fail(`unknown FIFA code ${code} in Group ${letter}`);
    // split row into top-level cells on `||` (ignoring pipes inside {{..}} / [[..]])
    const cells = (() => {
      const out = [];
      let cur = '', dc = 0, ds = 0;
      for (let ci = 0; ci < row.length; ci++) {
        const two = row.slice(ci, ci + 2);
        if (two === '{{') { dc++; cur += two; ci++; continue; }
        if (two === '}}') { dc--; cur += two; ci++; continue; }
        if (two === '[[') { ds++; cur += two; ci++; continue; }
        if (two === ']]') { ds--; cur += two; ci++; continue; }
        if (two === '||' && dc === 0 && ds === 0) { out.push(cur); cur = ''; ci++; continue; }
        cur += row[ci];
      }
      out.push(cur);
      return out.map((c) => c.trim());
    })();
    const flagIdx = cells.findIndex((c) => c.includes(`{{#invoke:flag|fb|${code}}}`));
    if (flagIdx < 0) fail(`no flag cell for ${code}`);
    const potCell = stripTemplates(cells[flagIdx + 1] ?? '').trim();
    if (!/^\d$/.test(potCell)) fail(`no pot for ${code} (cell "${potCell}")`);
    const pot = Number(potCell);
    let confed = null;
    for (const [needle, name] of CONFEDS) {
      if (row.includes(`[[${needle}]]`) || row.includes(`[[${needle}|`)) { confed = name; break; }
    }
    if (!confed) fail(`no confederation for ${code}`);
    const appM = /\|\|\s*(\d+)(?:st|nd|rd|th)\s*\|\|/.exec(row);
    // seed rank = November 2025 FIFA ranking (used for the draw): last integer cell
    const plain = cells.map((c) => stripTemplates(c).trim());
    let seedRank = null;
    for (let i = plain.length - 1; i >= 0; i--) {
      if (/^\d{1,3}$/.test(plain[i])) { seedRank = Number(plain[i]); break; }
    }
    teams.push({ code, drawPos, pot, confed, seedRank, appearances: appM ? Number(appM[1]) : null });
  }
  if (teams.length !== 4) fail(`Group ${letter} has ${teams.length} teams`);
  groups[letter] = teams.sort((a, b) => a.drawPos - b.drawPos);

  for (const block of footballBoxes(wiki)) {
    const parsed = parseFootballBox(block, `Group ${letter}`);
    if (parsed.home.type !== 'team' || parsed.away.type !== 'team') fail(`group match without concrete teams (Group ${letter})`);
    matches.push({ ...parsed, stage: 'group', group: letter });
  }
}

// ---------------------------------------------------------------------------
// 2. Knockout page -> 32 matches with slot descriptors
// ---------------------------------------------------------------------------
console.log('Parsing knockout stage...');
{
  const wiki = read('2026_FIFA_World_Cup_knockout_stage.wiki') + '\n' + read('2026_FIFA_World_Cup_final.wiki');
  const stageFor = (n) => {
    if (n >= 73 && n <= 88) return 'round32';
    if (n >= 89 && n <= 96) return 'round16';
    if (n >= 97 && n <= 100) return 'quarterfinal';
    if (n >= 101 && n <= 102) return 'semifinal';
    if (n === 103) return 'third_place';
    if (n === 104) return 'final';
    fail(`knockout match number out of range: ${n}`);
  };
  for (const block of footballBoxes(wiki)) {
    const parsed = parseFootballBox(block, 'knockout');
    matches.push({ ...parsed, stage: stageFor(parsed.matchNumber), group: null });
  }
}

matches.sort((a, b) => a.matchNumber - b.matchNumber);
if (matches.length !== 104) fail(`expected 104 matches, got ${matches.length}`);
const nums = new Set(matches.map((x) => x.matchNumber));
if (nums.size !== 104 || ![...nums].every((n) => n >= 1 && n <= 104)) fail('match numbers not 1..104');

// matchday for group matches: per group sorted by kickoff, pairs of two; each
// team must appear exactly once per matchday.
for (const letter of 'ABCDEFGHIJKL') {
  const gms = matches.filter((x) => x.group === letter).sort((a, b) => a.kickoffUtc.localeCompare(b.kickoffUtc));
  if (gms.length !== 6) fail(`Group ${letter} has ${gms.length} matches`);
  gms.forEach((gm, i) => { gm.matchday = Math.floor(i / 2) + 1; });
  for (let md = 1; md <= 3; md++) {
    const codes = gms.filter((x) => x.matchday === md).flatMap((x) => [x.home.code, x.away.code]);
    if (new Set(codes).size !== 4) fail(`Group ${letter} MD${md}: teams ${codes.join(',')}`);
  }
}

// ---------------------------------------------------------------------------
// 3. Squads page -> 48 squads (coach + players)
// ---------------------------------------------------------------------------
console.log('Parsing squads...');
const squads = {}; // code -> { coach, coachNationality, players: [...] }
{
  const wiki = read('2026_FIFA_World_Cup_squads.wiki');
  const groupSections = wiki.split(/\n==Group [A-L]==\n/).slice(1);
  if (groupSections.length !== 12) fail(`squads page has ${groupSections.length} group sections`);
  for (let section of groupSections) {
    // cut at the next top-level (==Foo==) heading, e.g. ==Statistics==
    const next = section.search(/\n==[^=]/);
    if (next !== -1) section = section.slice(0, next);
    const countrySections = section.split(/\n===(.+?)===\n/).slice(1);
    for (let i = 0; i < countrySections.length; i += 2) {
      const countryName = countrySections[i].trim();
      if (!countrySections[i + 1].includes('{{nat fs g start}}')) continue;
      const body = stripComments(countrySections[i + 1]);
      const code = codeFromName(countryName, 'squads section');
      const coachM = /Coach:\s*(?:\{\{(?:flagicon\|([A-Za-z]{3})(?:\|[^}]*)?|#invoke:flag\|icon\|([A-Za-z]{3})(?:\|[^}]*)?)\}\}\s*)?\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/.exec(body);
      if (!coachM) fail(`no coach for ${countryName}`);
      const players = [];
      const playerRe = /\{\{nat fs g player\|(.+)\}\}/g;
      let pm;
      while ((pm = playerRe.exec(body))) {
        const params = {};
        // split top-level pipes (values may contain [[..|..]] links and {{..}} templates)
        let depthCurly = 0, depthSquare = 0, cur = '', parts = [];
        for (let ci = 0; ci < pm[1].length; ci++) {
          const ch = pm[1][ci];
          const two = pm[1].slice(ci, ci + 2);
          if (two === '{{') { depthCurly++; cur += two; ci++; continue; }
          if (two === '}}') { depthCurly--; cur += two; ci++; continue; }
          if (two === '[[') { depthSquare++; cur += two; ci++; continue; }
          if (two === ']]') { depthSquare--; cur += two; ci++; continue; }
          if (ch === '|' && depthCurly === 0 && depthSquare === 0) { parts.push(cur); cur = ''; continue; }
          cur += ch;
        }
        parts.push(cur);
        for (const part of parts) {
          const eq = part.indexOf('=');
          if (eq > 0) params[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
        }
        const dob = /\{\{birth date and age2\|\d{4}\|\d{1,2}\|\d{1,2}\|(\d{4})\|(\d{1,2})\|(\d{1,2})(?:\|[^}]*)?\}\}/i.exec(params.age ?? '');
        if (!dob) fail(`no DOB for player in ${countryName}: ${pm[1].slice(0, 80)}`);
        const name = linkDisplay(params.name) ?? stripTemplates(params.name ?? '').trim();
        const clubRaw = params.club ?? '';
        const club = linkDisplay(clubRaw) ?? (stripTemplates(clubRaw).trim() || 'Unattached');
        players.push({
          number: Number(params.no),
          position: params.pos, // GK | DF | MF | FW (official FIFA squad list positions)
          name,
          dateOfBirth: `${dob[1]}-${String(dob[2]).padStart(2, '0')}-${String(dob[3]).padStart(2, '0')}`,
          caps: Number(params.caps ?? 0),
          goals: Number(params.goals ?? 0),
          club,
          clubCountry: (params.clubnat ?? '').trim() || null,
          captain: /captain/i.test(params.other ?? ''),
        });
      }
      if (players.length < 23 || players.length > 26) fail(`${countryName}: squad of ${players.length}`);
      squads[code] = {
        coach: (coachM[4] ?? coachM[3]).trim(),
        coachNationality: (coachM[1] ?? coachM[2]) ? (coachM[1] ?? coachM[2]).toUpperCase() : code,
        players,
      };
    }
  }
  const missing = Object.keys(TEAMS).filter((c) => !squads[c]);
  if (missing.length) fail(`missing squads for ${missing.join(',')}`);
}

// ---------------------------------------------------------------------------
// 4. FIFA rankings (Lua module, 1 April 2026)
// ---------------------------------------------------------------------------
console.log('Parsing FIFA rankings...');
const fifaRankings = []; // { name, rank, movement, points, code? }
{
  const lua = read('fifa_rankings_module.lua');
  const re = /\{\s*"([^"]+)",\s*(\d+),\s*(-?\d+),\s*([\d.]+)\s*\}/g;
  let m;
  while ((m = re.exec(lua))) {
    const code = nameToCode.get(normalize(m[1])) ?? null;
    fifaRankings.push({ name: m[1], rank: Number(m[2]), movement: Number(m[3]), points: Number(m[4]), code });
  }
  if (fifaRankings.length < 200) fail(`only ${fifaRankings.length} ranking rows`);
  const covered = new Set(fifaRankings.filter((r) => r.code).map((r) => r.code));
  const missing = Object.keys(TEAMS).filter((c) => !covered.has(c));
  if (missing.length) fail(`rankings missing for ${missing.join(',')}`);
}
const rankByCode = new Map(fifaRankings.filter((r) => r.code).map((r) => [r.code, r]));

// ---------------------------------------------------------------------------
// 5. Elo ratings (eloratings.net World.tsv)
// ---------------------------------------------------------------------------
console.log('Parsing Elo ratings...');
const eloByCode = new Map(); // FIFA code -> { rating, rank }
{
  const eloToFifa = new Map(Object.entries(TEAMS).map(([code, t]) => [t.elo, code]));
  for (const line of read('elo_world.tsv').split('\n')) {
    const f = line.split('\t');
    if (f.length < 4) continue;
    const fifa = eloToFifa.get(f[2]);
    if (fifa) eloByCode.set(fifa, { rating: Number(f[3]), rank: Number(f[0]) });
  }
  const missing = Object.keys(TEAMS).filter((c) => !eloByCode.has(c));
  if (missing.length) fail(`elo missing for ${missing.join(',')}`);
}

// ---------------------------------------------------------------------------
// 6. Third-place allocation (FIFA Annex C — 495 combinations)
// ---------------------------------------------------------------------------
console.log('Parsing third-place allocation table...');
const thirdPlaceTable = {}; // "CDEFGHIJ..." (8 sorted letters) -> { A: 'E', B: 'J', D: ..., E, G, I, K, L }
{
  const wiki = read('third_place_table.wiki');
  const SLOTS = ['A', 'B', 'D', 'E', 'G', 'I', 'K', 'L']; // group winners hosting a 3rd-placed team
  const rowRe = /!\s*scope="row"\s*\|\s*(\d+)\s*\n([\s\S]*?)(?=\n!\s*scope="row"|\n\|\})/g;
  let m;
  while ((m = rowRe.exec(wiki))) {
    const body = m[2].replace(/!\s*rowspan="495"\s*\|/g, '').replace(/\n/g, ' ');
    const cells = body
      .split(/\|\|?/)
      .map((c) => c.replace(/'''/g, '').trim())
      .filter((c, i, arr) => !(i === 0 && c === ''));
    const present = [];
    let ci = 0;
    for (const letter of 'ABCDEFGHIJKL') {
      const cell = cells[ci++] ?? '';
      if (cell === letter) present.push(letter);
      else if (cell !== '') fail(`combo row ${m[1]}: expected "${letter}" or empty, got "${cell}"`);
    }
    const assignments = {};
    for (const slot of SLOTS) {
      const cell = (cells[ci++] ?? '').trim();
      const am = /^3([A-L])$/.exec(cell);
      if (!am) fail(`combo row ${m[1]}: bad assignment cell "${cell}"`);
      assignments[slot] = am[1];
    }
    if (present.length !== 8) fail(`combo row ${m[1]}: ${present.length} groups present`);
    thirdPlaceTable[present.join('')] = assignments;
  }
  const n = Object.keys(thirdPlaceTable).length;
  if (n !== 495) fail(`expected 495 third-place combinations, got ${n}`);
}

// ---------------------------------------------------------------------------
// 7. Historical results -> H2H, recent form, 24-month team profile
// ---------------------------------------------------------------------------
console.log('Computing head-to-head and form from 47k historical results...');
const CUTOFF = '2026-06-11';
const h2h = {}; // "AAA-BBB" sorted -> { played, wins: {AAA: n, BBB: n}, draws, goals: {...}, lastMeeting }
const recentByTeam = {}; // code -> matches (desc) [{date, opponent, gf, ga, tournament, home}]
const profileWindow = {}; // code -> stats since 2024-06-11
{
  const csv = read('intl_results.csv');
  const lines = csv.split('\n');
  // results.csv columns: date,home_team,away_team,home_score,away_score,tournament,city,country,neutral
  const splitCsv = (line) => {
    const out = [];
    let cur = '', inQ = false;
    for (const ch of line) {
      if (ch === '"') inQ = !inQ;
      else if (ch === ',' && !inQ) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const [date, home, away, hs, as, tournament] = splitCsv(line);
    if (date >= CUTOFF) continue;
    const hCode = nameToCode.get(normalize(home));
    const aCode = nameToCode.get(normalize(away));
    if (hs === '' || as === '' || hs === 'NA') continue;
    const hg = Number(hs), ag = Number(as);

    for (const [code, gf, ga, opp, isHome] of [
      [hCode, hg, ag, away, true],
      [aCode, ag, hg, home, false],
    ]) {
      if (!code) continue;
      (recentByTeam[code] ??= []).push({ date, opponent: opp, gf, ga, tournament, home: isHome });
      if (date >= '2024-06-11') {
        const p = (profileWindow[code] ??= { played: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0, cleanSheets: 0 });
        p.played++;
        p.gf += gf; p.ga += ga;
        if (gf > ga) p.wins++; else if (gf === ga) p.draws++; else p.losses++;
        if (ga === 0) p.cleanSheets++;
      }
    }
    if (hCode && aCode) {
      const key = [hCode, aCode].sort().join('-');
      const rec = (h2h[key] ??= {
        played: 0, draws: 0,
        wins: { [key.slice(0, 3)]: 0, [key.slice(4)]: 0 },
        goals: { [key.slice(0, 3)]: 0, [key.slice(4)]: 0 },
        wcMeetings: 0,
        lastMeeting: null,
      });
      rec.played++;
      rec.goals[hCode] += hg;
      rec.goals[aCode] += ag;
      if (hg > ag) rec.wins[hCode]++; else if (ag > hg) rec.wins[aCode]++; else rec.draws++;
      if (tournament === 'FIFA World Cup') rec.wcMeetings++;
      rec.lastMeeting = { date, home, away, score: `${hg}-${ag}`, tournament };
    }
  }
  for (const code of Object.keys(recentByTeam)) {
    recentByTeam[code].sort((a, b) => (a.date < b.date ? 1 : -1));
    recentByTeam[code] = recentByTeam[code].slice(0, 10);
  }
  const missingForm = Object.keys(TEAMS).filter((c) => !recentByTeam[c] || recentByTeam[c].length < 5);
  if (missingForm.length) fail(`insufficient recent form rows for ${missingForm.join(',')}`);
}

// Penalty shootout history
const shootoutsByTeam = {};
{
  const lines = read('shootouts.csv').split('\n');
  for (let i = 1; i < lines.length; i++) {
    const f = lines[i].trim().split(',');
    if (f.length < 4) continue;
    const [date, home, away, winner] = f;
    if (date >= CUTOFF) continue;
    for (const side of [home, away]) {
      const code = nameToCode.get(normalize(side));
      if (!code) continue;
      const s = (shootoutsByTeam[code] ??= { taken: 0, won: 0 });
      s.taken++;
      if (normalize(winner) === normalize(side)) s.won++;
    }
  }
}

// ---------------------------------------------------------------------------
// 8. Assemble + write
// ---------------------------------------------------------------------------
console.log('Assembling outputs...');

const countries = Object.entries(TEAMS).map(([code, t]) => {
  let group = null, info = null;
  for (const [letter, teams] of Object.entries(groups)) {
    const f = teams.find((x) => x.code === code);
    if (f) { group = letter; info = f; break; }
  }
  if (!info) fail(`team ${code} not found in any group`);
  const fr = rankByCode.get(code);
  return {
    code,
    name: t.name,
    flagUrl: `https://flagcdn.com/w160/${t.iso2}.png`,
    flagEmojiIso: t.iso2,
    confederation: info.confed,
    group,
    drawPosition: info.drawPos,
    pot: info.pot,
    fifaRanking: fr.rank,
    fifaPoints: fr.points,
    fifaRankingDate: '2026-04-01',
    seedingRank: info.seedRank, // November 2025 ranking used for the final draw
    eloRating: eloByCode.get(code).rating,
    eloRank: eloByCode.get(code).rank,
    worldCupAppearances: info.appearances,
    coach: squads[code].coach,
    coachNationality: squads[code].coachNationality,
    shootouts: shootoutsByTeam[code] ?? { taken: 0, won: 0 },
    profile24mo: profileWindow[code],
  };
});

writeJson('countries.json', countries);
writeJson('venues.json', Object.fromEntries(
  Object.entries(VENUES).map(([name, v]) => [venueId(name), { name, ...v }]),
));
writeJson('matches.json', matches);
writeJson('squads.json', squads);
writeJson('third-place-table.json', thirdPlaceTable);
writeJson('h2h.json', h2h);
writeJson('recent-form.json', recentByTeam);
writeJson('fifa-rankings-full.json', fifaRankings.map(({ code, ...rest }) => rest));
writeJson('tournament.json', {
  year: 2026,
  name: 'FIFA World Cup 2026',
  hostCountries: ['Canada', 'Mexico', 'United States'],
  startDate: '2026-06-11',
  endDate: '2026-07-19',
  teamsCount: 48,
  groupsCount: 12,
  format: {
    groupStage: { groups: 12, teamsPerGroup: 4, advance: 'top2 + 8 best third-placed' },
    knockout: ['round32', 'round16', 'quarterfinal', 'semifinal', 'third_place', 'final'],
  },
  sources: {
    wikipedia: ['2026 FIFA World Cup', 'Group A–L pages', 'knockout stage', 'squads'],
    fifaRanking: '1 April 2026 release',
    elo: 'eloratings.net (retrieved 2026-06-10)',
    history: 'martj42/international_results (results through 2026-06-10)',
  },
  retrievedAt: new Date().toISOString(),
});

// summary
console.log('\n=== SUMMARY ===');
console.log(`teams: ${countries.length}`);
for (const letter of 'ABCDEFGHIJKL') {
  console.log(`  Group ${letter}: ${groups[letter].map((t) => t.code).join(' ')}`);
}
console.log(`matches: ${matches.length} (group ${matches.filter((x) => x.stage === 'group').length}, knockout ${matches.filter((x) => x.stage !== 'group').length})`);
const totalPlayers = Object.values(squads).reduce((s, q) => s + q.players.length, 0);
console.log(`players: ${totalPlayers}`);
console.log(`third-place combos: ${Object.keys(thirdPlaceTable).length}`);
console.log(`h2h pairs: ${Object.keys(h2h).length}`);
console.log('OK');
