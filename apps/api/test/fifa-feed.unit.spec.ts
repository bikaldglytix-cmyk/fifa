/**
 * Unit tests for the pure FIFA feed mapping layer (no I/O, no Nest DI).
 * Imports the compiled dist like the e2e suite — vitest's esbuild does not
 * emit decorator metadata, so src imports are off-limits in api tests.
 */
import { describe, expect, it } from 'vitest';
import {
  FIFA_PERIOD,
  FIFA_STATUS,
  buildResultEntry,
  eventsSafeToAttach,
  extractScorerName,
  goalEventsFromTimeline,
  mapCalendarMatch,
  normalizeName,
  parseMatchMinute,
  phaseFromFeed,
  playerDocName,
  resolvePlayerId,
  toSimMatchEvents,
  type FeedMatchSnapshot,
  type SquadPlayerRef,
} from '../dist/live/fifa-feed.js';

// fixture shaped exactly like the observed api.fifa.com calendar rows
const calendarRaw = {
  IdMatch: '400021443',
  IdStage: '289273',
  MatchNumber: 1,
  Date: '2026-06-11T19:00:00Z',
  MatchStatus: 3,
  Period: 5,
  MatchTime: "76'",
  Attendance: '80824',
  Home: { IdTeam: '43911', Abbreviation: 'MEX', Score: 2 },
  Away: { IdTeam: '43946', Abbreviation: 'RSA', Score: 0 },
  HomeTeamPenaltyScore: null,
  AwayTeamPenaltyScore: null,
};

const snap = (over: Partial<FeedMatchSnapshot> = {}): FeedMatchSnapshot => ({
  matchNumber: 73,
  idMatch: 'x',
  idStage: 'y',
  kickoffUtc: '2026-06-28T19:00:00Z',
  matchStatus: FIFA_STATUS.FINISHED,
  period: FIFA_PERIOD.FULL_TIME,
  minuteLabel: null,
  homeCode: 'ARG',
  awayCode: 'FRA',
  fifaHomeTeamId: '100',
  fifaAwayTeamId: '200',
  homeScore: 2,
  awayScore: 1,
  homePenalties: null,
  awayPenalties: null,
  attendance: 70000,
  ...over,
});

const goal = (minute: number, team: 'home' | 'away') => ({
  minute,
  minuteLabel: `${minute}'`,
  type: 'goal' as const,
  team,
  teamCode: team === 'home' ? 'ARG' : 'FRA',
  player: null,
});

