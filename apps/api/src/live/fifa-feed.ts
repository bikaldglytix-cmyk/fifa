import type { MatchPhase, LiveMatchEventDto, SimMatchEvent } from '@fifa/shared';
import type { ResultEntry } from '../admin/results.service';

/**
 * FIFA public live-data feed (api.fifa.com/api/v3) — pure mapping layer.
 * No Nest decorators, no I/O side effects beyond `fifaGet`: everything here
 * is unit-testable with plain fixtures. The poller (LiveScoreService) owns
 * scheduling and state; this module owns "what does a FIFA payload mean".
 *
 * PRD alignment: "Real-time score sync with FIFA" (World Cup Live Mode).
 */

export const FIFA_API_BASE = process.env.LIVE_FEED_BASE ?? 'https://api.fifa.com/api/v3';
/** FIFA World Cup 2026: competition 17, season 285023 (from the match centre). */
export const FIFA_COMPETITION = process.env.LIVE_FEED_COMPETITION ?? '17';
export const FIFA_SEASON = process.env.LIVE_FEED_SEASON ?? '285023';

// --- raw payload shapes (narrowed to the fields we read) --------------------

export interface FifaTeamRaw {
  IdTeam?: string;
  Abbreviation?: string;
  Score?: number | null;
  TeamName?: Array<{ Description?: string }>;
}

export interface FifaCalendarMatchRaw {
  IdMatch: string;
  IdStage: string;
  MatchNumber?: number | null;
  Date: string;
  MatchStatus: number;
  Period?: number | null;
  MatchTime?: string | null;
  Attendance?: string | null;
  Home?: FifaTeamRaw | null;
  Away?: FifaTeamRaw | null;
  HomeTeamScore?: number | null;
  AwayTeamScore?: number | null;
  HomeTeamPenaltyScore?: number | null;
  AwayTeamPenaltyScore?: number | null;
}

export interface FifaLiveMatchRaw {
  IdMatch: string;
  MatchNumber?: number | null;
  MatchStatus: number;
  Period?: number | null;
  MatchTime?: string | null;
  Attendance?: string | null;
  HomeTeam?: FifaTeamRaw | null;
  AwayTeam?: FifaTeamRaw | null;
  HomeTeamPenaltyScore?: number | null;
  AwayTeamPenaltyScore?: number | null;
}

export interface FifaTimelineEventRaw {
  Type?: number;
  IdTeam?: string | null;
  IdPlayer?: string | null;
  MatchMinute?: string | null;
  EventDescription?: Array<{ Description?: string }>;
}

export interface FifaPlayerRaw {
  IdPlayer?: string;
  Name?: Array<{ Description?: string }>;
  Alias?: Array<{ Description?: string }>;
}

/** Canonical full name from a FIFA player doc ("Raul JIMENEZ" — Alias holds the shirt name). */
export function playerDocName(doc: FifaPlayerRaw | null | undefined): string | null {
  const name = doc?.Name?.[0]?.Description?.trim();
  return name?.length ? name : null;
}

// --- status / period semantics ----------------------------------------------

/** FIFA MatchStatus codes (observed + documented community mappings). */
export const FIFA_STATUS = { FINISHED: 0, NOT_STARTED: 1, LIVE: 3, ABANDONED: 4, POSTPONED: 7, LINEUPS: 12 } as const;

/** FIFA Period codes. */
export const FIFA_PERIOD = {
  FIRST_HALF: 3,
  HALF_TIME: 4,
  SECOND_HALF: 5,
  EXTRA_FIRST: 7,
  EXTRA_HALF_TIME: 8,
  EXTRA_SECOND: 9,
  FULL_TIME: 10,
  PENALTIES: 11,
} as const;

/** Live-feed status+period → our in-play lifecycle phase (null = no opinion). */
export function phaseFromFeed(matchStatus: number, period: number | null | undefined): MatchPhase | null {
  if (matchStatus !== FIFA_STATUS.LIVE) return null; // only refine in-play phases
  switch (period) {
    case FIFA_PERIOD.HALF_TIME:
      return 'half_time';
    case FIFA_PERIOD.EXTRA_FIRST:
    case FIFA_PERIOD.EXTRA_HALF_TIME:
    case FIFA_PERIOD.EXTRA_SECOND:
      return 'extra_time';
    case FIFA_PERIOD.PENALTIES:
      return 'penalties';
    default:
      return 'live';
  }
}

