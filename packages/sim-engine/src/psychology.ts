import type { MatchStage, PsychologyAssessment } from '@fifa/shared';
import { clamp } from '@fifa/shared';
import type { H2HRecord, SimTeam } from './types';

/**
 * Psychological model: pressure, momentum and narrative factors translated
 * into small, bounded modifiers. Everything here derives from verifiable
 * inputs (form streaks, host status, stage, head-to-head volume) — no
 * invented locker-room rumours.
 */

/** Defending champions carry knockout-stage burden (2022 winners). */
export const DEFENDING_CHAMPION = 'ARG';

export interface PsychInputs {
  team: SimTeam;
  opponent: SimTeam;
  stage: MatchStage;
  knockout: boolean;
  playingInOwnCountry: boolean;
  mustWin: boolean;
  h2h: H2HRecord | null;
  /** true when this team is lexicographic country1 in the h2h record */
  isCountry1: boolean;
}

export interface PsychAssessmentResult {
  assessment: PsychologyAssessment;
  lambdaFactor: number;
}

export function assessPsychology(inputs: PsychInputs): PsychAssessmentResult {
  const { team, opponent, stage, knockout, playingInOwnCountry, mustWin, h2h, isCountry1 } = inputs;
  const factorsApplied: string[] = [];
  const notes: string[] = [];
  let factor = 1;

  // --- momentum from current form streak --------------------------------------
  const streak = leadingStreak(team.form.results);
  if (streak.kind === 'W' && streak.length >= 3) {
    factor *= 1.015;
    factorsApplied.push('momentum');
    notes.push(`Riding a ${streak.length}-match winning streak — confidence is high`);
  } else if (streak.kind === 'L' && streak.length >= 3) {
    factor *= 0.985;
    factorsApplied.push('negative momentum');
    notes.push(`${streak.length} straight defeats coming in — belief under strain`);
  }

  // --- must-win situations -------------------------------------------------------
  if (mustWin) {
    factor *= 1.02;
    factorsApplied.push('must-win urgency');
    notes.push('Elimination math: anything but a win likely ends their tournament');
  }

  // --- host-nation pressure cuts both ways ----------------------------------------
  if (playingInOwnCountry) {
    if (knockout && team.manager.pressureHandling < 55) {
      factor *= 0.99;
      factorsApplied.push('host expectation burden');
      notes.push('A home crowd in a knockout is rocket fuel — and a pressure cooker');
    } else {
      factorsApplied.push('home crowd');
      notes.push('Playing on home soil with the nation behind them');
    }
  }

  // --- defending champion burden ---------------------------------------------------
  if (team.code === DEFENDING_CHAMPION && knockout) {
    factor *= 0.99;
    factorsApplied.push('defending-champion burden');
    notes.push('Defending champions: every opponent plays the match of their lives');
  }

  // --- rivalry intensity (frequent, balanced fixture history) ------------------------
  if (h2h && h2h.played >= 8 && team.confederation === opponent.confederation) {
    const myWins = isCountry1 ? h2h.wins1 : h2h.wins2;
    const theirWins = isCountry1 ? h2h.wins2 : h2h.wins1;
    const balance = Math.abs(myWins - theirWins) / h2h.played;
    if (balance < 0.35) {
      factorsApplied.push('rivalry');
      notes.push(`A genuine rivalry (${h2h.played} meetings) — form guides matter less in these`);
    }
  }

  // --- deep-stage pressure vs manager temperament -------------------------------------
  if ((stage === 'semifinal' || stage === 'final') && team.manager.pressureHandling >= 75) {
    factor *= 1.01;
    factorsApplied.push('big-game temperament');
    notes.push(`${team.manager.name} has the temperament for the biggest occasions`);
  }

  return {
    assessment: { team: team.code, factorsApplied, notes },
    lambdaFactor: clamp(factor, 0.96, 1.04),
  };
}

function leadingStreak(results: string): { kind: string; length: number } {
  if (!results.length) return { kind: '', length: 0 };
  const kind = results[0];
  let length = 0;
  for (const c of results) {
    if (c !== kind) break;
    length++;
  }
  return { kind, length };
}
