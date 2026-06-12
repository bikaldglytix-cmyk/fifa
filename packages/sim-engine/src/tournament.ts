import type {
  GroupLetter,
  GroupStandingRow,
  ScheduledMatch,
  SingleTournamentRun,
} from '@fifa/shared';
import { deriveSeed, mulberry32, type Rng } from './rng';
import { simulateMatch } from './match';
import { computeStandings, fairPlayPoints, rankThirdPlacedTeams, type GroupMatchRecord } from './group';
import { resolveRoundOf32, type GroupOutcome, type ThirdPlaceTable } from './bracket';
import type { EngineConfig, H2HRecord, PlayerTournamentState, SimTeam } from './types';

export interface TournamentInputs {
  teams: Map<string, SimTeam>; // by country code
  schedule: ScheduledMatch[]; // all 104 with slots
  thirdPlaceTable: ThirdPlaceTable;
  h2h: Map<string, H2HRecord>; // key "AAA-BBB" sorted
  venueCountryByMatch: Map<number, 'USA' | 'MEX' | 'CAN'>;
  config?: Partial<EngineConfig>;
}

const h2hFor = (h2h: Map<string, H2HRecord>, a: string, b: string): H2HRecord | null =>
  h2h.get([a, b].sort().join('-')) ?? null;

/** Per-run mutable tracking for suspensions/fatigue/scorers. */
function freshStates(teams: Map<string, SimTeam>): Map<number, PlayerTournamentState> {
  const m = new Map<number, PlayerTournamentState>();
  for (const t of teams.values()) {
    for (const p of t.squad) {
      m.set(p.id, { yellows: 0, suspendedForNext: false, goals: 0, assists: 0, started: 0, fatigue: 0 });
    }
  }
  return m;
}

export interface RunOptions {
  seed: number;
  /** collect per-match knockout details (cheap) */
  collectDetails?: boolean;
}

