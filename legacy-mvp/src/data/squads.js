// Squad generation for every national team.
//
// Real star players are hand-listed for headline nations to make lineups feel
// authentic; the rest of each 23-man squad is filled deterministically so that
// every team is playable in the fantasy / lineup builder.

import { COUNTRY_BY_CODE } from './countries.js';

// Positions grouped by line. The generator builds a balanced squad from these.
const SQUAD_TEMPLATE = [
  'GK', 'GK', 'GK',
  'RB', 'CB', 'CB', 'CB', 'LB', 'RWB', 'LWB',
  'CDM', 'CDM', 'CM', 'CM', 'CAM',
  'RW', 'LW', 'RW', 'LW',
  'ST', 'ST', 'ST', 'CF',
];

// Known headline players per nation: [name, position, rating override].
const STARS = {
  ARG: [['Emiliano Martinez', 'GK', 87], ['Cuti Romero', 'CB', 86], ['Nicolas Otamendi', 'CB', 83], ['Nahuel Molina', 'RB', 82], ['Rodrigo De Paul', 'CM', 85], ['Enzo Fernandez', 'CM', 86], ['Alexis Mac Allister', 'CAM', 86], ['Lionel Messi', 'RW', 91], ['Julian Alvarez', 'ST', 87], ['Lautaro Martinez', 'ST', 87], ['Angel Di Maria', 'LW', 84]],
  FRA: [['Mike Maignan', 'GK', 87], ['William Saliba', 'CB', 86], ['Dayot Upamecano', 'CB', 84], ['Jules Kounde', 'RB', 85], ['Theo Hernandez', 'LB', 85], ['Aurelien Tchouameni', 'CDM', 86], ['Eduardo Camavinga', 'CM', 85], ['Antoine Griezmann', 'CAM', 87], ['Kylian Mbappe', 'LW', 91], ['Ousmane Dembele', 'RW', 86], ['Marcus Thuram', 'ST', 84]],
  ESP: [['Unai Simon', 'GK', 85], ['Robin Le Normand', 'CB', 84], ['Aymeric Laporte', 'CB', 84], ['Dani Carvajal', 'RB', 85], ['Marc Cucurella', 'LB', 83], ['Rodri', 'CDM', 90], ['Pedri', 'CM', 87], ['Fabian Ruiz', 'CM', 84], ['Lamine Yamal', 'RW', 86], ['Nico Williams', 'LW', 85], ['Alvaro Morata', 'ST', 83]],
  ENG: [['Jordan Pickford', 'GK', 84], ['John Stones', 'CB', 85], ['Marc Guehi', 'CB', 82], ['Kyle Walker', 'RB', 84], ['Luke Shaw', 'LB', 83], ['Declan Rice', 'CDM', 87], ['Jude Bellingham', 'CAM', 88], ['Phil Foden', 'CM', 87], ['Bukayo Saka', 'RW', 87], ['Harry Kane', 'ST', 89], ['Cole Palmer', 'LW', 85]],
  BRA: [['Alisson', 'GK', 88], ['Marquinhos', 'CB', 86], ['Gabriel Magalhaes', 'CB', 85], ['Danilo', 'RB', 82], ['Wendell', 'LB', 80], ['Casemiro', 'CDM', 85], ['Bruno Guimaraes', 'CM', 86], ['Lucas Paqueta', 'CAM', 84], ['Vinicius Junior', 'LW', 89], ['Rodrygo', 'RW', 86], ['Raphinha', 'RW', 85]],
  POR: [['Diogo Costa', 'GK', 85], ['Ruben Dias', 'CB', 88], ['Pepe', 'CB', 80], ['Joao Cancelo', 'RB', 85], ['Nuno Mendes', 'LB', 84], ['Bruno Fernandes', 'CAM', 87], ['Vitinha', 'CM', 84], ['Bernardo Silva', 'CM', 87], ['Cristiano Ronaldo', 'ST', 86], ['Rafael Leao', 'LW', 85], ['Goncalo Ramos', 'ST', 83]],
  NED: [['Bart Verbruggen', 'GK', 82], ['Virgil van Dijk', 'CB', 88], ['Nathan Ake', 'CB', 84], ['Denzel Dumfries', 'RB', 83], ['Cody Gakpo', 'LW', 84], ['Frenkie de Jong', 'CM', 87], ['Tijjani Reijnders', 'CM', 83], ['Xavi Simons', 'CAM', 84], ['Memphis Depay', 'ST', 84], ['Donyell Malen', 'RW', 82], ['Wout Weghorst', 'ST', 79]],
  GER: [['Marc-Andre ter Stegen', 'GK', 88], ['Antonio Rudiger', 'CB', 86], ['Jonathan Tah', 'CB', 84], ['Joshua Kimmich', 'RB', 87], ['David Raum', 'LB', 82], ['Toni Kroos', 'CM', 87], ['Ilkay Gundogan', 'CM', 85], ['Jamal Musiala', 'CAM', 88], ['Florian Wirtz', 'CAM', 87], ['Kai Havertz', 'ST', 84], ['Leroy Sane', 'RW', 85]],
  BEL: [['Thibaut Courtois', 'GK', 90], ['Wout Faes', 'CB', 80], ['Zeno Debast', 'CB', 78], ['Timothy Castagne', 'RB', 80], ['Kevin De Bruyne', 'CAM', 89], ['Youri Tielemans', 'CM', 83], ['Amadou Onana', 'CDM', 82], ['Jeremy Doku', 'RW', 83], ['Romelu Lukaku', 'ST', 85], ['Leandro Trossard', 'LW', 83], ['Dodi Lukebakio', 'RW', 80]],
  CRO: [['Dominik Livakovic', 'GK', 83], ['Josko Gvardiol', 'CB', 86], ['Josip Sutalo', 'CB', 79], ['Luka Modric', 'CM', 86], ['Mateo Kovacic', 'CM', 84], ['Marcelo Brozovic', 'CDM', 83], ['Lovro Majer', 'CAM', 81], ['Andrej Kramaric', 'ST', 81], ['Ante Budimir', 'ST', 79], ['Ivan Perisic', 'LW', 81], ['Mario Pasalic', 'CM', 80]],
};