/** Parse FIFA match-time labels: "76'" → 76, "45'+2'" → 45, "90'+5'" → 90. */
export function parseMatchMinute(label: string | null | undefined): number | null {
  if (!label) return null;
  const m = /^(\d{1,3})'/.exec(label.trim());
  return m ? Number(m[1]) : null;
}

// --- calendar mapping ---------------------------------------------------------

export interface FeedMatchSnapshot {
  matchNumber: number;
  idMatch: string;
  idStage: string;
  kickoffUtc: string;
  matchStatus: number;
  period: number | null;
  minuteLabel: string | null;
  homeCode: string | null;
  awayCode: string | null;
  fifaHomeTeamId: string | null;
  fifaAwayTeamId: string | null;
  homeScore: number | null;
  awayScore: number | null;
  homePenalties: number | null;
  awayPenalties: number | null;
  attendance: number | null;
}

/** One calendar row → normalized snapshot (scores for ALL matches in one call). */
export function mapCalendarMatch(raw: FifaCalendarMatchRaw): FeedMatchSnapshot | null {
  if (!raw?.IdMatch || raw.MatchNumber == null) return null;
  return {
    matchNumber: Number(raw.MatchNumber),
    idMatch: raw.IdMatch,
    idStage: raw.IdStage,
    kickoffUtc: raw.Date,
    matchStatus: raw.MatchStatus,
    period: raw.Period ?? null,
    minuteLabel: raw.MatchTime ?? null,
    homeCode: raw.Home?.Abbreviation ?? null,
    awayCode: raw.Away?.Abbreviation ?? null,
    fifaHomeTeamId: raw.Home?.IdTeam ?? null,
    fifaAwayTeamId: raw.Away?.IdTeam ?? null,
    homeScore: raw.Home?.Score ?? raw.HomeTeamScore ?? null,
    awayScore: raw.Away?.Score ?? raw.AwayTeamScore ?? null,
    homePenalties: raw.HomeTeamPenaltyScore ?? null,
    awayPenalties: raw.AwayTeamPenaltyScore ?? null,
    attendance: raw.Attendance != null && raw.Attendance !== '' ? Number(raw.Attendance) : null,
  };
}

/** Live-doc → partial snapshot refresh (minute/period/score are fresher here). */
export function mapLiveDoc(raw: FifaLiveMatchRaw): Partial<FeedMatchSnapshot> {
  return {
    matchStatus: raw.MatchStatus,
    period: raw.Period ?? null,
    minuteLabel: raw.MatchTime ?? null,
    homeScore: raw.HomeTeam?.Score ?? null,
    awayScore: raw.AwayTeam?.Score ?? null,
    homePenalties: raw.HomeTeamPenaltyScore ?? null,
    awayPenalties: raw.AwayTeamPenaltyScore ?? null,
    attendance: raw.Attendance != null && raw.Attendance !== '' ? Number(raw.Attendance) : null,
  };
}

// --- timeline mapping ---------------------------------------------------------

/** Timeline event type 0 = goal. Own goals / penalty goals are classified from text. */
export function goalEventsFromTimeline(
  events: FifaTimelineEventRaw[] | undefined,
  fifaHomeTeamId: string | null,
  homeCode: string,
  awayCode: string,
): LiveMatchEventDto[] {
  const out: LiveMatchEventDto[] = [];
  for (const e of events ?? []) {
    if (e.Type !== 0) continue;
    const label = e.MatchMinute ?? '';
    const minute = parseMatchMinute(label) ?? 0;
    const desc = e.EventDescription?.[0]?.Description ?? '';
    const isHome = e.IdTeam != null && fifaHomeTeamId != null ? e.IdTeam === fifaHomeTeamId : true;
    const lower = desc.toLowerCase();
    out.push({
      minute,
      minuteLabel: label,
      type: lower.includes('own goal') ? 'own_goal' : lower.includes('penalty') ? 'penalty_goal' : 'goal',
      team: isHome ? 'home' : 'away',
      teamCode: isHome ? homeCode : awayCode,
      player: extractScorerName(desc),
      feedPlayerId: e.IdPlayer ?? null,
    });
  }
  return out.sort((a, b) => a.minute - b.minute);
}

