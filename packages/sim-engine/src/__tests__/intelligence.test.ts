import { describe, expect, it } from 'vitest';
import { venueDistanceKm, venueTzShift, VENUE_GEO } from '../geo';
import { assessConditions } from '../conditions';
import { computeTeamFatigue, fatigueLambdaFactor } from '../fatigue';
import { assessPsychology } from '../psychology';
import { tacticalAxes } from '../tactics';
import { formScore } from '../strength';
import { predictMatch, MODEL_VERSION } from '../predict';
import { assembleExtras } from '../factors';
import { teamPair } from './fixtures';
import type { SimTeam } from '../types';

const AZTECA = 'estadio-azteca';
const METLIFE = 'metlife-stadium';
const VANCOUVER = 'bc-place';

const withForm = (team: SimTeam, results: string): SimTeam => ({
  ...team,
  form: { results, score: formScore(results) },
});

describe('geo', () => {
  it('covers all 16 venues', () => {
    expect(Object.keys(VENUE_GEO)).toHaveLength(16);
  });

  it('computes realistic great-circle distances', () => {
    const cdmxToNy = venueDistanceKm(AZTECA, METLIFE);
    expect(cdmxToNy).toBeGreaterThan(3000);
    expect(cdmxToNy).toBeLessThan(3700);
    expect(venueDistanceKm(AZTECA, AZTECA)).toBe(0);
  });

  it('computes time-zone shifts', () => {
    expect(venueTzShift(METLIFE, VANCOUVER)).toBe(3);
    expect(venueTzShift(AZTECA, 'att-stadium')).toBe(1);
  });
});

describe('conditions', () => {
  const meta = { name: 'Estadio Azteca', city: 'Mexico City', capacity: 87523 };

  it('punishes unacclimatized sides at altitude but not altitude natives', () => {
    const c = assessConditions(AZTECA, meta, 'MEX', 'GER')!;
    expect(c.info.altitudeM).toBe(2240);
    expect(c.lambdaFactorHome).toBe(1); // MEX acclimatized
    expect(c.lambdaFactorAway).toBeLessThan(1); // GER not
    expect(c.info.notes.join(' ')).toMatch(/thinner air/i);
  });

  it('slows tempo in extreme-heat venues', () => {
    const c = assessConditions('estadio-bbva', { name: 'Estadio BBVA', city: 'Guadalupe', capacity: 53500 }, 'ARG', 'FRA')!;
    expect(c.lambdaFactorHome).toBeLessThan(1);
    expect(c.lambdaFactorAway).toBeLessThan(1);
  });
});

describe('fatigue engine', () => {
  const day = 86_400_000;
  const kickoff = new Date('2026-06-24T20:00:00Z');

  it('a tournament opener is fully fresh', () => {
    const f = computeTeamFatigue('ARG', [], kickoff, METLIFE);
    expect(f.restDays).toBeNull();
    expect(f.freshness).toBe(100);
    expect(f.label).toBe('fresh');
  });

  it('short rest + long travel + tz shift stacks penalties monotonically', () => {
    const shortRest = computeTeamFatigue('ARG', [{ date: new Date(kickoff.getTime() - 2.5 * day), venueId: METLIFE }], kickoff, METLIFE);
    const shortRestAndTravel = computeTeamFatigue('ARG', [{ date: new Date(kickoff.getTime() - 2.5 * day), venueId: VANCOUVER }], kickoff, METLIFE);
    const rested = computeTeamFatigue('ARG', [{ date: new Date(kickoff.getTime() - 7 * day), venueId: METLIFE }], kickoff, METLIFE);

    expect(shortRest.freshness).toBeLessThan(rested.freshness);
    expect(shortRestAndTravel.freshness).toBeLessThan(shortRest.freshness);
    expect(shortRestAndTravel.travelKm).toBeGreaterThan(3000);
    expect(shortRestAndTravel.tzShift).toBe(3);
    expect(fatigueLambdaFactor(shortRestAndTravel)).toBeLessThan(fatigueLambdaFactor(rested));
  });
});

describe('psychology', () => {
  it('must-win urgency and momentum produce bounded factors with notes', () => {
    const { home, away } = teamPair('NED', 'FRA');
    const r = assessPsychology({
      team: withForm(home, 'WWWWD'),
      opponent: away,
      stage: 'group',
      knockout: false,
      playingInOwnCountry: false,
      mustWin: true,
      h2h: null,
      isCountry1: true,
    });
    expect(r.lambdaFactor).toBeGreaterThan(1);
    expect(r.lambdaFactor).toBeLessThanOrEqual(1.04);
    expect(r.assessment.factorsApplied).toContain('must-win urgency');
    expect(r.assessment.factorsApplied).toContain('momentum');
  });
});