describe('fifa-feed mappers', () => {
  it('maps a calendar row to a normalized snapshot', () => {
    const s = mapCalendarMatch(calendarRaw as never)!;
    expect(s.matchNumber).toBe(1);
    expect(s.homeCode).toBe('MEX');
    expect(s.homeScore).toBe(2);
    expect(s.awayScore).toBe(0);
    expect(s.attendance).toBe(80824);
    expect(s.minuteLabel).toBe("76'");
  });

  it('translates feed status/period into lifecycle phases', () => {
    expect(phaseFromFeed(FIFA_STATUS.LIVE, FIFA_PERIOD.FIRST_HALF)).toBe('live');
    expect(phaseFromFeed(FIFA_STATUS.LIVE, FIFA_PERIOD.HALF_TIME)).toBe('half_time');
    expect(phaseFromFeed(FIFA_STATUS.LIVE, FIFA_PERIOD.EXTRA_FIRST)).toBe('extra_time');
    expect(phaseFromFeed(FIFA_STATUS.LIVE, FIFA_PERIOD.PENALTIES)).toBe('penalties');
    // the feed never decides completion or pre-kickoff phases
    expect(phaseFromFeed(FIFA_STATUS.FINISHED, FIFA_PERIOD.FULL_TIME)).toBeNull();
    expect(phaseFromFeed(FIFA_STATUS.NOT_STARTED, 0)).toBeNull();
  });

  it('parses FIFA minute labels including stoppage time', () => {
    expect(parseMatchMinute("76'")).toBe(76);
    expect(parseMatchMinute("45'+2'")).toBe(45);
    expect(parseMatchMinute("90'+5'")).toBe(90);
    expect(parseMatchMinute(null)).toBeNull();
    expect(parseMatchMinute('HT')).toBeNull();
  });

  it('de-shouts scorer names from event descriptions', () => {
    expect(extractScorerName('Julian QUINONES (Mexico) scores!!')).toBe('Julian Quinones');
    expect(extractScorerName('RAÚL (Mexico) scores!!')).toBe('Raúl');
    expect(extractScorerName('no parentheses at all')).toBeNull();
  });

  it('attributes timeline goals to the oriented home/away sides', () => {
    const events = goalEventsFromTimeline(
      [
        { Type: 0, IdTeam: '43911', MatchMinute: "9'", EventDescription: [{ Description: 'Julian QUINONES (Mexico) scores!!' }] },
        { Type: 14, IdTeam: '43911', MatchMinute: "30'" }, // not a goal
        { Type: 0, IdTeam: '43946', MatchMinute: "88'", EventDescription: [{ Description: 'Lyle FOSTER (South Africa) scores!!' }] },
      ],
      '43911',
      'MEX',
      'RSA',
    );
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ minute: 9, team: 'home', teamCode: 'MEX', player: 'Julian Quinones' });
    expect(events[1]).toMatchObject({ minute: 88, team: 'away', teamCode: 'RSA' });
  });

  it('builds a plain group-stage result', () => {
    const entry = buildResultEntry(snap({ matchNumber: 1, homeScore: 2, awayScore: 0 }), 'group', [], {
      wentToExtraTime: false,
    })!;
    expect(entry).toMatchObject({ matchNumber: 1, homeScore: 2, awayScore: 0 });
    expect(entry.homeScoreEt).toBeUndefined();
  });

  it('splits knockout 90-minute and extra-time scores from goal minutes', () => {
    const goals = [goal(12, 'home'), goal(67, 'away'), goal(104, 'home')]; // 1–1 after 90, 2–1 aet
    const entry = buildResultEntry(snap(), 'round16', goals, { wentToExtraTime: true })!;
    expect(entry.homeScore).toBe(1);
    expect(entry.awayScore).toBe(1);
    expect(entry.homeScoreEt).toBe(2);
    expect(entry.awayScoreEt).toBe(1);
  });

  it('carries penalty shootout scores through', () => {
    const goals = [goal(40, 'home'), goal(80, 'away')];
    const entry = buildResultEntry(
      snap({ homeScore: 1, awayScore: 1, homePenalties: 4, awayPenalties: 2 }),
      'quarterfinal',
      goals,
      { wentToExtraTime: true },
    )!;
    expect(entry.homeScoreEt).toBe(1);
    expect(entry.homePenalties).toBe(4);
    expect(entry.awayPenalties).toBe(2);
  });

  it('degrades to the final score when the timeline is incomplete', () => {
    // 3 goals scored but only 1 in the timeline — split would be a guess
    const entry = buildResultEntry(snap({ homeScore: 2, awayScore: 1 }), 'round32', [goal(50, 'home')], {
      wentToExtraTime: true,
    })!;
    expect(entry.homeScore).toBe(2);
    expect(entry.awayScore).toBe(1);
    expect(entry.homeScoreEt).toBe(2);
  });
});