/** "Julian QUINONES (Mexico) scores!!" → "Julian Quinones". */
export function extractScorerName(description: string): string | null {
  const m = /^(.+?)\s*\(/.exec(description);
  if (!m) return null;
  const raw = m[1].trim();
  if (!raw) return null;
  // de-shout surnames: QUINONES → Quinones (keep already-mixed-case tokens)
  return raw
    .split(/\s+/)
    .map((w) => (w === w.toUpperCase() && w.length > 2 ? w.charAt(0) + w.slice(1).toLowerCase() : w))
    .join(' ');
}

// --- scorer-name → squad-player resolution -------------------------------------

/** Minimal player reference from the engine's squad cache. */
export interface SquadPlayerRef {
  id: number;
  name: string;
  countryCode: string;
}

/** Letters NFD decomposition cannot fold (no combining-mark form). */
const LETTER_FOLD: Record<string, string> = {
  ı: 'i', ø: 'o', đ: 'd', ł: 'l', ß: 'ss', æ: 'ae', œ: 'oe', þ: 'th', ð: 'd',
};

/** Diacritic-free lowercase form: "Julián Quiñones" → "julian quinones". */
export function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[ıøđłßæœþð]/g, (c) => LETTER_FOLD[c] ?? c);
}

const nameTokens = (s: string): string[] => normalizeName(s).split(/[^a-z]+/).filter(Boolean);

/**
 * Resolve a feed display name ("RAÚL", "Julian QUINONES") to a unique squad
 * player. Strategy: every feed token must appear in the candidate's name
 * tokens; if that finds nothing (display-name vs roster-name drift, e.g.
 * "Federico" vs "Fede"), fall back to a unique surname-token match. Returns
 * null on no match AND on ambiguity — never guess a scorer.
 */
export function resolvePlayerId(feedName: string | null, squad: SquadPlayerRef[]): number | null {
  if (!feedName) return null;
  const feedToks = nameTokens(feedName);
  if (!feedToks.length) return null;

  const candidates = squad.map((p) => {
    const toks = nameTokens(p.name);
    return { id: p.id, toks: new Set(toks), full: toks.join(' ') };
  });

  const containing = candidates.filter((c) => feedToks.every((t) => c.toks.has(t)));
  if (containing.length === 1) return containing[0].id;
  if (containing.length > 1) {
    const exact = containing.filter((c) => c.full === feedToks.join(' '));
    return exact.length === 1 ? exact[0].id : null;
  }

  const surname = feedToks[feedToks.length - 1];
  const bySurname = candidates.filter((c) => c.toks.has(surname));
  return bySurname.length === 1 ? bySurname[0].id : null;
}

/**
 * Feed goal events → SimMatchEvent[] for the result pipeline (stat lines,
 * first-goalscorer settlement, fantasy scoring). Events whose scorer cannot
 * be uniquely resolved are OMITTED and reported back — a missing stat line
 * is recoverable, a wrong attribution is not. Own goals try the credited
 * side first, then the opposing squad (feeds differ on which team they
 * attribute the event to).
 */
export function toSimMatchEvents(
  goals: LiveMatchEventDto[],
  squads: { home: SquadPlayerRef[]; away: SquadPlayerRef[] },
): { events: SimMatchEvent[]; aligned: Array<SimMatchEvent | null>; unresolved: string[] } {
  const aligned: Array<SimMatchEvent | null> = [];
  const unresolved: string[] = [];
  for (const g of goals) {
    const primary = g.team === 'home' ? squads.home : squads.away;
    const other = g.team === 'home' ? squads.away : squads.home;
    let id = resolvePlayerId(g.player, primary);
    let squad = primary;
    if (id == null && g.type === 'own_goal') {
      id = resolvePlayerId(g.player, other);
      squad = other;
    }
    if (id == null) {
      unresolved.push(`${g.minuteLabel} ${g.player ?? '(unnamed)'}`);
      aligned.push(null);
      continue;
    }
    const player = squad.find((p) => p.id === id)!;
    aligned.push({
      minute: Math.min(130, Math.max(1, g.minute || 1)),
      type: g.type,
      team: player.countryCode,
      playerId: player.id,
      playerName: player.name,
    });
  }
  return { events: aligned.filter((e): e is SimMatchEvent => e != null), aligned, unresolved };
}