export function runTournament(inputs: TournamentInputs, opts: RunOptions): SingleTournamentRun & {
  scorerGoals: Map<number, { name: string; team: string; goals: number }>;
  reached: Map<string, number>; // code -> furthest round index (0=group exit,1=R32...6=champion)
} {
  const rng = mulberry32(opts.seed);
  const states = freshStates(inputs.teams);
  const teamStateOf = (code: string) => {
    const t = inputs.teams.get(code)!;
    const map = new Map<number, PlayerTournamentState>();
    for (const p of t.squad) map.set(p.id, states.get(p.id)!);
    return map;
  };

  const scorerGoals = new Map<number, { name: string; team: string; goals: number }>();
  const trackEvents = (result: ReturnType<typeof simulateMatch>) => {
    for (const ev of result.events) {
      if ((ev.type === 'goal' || ev.type === 'penalty_goal') && ev.playerId && ev.playerId > 0) {
        const cur = scorerGoals.get(ev.playerId) ?? { name: ev.playerName!, team: ev.team, goals: 0 };
        cur.goals++;
        scorerGoals.set(ev.playerId, cur);
        const st = states.get(ev.playerId);
        if (st) st.goals++;
      }
      if (ev.type === 'yellow_card' && ev.playerId) {
        const st = states.get(ev.playerId);
        if (st) {
          st.yellows++;
          if (st.yellows % 2 === 0) st.suspendedForNext = true;
        }
      }
      if ((ev.type === 'red_card' || ev.type === 'second_yellow') && ev.playerId) {
        const st = states.get(ev.playerId);
        if (st) st.suspendedForNext = true;
      }
    }
  };
  const clearServedSuspensions = (code: string, playedIds: Set<number>) => {
    const t = inputs.teams.get(code)!;
    for (const p of t.squad) {
      const st = states.get(p.id)!;
      if (st.suspendedForNext && !playedIds.has(p.id)) st.suspendedForNext = false;
      if (playedIds.has(p.id)) st.fatigue += 1;
    }
  };

  const playMatch = (
    matchNumber: number,
    homeCode: string,
    awayCode: string,
    stage: ScheduledMatch['stage'],
    knockout: boolean,
    streamId: number,
  ) => {
    const home = inputs.teams.get(homeCode)!;
    const away = inputs.teams.get(awayCode)!;
    const result = simulateMatch(
      {
        home,
        away,
        ctx: { stage, matchNumber, venueCountry: inputs.venueCountryByMatch.get(matchNumber) ?? 'USA', knockout },
        h2h: h2hFor(inputs.h2h, homeCode, awayCode),
        homeStates: teamStateOf(homeCode),
        awayStates: teamStateOf(awayCode),
      },
      { rng: mulberry32(deriveSeed(opts.seed, streamId)), knockout, withEvents: true, config: inputs.config },
    );
    trackEvents(result);
    const played = (side: 'home' | 'away') =>
      new Set(result.lineups[side].players.map((p) => p.playerId));
    clearServedSuspensions(homeCode, played('home'));
    clearServedSuspensions(awayCode, played('away'));
    return result;
  };

  // --- group stage -----------------------------------------------------------
  const groupStandings = {} as Record<GroupLetter, GroupStandingRow[]>;
  const outcomes = {} as Record<GroupLetter, GroupOutcome>;
  const groupMatches = inputs.schedule
    .filter((m) => m.stage === 'group')
    .sort((a, b) => a.matchNumber - b.matchNumber);

  const recordsByGroup = new Map<GroupLetter, GroupMatchRecord[]>();
  for (const m of groupMatches) {
    if (m.home.type !== 'team' || m.away.type !== 'team') throw new Error('group match without teams');
    const result = playMatch(m.matchNumber, m.home.code, m.away.code, 'group', false, m.matchNumber);
    const list = recordsByGroup.get(m.group as GroupLetter) ?? [];
    list.push({
      home: result.home,
      away: result.away,
      homeScore: result.homeScore,
      awayScore: result.awayScore,
      fairPlayHome: fairPlayPoints(result, 'home'),
      fairPlayAway: fairPlayPoints(result, 'away'),
    });
    recordsByGroup.set(m.group as GroupLetter, list);
  }

  const thirds: GroupStandingRow[] = [];
  const thirdGroupOf = new Map<string, GroupLetter>();
  for (const [group, records] of recordsByGroup) {
    const teams = [...new Set(records.flatMap((r) => [r.home, r.away]))];
    const standings = computeStandings(teams, records, rng);
    groupStandings[group] = standings;
    outcomes[group] = { winner: standings[0].team, runnerUp: standings[1].team, third: standings[2].team };
    thirds.push(standings[2]);
    thirdGroupOf.set(standings[2].team, group);
  }

  const rankedThirds = rankThirdPlacedTeams(thirds, rng);
  const rankedThirdGroups = rankedThirds.map((r) => thirdGroupOf.get(r.team)!) as GroupLetter[];

  // wipe yellows after group? No — FIFA wipes after QF; carry through.

  const { r32, qualifiedThirds } = resolveRoundOf32(inputs.schedule, outcomes, rankedThirdGroups, inputs.thirdPlaceTable);

  // --- knockout ----------------------------------------------------------------
  const reached = new Map<string, number>();
  for (const code of inputs.teams.keys()) reached.set(code, 0);
  const bump = (code: string, level: number) => reached.set(code, Math.max(reached.get(code) ?? 0, level));

  for (const [, pair] of r32) {
    bump(pair.home, 1);
    bump(pair.away, 1);
  }

  const winners = new Map<number, string>();
  const losers = new Map<number, string>();
  const knockoutResults: SingleTournamentRun['knockoutResults'] = [];

  const knockoutMatches = inputs.schedule
    .filter((m) => m.stage !== 'group')
    .sort((a, b) => a.matchNumber - b.matchNumber);

  const levelOf: Record<string, number> = { round32: 1, round16: 2, quarterfinal: 3, semifinal: 4, third_place: 4, final: 5 };

  for (const m of knockoutMatches) {
    let homeCode: string;
    let awayCode: string;
    if (m.stage === 'round32') {
      const pair = r32.get(m.matchNumber)!;
      homeCode = pair.home;
      awayCode = pair.away;
    } else {
      const res = (slot: typeof m.home): string => {
        if (slot.type === 'matchWinner') return winners.get(slot.match)!;
        if (slot.type === 'matchLoser') return losers.get(slot.match)!;
        throw new Error(`unexpected slot in ${m.stage}`);
      };
      homeCode = res(m.home);
      awayCode = res(m.away);
    }

    // FIFA wipes single yellows after the quarterfinals
    if (m.stage === 'semifinal') {
      for (const code of [homeCode, awayCode]) {
        for (const p of inputs.teams.get(code)!.squad) {
          const st = states.get(p.id)!;
          if (st.yellows % 2 === 1) st.yellows = Math.max(0, st.yellows - 1);
        }
      }
    }

    const result = playMatch(m.matchNumber, homeCode, awayCode, m.stage, true, 200 + m.matchNumber);
    const winner = result.winner!;
    const loser = winner === homeCode ? awayCode : homeCode;
    winners.set(m.matchNumber, winner);
    losers.set(m.matchNumber, loser);

    if (m.stage !== 'third_place') bump(winner, Math.min(6, levelOf[m.stage] + 1));

    knockoutResults.push({
      matchNumber: m.matchNumber,
      stage: m.stage,
      home: homeCode,
      away: awayCode,
      homeScore: result.homeScore,
      awayScore: result.awayScore,
      wentToExtraTime: result.wentToExtraTime,
      wentToPenalties: result.wentToPenalties,
      penalties: result.penalties ? { home: result.penalties.home, away: result.penalties.away } : undefined,
      winner,
    });
  }

  const champion = winners.get(104)!;
  const runnerUp = losers.get(104)!;
  const thirdPlace = winners.get(103)!;
  bump(champion, 6);

  let goldenBoot: SingleTournamentRun['goldenBoot'] = null;
  let top = 0;
  for (const [, v] of scorerGoals) {
    if (v.goals > top) {
      top = v.goals;
      goldenBoot = { name: v.name, team: v.team, goals: v.goals };
    }
  }

  return {
    groupStandings,
    thirdPlaceRanking: rankedThirds,
    qualifiedThirds,
    knockoutResults,
    champion,
    runnerUp,
    thirdPlace,
    goldenBoot,
    scorerGoals,
    reached,
  };
}
