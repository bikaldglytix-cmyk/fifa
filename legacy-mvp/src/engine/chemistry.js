// Lineup chemistry + tactical-fit calculations for the fantasy team builder.

// Formations map to an ordered list of 11 position slots.
export const FORMATIONS = {
  '4-3-3': ['GK', 'RB', 'CB', 'CB', 'LB', 'CDM', 'CM', 'CM', 'RW', 'ST', 'LW'],
  '4-2-3-1': ['GK', 'RB', 'CB', 'CB', 'LB', 'CDM', 'CDM', 'CAM', 'RW', 'LW', 'ST'],
  '3-5-2': ['GK', 'CB', 'CB', 'CB', 'RWB', 'CM', 'CM', 'CAM', 'LWB', 'ST', 'ST'],
  '4-4-2': ['GK', 'RB', 'CB', 'CB', 'LB', 'RM', 'CM', 'CM', 'LM', 'ST', 'ST'],
  '5-3-2': ['GK', 'RWB', 'CB', 'CB', 'CB', 'LWB', 'CM', 'CM', 'CAM', 'ST', 'ST'],
};

// Which positions can plausibly cover which slot (for fit scoring).
const COMPATIBLE = {
  GK: ['GK'],
  RB: ['RB', 'RWB', 'CB'],
  LB: ['LB', 'LWB', 'CB'],
  RWB: ['RWB', 'RB', 'RM'],
  LWB: ['LWB', 'LB', 'LM'],
  CB: ['CB', 'RB', 'LB'],
  CDM: ['CDM', 'CM'],
  CM: ['CM', 'CDM', 'CAM'],
  CAM: ['CAM', 'CM', 'RW', 'LW'],
  RM: ['RM', 'RW', 'CM'],
  LM: ['LM', 'LW', 'CM'],
  RW: ['RW', 'RM', 'CAM', 'ST'],
  LW: ['LW', 'LM', 'CAM', 'ST'],
  ST: ['ST', 'CF', 'RW', 'LW'],
  CF: ['CF', 'ST', 'CAM'],
};

// Score how well one player fits an assigned slot: 100 natural, less when out of position.
export function slotFit(player, slot) {
  if (!player) return 0;
  if (player.position === slot) return 100;
  const compat = COMPATIBLE[slot] || [];
  if (compat.includes(player.position)) return 78;
  // Same broad line (defence/midfield/attack) gets partial credit.
  if (sameLine(player.position, slot)) return 60;
  return 35;
}

const DEF = ['GK', 'RB', 'LB', 'CB', 'RWB', 'LWB'];
const MID = ['CDM', 'CM', 'CAM', 'RM', 'LM'];
const ATT = ['RW', 'LW', 'ST', 'CF'];
function lineOf(pos) {
  if (DEF.includes(pos)) return 'DEF';
  if (MID.includes(pos)) return 'MID';
  return 'ATT';
}
function sameLine(a, b) {
  return lineOf(a) === lineOf(b);
}

// Team chemistry (0..100): blend of positional fit, squad rating, and fitness.
export function calcChemistry(assignments, formation) {
  const slots = FORMATIONS[formation];
  const filled = slots.map((slot, i) => ({ slot, player: assignments[i] })).filter((s) => s.player);
  if (filled.length === 0) return { chemistry: 0, tacticalFit: 0, avgRating: 0, filledCount: 0 };

  let fitSum = 0;
  let ratingSum = 0;
  let fitnessSum = 0;
  for (const { slot, player } of filled) {
    fitSum += slotFit(player, slot);
    ratingSum += player.rating;
    fitnessSum += player.fitness;
  }
  const n = filled.length;
  const avgFit = fitSum / n;
  const avgRating = ratingSum / n;
  const avgFitness = fitnessSum / n;

  // Completeness penalty if fewer than 11 are selected.
  const completeness = n / 11;

  const tacticalFit = Math.round(avgFit * completeness);
  const chemistry = Math.round(
    (avgFit * 0.5 + avgRating * 0.35 + avgFitness * 0.15) * completeness
  );

  return {
    chemistry: clamp(chemistry, 0, 100),
    tacticalFit: clamp(tacticalFit, 0, 100),
    avgRating: Math.round(avgRating * 10) / 10,
    filledCount: n,
  };
}

// Effective attacking strength of a lineup, fed into the match engine so that a
// well-built XI actually improves a team's expected goals.
export function lineupStrength(assignments, formation) {
  const { chemistry, avgRating, filledCount } = calcChemistry(assignments, formation);
  if (filledCount === 0) return 78;
  // Chemistry nudges the raw rating up or down by a few points.
  const chemBonus = (chemistry - 70) / 20; // ~ -3.5 .. +1.5
  return clamp(avgRating + chemBonus, 60, 92);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}