/**
 * Settlement-safety gate: events may only ride on a result claim when the
 * timeline accounts for every goal AND the opening goal's scorer resolved.
 * Anything less risks crowning the wrong "first goalscorer" — a silently
 * wrong award is worse than missing stat lines.
 */
export function eventsSafeToAttach(
  goals: LiveMatchEventDto[],
  aligned: Array<SimMatchEvent | null>,
  finalHome: number,
  finalAway: number,
): boolean {
  if (!goals.length) return false;
  if (goals.length !== finalHome + finalAway) return false;
  return aligned[0] != null;
}

// --- final result construction -------------------------------------------------

/**
 * Feed-finished snapshot → ResultEntry for the consensus pipeline.
 * Knockout matches that went beyond 90' need the 90'-score / after-ET-score
 * split our schema records; goal minutes from the timeline provide it.
 */
export function buildResultEntry(
  snap: FeedMatchSnapshot,
  stage: string,
  goals: LiveMatchEventDto[],
  opts: { wentToExtraTime: boolean },
): ResultEntry | null {
  if (snap.homeScore == null || snap.awayScore == null) return null;
  const isKnockout = stage !== 'group';
  const hadPens = snap.homePenalties != null && snap.awayPenalties != null;

  if (!isKnockout || (!opts.wentToExtraTime && !hadPens)) {
    return {
      matchNumber: snap.matchNumber,
      homeScore: snap.homeScore,
      awayScore: snap.awayScore,
      attendance: snap.attendance,
    };
  }

  // knockout beyond 90': split using goal minutes (90' goals include stoppage labels like 90'+4')
  const in90 = (e: LiveMatchEventDto) => e.minute <= 90;
  const homeIn90 = goals.filter((g) => g.team === 'home' && in90(g)).length;
  const awayIn90 = goals.filter((g) => g.team === 'away' && in90(g)).length;
  const timelineComplete = goals.length === snap.homeScore + snap.awayScore;

  return {
    matchNumber: snap.matchNumber,
    // if the timeline is incomplete we cannot trust the split — degrade to the
    // final score in both fields (logged by the caller) rather than invent one
    homeScore: timelineComplete ? homeIn90 : snap.homeScore,
    awayScore: timelineComplete ? awayIn90 : snap.awayScore,
    homeScoreEt: snap.homeScore,
    awayScoreEt: snap.awayScore,
    homePenalties: snap.homePenalties,
    awayPenalties: snap.awayPenalties,
    attendance: snap.attendance,
  };
}

// --- fetch helper ----------------------------------------------------------------

/** GET a FIFA endpoint with timeout; returns null on any failure (poller logs). */
export async function fifaGet<T>(path: string, timeoutMs = 8000): Promise<T | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${FIFA_API_BASE}${path}`, {
      signal: ctrl.signal,
      headers: { accept: 'application/json' },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export const calendarPath = (): string =>
  `/calendar/matches?idCompetition=${FIFA_COMPETITION}&idSeason=${FIFA_SEASON}&count=200&language=en`;
export const livePath = (idStage: string, idMatch: string): string =>
  `/live/football/${FIFA_COMPETITION}/${FIFA_SEASON}/${idStage}/${idMatch}?language=en`;
export const timelinePath = (idStage: string, idMatch: string): string =>
  `/timelines/${FIFA_COMPETITION}/${FIFA_SEASON}/${idStage}/${idMatch}?language=en`;
export const playerPath = (idPlayer: string): string => `/players/${idPlayer}?language=en`;