describe('scorer name resolution', () => {
  const mex: SquadPlayerRef[] = [
    { id: 1, name: 'Julián Quiñones', countryCode: 'MEX' },
    { id: 2, name: 'Raúl Jiménez', countryCode: 'MEX' },
    { id: 3, name: 'Santiago Giménez', countryCode: 'MEX' },
    { id: 4, name: 'Carlos Rodríguez', countryCode: 'MEX' },
    { id: 5, name: 'Jorge Sánchez', countryCode: 'MEX' },
    { id: 6, name: 'Erick Sánchez', countryCode: 'MEX' },
  ];

  it('normalizes diacritics and special letters', () => {
    expect(normalizeName('Julián Quiñones')).toBe('julian quinones');
    expect(normalizeName('Kenan Yıldız')).toBe('kenan yildiz');
    expect(normalizeName('Łukasz Skorupski')).toBe('lukasz skorupski');
  });

  it('matches shouted feed names against accented roster names', () => {
    expect(resolvePlayerId('Julian QUINONES', mex)).toBe(1);
    expect(resolvePlayerId('YILDIZ', [{ id: 9, name: 'Kenan Yıldız', countryCode: 'TUR' }])).toBe(9);
  });

  it('resolves single-token display names when unique', () => {
    expect(resolvePlayerId('RAÚL', mex)).toBe(2);
    expect(resolvePlayerId('Quinones', mex)).toBe(1);
  });

  it('returns null on ambiguity instead of guessing', () => {
    expect(resolvePlayerId('SÁNCHEZ', mex)).toBeNull(); // Jorge vs Erick
    // Jiménez vs Giménez normalize apart (j ≠ g) so RAÚL stays unique, but a
    // bare token shared by two players must not resolve
    expect(resolvePlayerId('Diego LAINEZ', mex)).toBeNull(); // not in squad
  });

  it('the canonical feed name settles shirt-name ambiguity (the two-Raúls case)', () => {
    // the REAL 2026 Mexico squad carries Raúl Jiménez (FW) and Raúl Rangel (GK)
    const twoRauls: SquadPlayerRef[] = [
      ...mex,
      { id: 7, name: 'Raúl Rangel', countryCode: 'MEX' },
    ];
    expect(resolvePlayerId('RAÚL', twoRauls)).toBeNull(); // ambiguous — never guess
    expect(resolvePlayerId('Raul JIMENEZ', twoRauls)).toBe(2); // FIFA player-doc name
  });

  it('extracts the canonical name from a FIFA player doc', () => {
    expect(playerDocName({ Name: [{ Description: 'Raul JIMENEZ' }], Alias: [{ Description: 'RAÚL' }] })).toBe('Raul JIMENEZ');
    expect(playerDocName({ Name: [] })).toBeNull();
    expect(playerDocName(null)).toBeNull();
  });

  it('timeline goals carry the feed player id for the second resolution pass', () => {
    const events = goalEventsFromTimeline(
      [{ Type: 0, IdTeam: '43911', IdPlayer: '356731', MatchMinute: "67'", EventDescription: [{ Description: 'RAÚL (Mexico) scores!!' }] }],
      '43911',
      'MEX',
      'RSA',
    );
    expect(events[0].feedPlayerId).toBe('356731');
  });

  it('falls back to a unique surname when display and roster first names drift', () => {
    const uru: SquadPlayerRef[] = [
      { id: 11, name: 'Fede Valverde', countryCode: 'URU' },
      { id: 12, name: 'Manuel Ugarte', countryCode: 'URU' },
    ];
    expect(resolvePlayerId('Federico VALVERDE', uru)).toBe(11);
  });

  it('maps feed goals to SimMatchEvents with ids, omitting unresolved ones', () => {
    const rsa: SquadPlayerRef[] = [{ id: 21, name: 'Lyle Foster', countryCode: 'RSA' }];
    const { events, aligned, unresolved } = toSimMatchEvents(
      [
        { minute: 9, minuteLabel: "9'", type: 'goal', team: 'home', teamCode: 'MEX', player: 'Julian Quinones' },
        { minute: 67, minuteLabel: "67'", type: 'penalty_goal', team: 'home', teamCode: 'MEX', player: 'Raúl' },
        { minute: 80, minuteLabel: "80'", type: 'goal', team: 'away', teamCode: 'RSA', player: 'Unknown Trialist' },
      ],
      { home: mex, away: rsa },
    );
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ minute: 9, type: 'goal', team: 'MEX', playerId: 1, playerName: 'Julián Quiñones' });
    expect(events[1]).toMatchObject({ minute: 67, type: 'penalty_goal', playerId: 2 });
    expect(aligned[2]).toBeNull();
    expect(unresolved).toEqual(["80' Unknown Trialist"]);
  });

  it('resolves own goals against the opposing squad when needed', () => {
    const rsa: SquadPlayerRef[] = [{ id: 22, name: 'Aubrey Modiba', countryCode: 'RSA' }];
    // feed credits the goal to the benefiting side (home) but the scorer is RSA
    const { events } = toSimMatchEvents(
      [{ minute: 30, minuteLabel: "30'", type: 'own_goal', team: 'home', teamCode: 'MEX', player: 'MODIBA' }],
      { home: mex, away: rsa },
    );
    expect(events[0]).toMatchObject({ type: 'own_goal', playerId: 22, team: 'RSA' });
  });

  it('gates event attachment on completeness and a resolved opening scorer', () => {
    const g = (minute: number, player: string | null) =>
      ({ minute, minuteLabel: `${minute}'`, type: 'goal' as const, team: 'home' as const, teamCode: 'MEX', player });
    const { aligned: ok } = toSimMatchEvents([g(9, 'Quinones'), g(67, 'Raúl')], { home: mex, away: [] });
    expect(eventsSafeToAttach([g(9, 'Quinones'), g(67, 'Raúl')], ok, 2, 0)).toBe(true);
    // count mismatch (a goal missing from the timeline)
    expect(eventsSafeToAttach([g(9, 'Quinones')], ok.slice(0, 1), 2, 0)).toBe(false);
    // opening scorer unresolved → a later goal would wrongly settle first-scorer
    const { aligned: firstBad } = toSimMatchEvents([g(9, 'Nobody Known'), g(67, 'Raúl')], { home: mex, away: [] });
    expect(eventsSafeToAttach([g(9, 'Nobody Known'), g(67, 'Raúl')], firstBad, 2, 0)).toBe(false);
    expect(eventsSafeToAttach([], [], 0, 0)).toBe(false);
  });
});