// Common pools of forename/surname syllables used to invent plausible squad
// names for nations without hand-listed players. Deterministic by seed.
const FORE = ['Luca', 'Marco', 'Diego', 'Andre', 'Pedro', 'Ivan', 'Omar', 'Yuki', 'Karim', 'Sven', 'Niko', 'Tariq', 'Leon', 'Mateo', 'Ali', 'Hugo', 'Felix', 'Bruno', 'Samir', 'Kai', 'Noah', 'Eli', 'Tomas', 'Jonas'];
const SUR = ['Silva', 'Kovac', 'Tanaka', 'Mensah', 'Larsson', 'Okafor', 'Hassan', 'Moreno', 'Ferreira', 'Nielsen', 'Park', 'Diallo', 'Rossi', 'Vargas', 'Khan', 'Petrov', 'Adeyemi', 'Costa', 'Bauer', 'Yilmaz', 'Novak', 'Reyes', 'Sato', 'Traore'];

// Simple deterministic PRNG (mulberry32) so squads are stable across reloads.
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFromCode(code) {
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) | 0;
  return Math.abs(h) + 1;
}

// Base rating derived from team Elo, so stronger nations get stronger squads.
function baseRatingFromElo(elo) {
  // Elo ~1640..2105 maps to roughly 72..86 average rating.
  return Math.round(72 + ((elo - 1640) / (2105 - 1640)) * 14);
}

const POSITION_BONUS = {
  GK: 0, CB: 0, RB: -1, LB: -1, RWB: -1, LWB: -1, CDM: 0, CM: 1, CAM: 2, RW: 2, LW: 2, ST: 2, CF: 1,
};

let _cache = null;

function buildSquadFor(code) {
  const country = COUNTRY_BY_CODE[code];
  const rng = makeRng(seedFromCode(code));
  const base = baseRatingFromElo(country.elo);
  const stars = STARS[code] || [];
  const usedNames = new Set(stars.map((s) => s[0]));

  const players = [];
  let id = 1;

  // First, place the hand-listed stars.
  for (const [name, position, rating] of stars) {
    players.push(makePlayer(id++, code, name, position, rating, rng));
  }

  // Fill remaining slots from the template, skipping positions stars already cover
  // proportionally — we just append until we reach 23 players total.
  const starPositions = stars.map((s) => s[1]);
  const remainingTemplate = [...SQUAD_TEMPLATE];
  // Remove one template slot per star so the squad shape stays balanced.
  for (const pos of starPositions) {
    const idx = remainingTemplate.indexOf(pos);
    if (idx !== -1) remainingTemplate.splice(idx, 1);
  }

  for (const position of remainingTemplate) {
    let name;
    do {
      name = `${FORE[Math.floor(rng() * FORE.length)]} ${SUR[Math.floor(rng() * SUR.length)]}`;
    } while (usedNames.has(name));
    usedNames.add(name);
    const variance = Math.round((rng() - 0.5) * 8);
    const rating = clamp(base + (POSITION_BONUS[position] || 0) + variance, 62, 88);
    players.push(makePlayer(id++, code, name, position, rating, rng));
  }

  return players;
}

function makePlayer(id, code, name, position, rating, rng) {
  return {
    id: `${code}-${id}`,
    name,
    position,
    rating,
    age: 20 + Math.floor(rng() * 16),
    fitness: 80 + Math.floor(rng() * 20),
    form: 1 + Math.floor(rng() * 5), // 1..5 flames
    injuryRisk: Math.floor(rng() * 25),
    number: id,
    country: code,
  };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

// Public: get the full 23-man squad for a country (memoised).
export function getSquad(code) {
  if (!_cache) _cache = {};
  if (!_cache[code]) _cache[code] = buildSquadFor(code);
  return _cache[code];
}

// Public: team strength used by the simulation engine, derived from the best XI.
export function teamStrength(code) {
  const squad = getSquad(code);
  const sorted = [...squad].sort((a, b) => b.rating - a.rating);
  const xi = sorted.slice(0, 11);
  const avg = xi.reduce((s, p) => s + p.rating, 0) / xi.length;
  return avg;
}