describe('tactics', () => {
  it('exposes trait axes per style/formation', () => {
    const axes = tacticalAxes('defensive_block', '5-3-2');
    expect(axes.defensiveBlock).toBeGreaterThan(90);
    expect(axes.possession).toBeLessThan(35);
  });
});

describe('predict v2', () => {
  const ctx = { stage: 'group' as const, matchNumber: 7, venueCountry: 'USA' as const, knockout: false };

  const realInputs = () => {
    const { home, away, h2h } = teamPair('BRA', 'MAR');
    return {
      home, away, ctx, h2h,
      extras: assembleExtras(home, away, ctx, h2h, {
        venueId: METLIFE,
        venueMeta: { name: 'MetLife Stadium', city: 'East Rutherford', capacity: 82500 },
        matchDate: new Date('2026-06-13T19:00:00Z'),
        homeItinerary: [],
        awayItinerary: [{ date: new Date('2026-06-10T19:00:00Z'), venueId: VANCOUVER }],
      }),
    };
  };

  it('produces a complete, probability-consistent v2 prediction', () => {
    const p = predictMatch(realInputs());
    expect(p.modelVersion).toBe(MODEL_VERSION);
    expect(p.homeWin + p.draw + p.awayWin).toBeCloseTo(1, 5);

    // intelligence layers all present
    expect(p.conditions?.venueId).toBe(METLIFE);
    expect(p.fatigue?.away.travelKm).toBeGreaterThan(3000);
    expect(p.tactics.home.axes.pressing).toBeGreaterThanOrEqual(0);
    expect(p.keyBattles.length).toBeGreaterThanOrEqual(2);
    expect(['low', 'medium', 'high', 'extreme']).toContain(p.upset.tier);

    // explainability
    expect(p.explanation.whyFavored.length).toBeGreaterThan(0);
    expect(p.explanation.whyUnderdogCanWin.length).toBeGreaterThan(0);
    expect(p.explanation.biggestRisks.length).toBeGreaterThan(0);
    expect(p.explanation.keyVariables.length).toBeGreaterThan(0);
    expect(p.explanation.dataCoverage.some((d) => d.status === 'unavailable')).toBe(true); // honest about gaps

    // uncertainty brackets contain the point estimate
    expect(p.uncertainty.homeWin[0]).toBeLessThanOrEqual(p.homeWin);
    expect(p.uncertainty.homeWin[1]).toBeGreaterThanOrEqual(p.homeWin);
  });

  it('fatigue extras shift probabilities the right way', () => {
    const base = realInputs();
    const noExtras = predictMatch({ home: base.home, away: base.away, ctx, h2h: base.h2h });
    const withExtras = predictMatch(base);
    // away side travelled 3,900 km on short rest — their win prob must not improve
    expect(withExtras.awayWin).toBeLessThanOrEqual(noExtras.awayWin + 1e-9);
  });

  it('upset detector flags structural enablers for live underdogs', () => {
    const { home, away, h2h } = teamPair('ESP', 'SEN');
    const dog = withForm({ ...away, manager: { ...away.manager, preferredStyle: 'counter_attack' } }, 'WWWWL');
    const p = predictMatch({
      home: { ...home, manager: { ...home.manager, preferredStyle: 'possession' } },
      away: dog,
      ctx: { stage: 'round16', matchNumber: 90, venueCountry: 'USA', knockout: true },
      h2h,
    });
    expect(p.upset.underdog).toBe('SEN');
    expect(p.upset.score).toBeGreaterThan(20);
    expect(p.upset.drivers.join(' ')).toMatch(/counter|knockout|form/i);
  });

  it('pairs the best players by zone in key battles', () => {
    const { home, away, h2h } = teamPair('ENG', 'CRO');
    const pred = predictMatch({ home, away, ctx: { ...ctx, matchNumber: 22 }, h2h });
    expect(pred.keyBattles.map((b) => b.zone)).toContain('Midfield control');
    for (const b of pred.keyBattles) {
      expect(b.home.rating).toBeGreaterThan(0);
      expect(['home', 'away', 'even']).toContain(b.edge);
    }
  });
});
