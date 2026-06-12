/**
 * Full-surface e2e: migrates + seeds a throwaway PGlite database, boots the
 * compiled app in-process, and walks every REST domain, GraphQL, and the
 * admin result pipeline exactly as a client would.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const cjsRequire = createRequire(import.meta.url);

const ADMIN_EMAIL = 'admin@fifa2026.local';
const ADMIN_PASSWORD = 'E2e-Admin-Passw0rd!';

let app: { close(): Promise<void>; getHttpServer(): any } | null = null;
let base = '';
let dataDir = '';

interface Tokens {
  accessToken: string;
  refreshToken: string;
}
interface Session {
  user: { id: string; username: string; email: string; role: string };
  tokens: Tokens;
}

async function http<T = any>(
  method: string,
  path: string,
  opts: { token?: string; body?: unknown } = {},
): Promise<{ status: number; json: T }> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const text = await res.text();
  return { status: res.status, json: (text ? JSON.parse(text) : null) as T };
}

const get = <T = any>(p: string, token?: string) => http<T>('GET', p, { token });
const post = <T = any>(p: string, body?: unknown, token?: string) => http<T>('POST', p, { body, token });
const put = <T = any>(p: string, body: unknown, token: string) => http<T>('PUT', p, { body, token });

let n = 0;
async function register(): Promise<Session> {
  n += 1;
  const r = await post<Session>('/api/v1/auth/register', {
    email: `e2e-${Date.now()}-${n}@test.dev`,
    username: `e2e_user_${Date.now() % 1_000_000}_${n}`,
    password: 'Str0ng!Passw0rd',
  });
  expect(r.status).toBe(201);
  return r.json;
}

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), 'fifa-e2e-'));
  process.env.PGLITE_DIR = dataDir;
  delete process.env.DATABASE_URL;
  process.env.DISABLE_SCHEDULER = 'true'; // sweeps run on demand via the ops endpoint
  process.env.ADMIN_PASSWORD = ADMIN_PASSWORD;
  // pin the lifecycle clock to 30' into the real opener (M1 kicked off 2026-06-11T19:00Z)
  process.env.SIM_CLOCK_OFFSET_MS = String(new Date('2026-06-11T19:30:00Z').getTime() - Date.now());
  // two external feeds for consensus tests (neither alone crosses the 0.9 threshold)
  process.env.RESULT_FEEDS = JSON.stringify([
    { name: 'feed_alpha', weight: 0.5 },
    { name: 'feed_beta', weight: 0.45 },
  ]);
  process.env.SYSTEM_FORECAST_RUNS = '200';

  // migrate + seed the throwaway database (compiled db package)
  const { runMigrations } = await import('@fifa/db');
  await runMigrations();
  const seedMod: any = await import(pathToFileURL(cjsRequire.resolve('@fifa/db/dist/seed.js')).href);
  await (seedMod.seed ?? seedMod.default.seed)();

  // boot the compiled app on an ephemeral port
  const bootMod: any = await import(pathToFileURL(join(here, '..', 'dist', 'bootstrap.js')).href);
  const createApp = bootMod.createApp ?? bootMod.default.createApp;
  app = await createApp({ logger: false });
  await (app as any).listen(0);
  const address = (app as any).getHttpServer().address();
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await app?.close().catch(() => undefined);
  // PGlite may briefly hold file handles on Windows
  try {
    rmSync(dataDir, { recursive: true, force: true });
  } catch {
    /* best effort */
  }
});

describe('health & reference data', () => {
  it('GET /health reports ok on pglite', async () => {
    const r = await get('/health');
    expect(r.status).toBe(200);
    expect(r.json.status).toBe('ok');
    expect(r.json.database).toBe('pglite');
  });

  it('serves the real tournament, 48 countries, 16 venues, 104 matches', async () => {
    const [t, c, v, m] = await Promise.all([
      get('/api/v1/tournament'),
      get('/api/v1/countries'),
      get('/api/v1/venues'),
      get('/api/v1/matches'),
    ]);
    expect(t.json.year).toBe(2026);
    expect(c.json).toHaveLength(48);
    expect(v.json).toHaveLength(16);
    expect(m.json).toHaveLength(104);
  });

  it('match 1 is the real opener (MEX at Estadio Azteca)', async () => {
    const r = await get('/api/v1/matches/1');
    expect(r.status).toBe(200);
    expect(r.json.homeCode).toBe('MEX');
    expect(r.json.stage).toBe('group');
  });

  it('standings cover the 12 groups; bracket and h2h respond', async () => {
    const [s, b, h] = await Promise.all([
      get('/api/v1/standings'),
      get('/api/v1/bracket'),
      get('/api/v1/h2h/ARG/FRA'),
    ]);
    expect(Object.keys(s.json)).toHaveLength(12);
    expect(b.status).toBe(200);
    expect(h.status).toBe(200);
  });

  it('players list filters and paginates; detail + comparison work', async () => {
    const list = await get('/api/v1/players?countryCode=ARG&limit=5');
    expect(list.json.total).toBeGreaterThanOrEqual(26);
    expect(list.json.players).toHaveLength(5);
    const [a, b] = list.json.players;
    const detail = await get(`/api/v1/players/${a.id}`);
    expect(detail.json.name).toBe(a.name);
    const vs = await get(`/api/v1/players/${a.id}/vs/${b.id}`);
    expect(vs.status).toBe(200);
  });
});

describe('auth', () => {
  it('register → me → refresh rotates tokens → logout', async () => {
    const session = await register();
    expect(session.tokens.accessToken).toBeTruthy();

    const me = await get('/api/v1/users/me', session.tokens.accessToken);
    expect(me.status).toBe(200);
    expect(me.json.email).toContain('@test.dev');

    const refreshed = await post<Tokens>('/api/v1/auth/refresh', {
      refreshToken: session.tokens.refreshToken,
    });
    expect(refreshed.status).toBe(200);
    expect(refreshed.json.refreshToken).not.toBe(session.tokens.refreshToken);

    const reuse = await post('/api/v1/auth/refresh', { refreshToken: session.tokens.refreshToken });
    expect(reuse.status).toBeGreaterThanOrEqual(400); // rotation: old token dead

    const out = await post('/api/v1/auth/logout', { refreshToken: refreshed.json.refreshToken }, refreshed.json.accessToken);
    expect(out.status).toBe(204);
  });

  it('rejects weak registrations and unauthenticated access', async () => {
    const bad = await post('/api/v1/auth/register', { email: 'x', username: 'a', password: '123' });
    expect(bad.status).toBe(400);
    const noToken = await get('/api/v1/users/me');
    expect(noToken.status).toBe(401);
  });

  it('login works and non-admins are barred from /admin', async () => {
    const session = await register();
    const login = await post<Session>('/api/v1/auth/login', {
      email: session.user.email,
      password: 'Str0ng!Passw0rd',
    });
    expect(login.status).toBe(200);
    const forbidden = await get('/api/v1/admin/ingestion-logs', login.json.tokens.accessToken);
    expect(forbidden.status).toBe(403);
  });
});

describe('fantasy', () => {
  it('select country → squad → suggested lineup → save → analyze → fixtures', async () => {
    const { tokens } = await register();
    const tk = tokens.accessToken;

    const sel = await post('/api/v1/fantasy/select-country', { countryCode: 'ARG', teamName: 'E2E XI' }, tk);
    expect([200, 201]).toContain(sel.status);

    const squad = await get('/api/v1/fantasy/squads/ARG');
    expect(squad.json.length).toBeGreaterThanOrEqual(23);

    const suggest = await get('/api/v1/fantasy/suggest/ARG');
    expect(suggest.json.startingXi).toHaveLength(11);

    const fixtures = await get('/api/v1/fantasy/fixtures', tk);
    expect(fixtures.status).toBe(200);
    expect(fixtures.json.length).toBeGreaterThanOrEqual(3);
    const matchNumber = fixtures.json[0].matchNumber;

    const xi = suggest.json.startingXi;
    const captainId = suggest.json.suggestedCaptain ?? xi[10].playerId;
    const saved = await put(
      '/api/v1/fantasy/lineup',
      {
        matchNumber,
        formation: suggest.json.formation,
        startingXi: xi,
        substitutes: [],
        captainId,
        viceCaptainId: xi.find((s: any) => s.playerId !== captainId)!.playerId,
      },
      tk,
    );
    expect([200, 201]).toContain(saved.status);

    const analysis = await post(
      '/api/v1/fantasy/lineup/analyze',
      { formation: suggest.json.formation, startingXi: xi, captainId },
      tk,
    );
    expect(analysis.status).toBeLessThan(300);

    const team = await get('/api/v1/fantasy/my-team', tk);
    expect(team.json.countryCode).toBe('ARG');
    expect(team.json.squad.length).toBeGreaterThanOrEqual(23);
    expect(team.json.lineups.length).toBeGreaterThanOrEqual(1);
  });
});

describe('predictions & community intelligence', () => {
  it('submit → mine → community aggregates', async () => {
    const { tokens } = await register();
    const tk = tokens.accessToken;

    const created = await post('/api/v1/predictions', { matchNumber: 2, homeScore: 1, awayScore: 1 }, tk);
    expect([200, 201]).toContain(created.status);

    const mine = await get('/api/v1/predictions/mine', tk);
    expect(mine.json.some((p: any) => p.matchNumber === 2 || p.match?.matchNumber === 2)).toBe(true);

    const community = await get('/api/v1/predictions/community/2');
    expect(community.status).toBe(200);
  });
});

describe('simulations', () => {
  it('AI predict, single-match sim, and Monte Carlo job lifecycle', async () => {
    const { tokens } = await register();
    const tk = tokens.accessToken;

    const predict = await get('/api/v1/simulations/predict/1');
    expect(predict.json.prediction ?? predict.json.probabilities ?? predict.json).toBeTruthy();

    const match = await post('/api/v1/simulations/match', { matchNumber: 1, runs: 100 }, tk);
    expect(match.status).toBeLessThan(300);
    expect(match.json.runs).toBe(100);

    const job = await post('/api/v1/simulations/tournament', { runs: 100 }, tk);
    expect(job.json.jobId).toBeTruthy();

    let status: any = null;
    for (let i = 0; i < 60; i++) {
      const r = await get(`/api/v1/simulations/jobs/${job.json.jobId}`, tk);
      status = r.json;
      if (status.status === 'completed' || status.status === 'failed') break;
      await new Promise((res) => setTimeout(res, 500));
    }
    expect(status.status).toBe('completed');

    const mine = await get('/api/v1/simulations/mine', tk);
    expect(mine.status).toBe(200);
    const volume = await get('/api/v1/simulations/volume');
    expect(volume.status).toBe(200);
  });
});

describe('social & leagues & leaderboards', () => {
  it('follow graph, feed, private league lifecycle, leaderboards', async () => {
    const alice = await register();
    const bob = await register();
    const at = alice.tokens.accessToken;
    const bt = bob.tokens.accessToken;

    const follow = await post(`/api/v1/social/follow/${bob.user.id}`, undefined, at);
    expect(follow.status).toBeLessThan(300);
    const following = await get('/api/v1/social/following', at);
    expect(following.json.some((u: any) => u.id === bob.user.id || u.userId === bob.user.id)).toBe(true);
    const followers = await get('/api/v1/social/followers', bt);
    expect(followers.json.length).toBeGreaterThanOrEqual(1);

    const feed = await get('/api/v1/social/feed', at);
    expect(feed.status).toBe(200);
    const profile = await get(`/api/v1/users/${bob.user.username}/profile`, at);
    expect(profile.status).toBe(200);

    const league = await post('/api/v1/leagues', { name: 'E2E League' }, at);
    expect(league.json.joinCode).toBeTruthy();
    const join = await post('/api/v1/leagues/join', { joinCode: league.json.joinCode }, bt);
    expect(join.status).toBeLessThan(300);
    const mine = await get('/api/v1/leagues/mine', bt);
    expect(mine.json.length).toBeGreaterThanOrEqual(1);
    const lb = await get(`/api/v1/leagues/${league.json.id}/leaderboard`, at);
    expect(lb.status).toBe(200);

    const global = await get('/api/v1/leaderboards/global');
    expect(global.status).toBe(200);
    const friends = await get('/api/v1/leaderboards/friends', at);
    expect(friends.status).toBe(200);
  });
});

describe('real live scores (feed state, ticker, verification boundary)', () => {
  // the FIFA poller is off in tests (DISABLE_SCHEDULER); the admin manual
  // live endpoint exercises the same store, broadcasts and read paths
  let adminToken = '';
  const adminLogin = async () => {
    if (adminToken) return adminToken;
    const login = await post<Session>('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    adminToken = login.json.tokens.accessToken;
    return adminToken;
  };

  it("the 'fifa' feed is a registered built-in result source", async () => {
    const model = await get('/api/v1/intelligence/model');
    expect(model.status).toBe(200);
    const fifa = model.json.resultSources.find((s: any) => s.name === 'fifa');
    expect(fifa).toBeTruthy();
    expect(fifa.weight).toBeCloseTo(0.95);
  });

  it('live state flows to every read surface while the match is in play', async () => {
    const tk = await adminLogin();
    // scheduler is off in tests: advance phases from the pinned clock first
    await post('/api/v1/admin/lifecycle/sweep', undefined, tk);
    // clock is pinned 30' into the opener — set its live ticker state
    const set = await post('/api/v1/admin/live/1', { homeScore: 1, awayScore: 0, minute: 28 }, tk);
    expect(set.status).toBeLessThan(300);
    expect(set.json.ok).toBe(true);

    // dedicated live endpoints
    const all = await get('/api/v1/matches/live');
    expect(all.json.some((s: any) => s.matchNumber === 1 && s.homeScore === 1)).toBe(true);
    const one = await get('/api/v1/matches/1/live');
    expect(one.json.live.homeScore).toBe(1);
    expect(one.json.live.minuteLabel).toBe("28'");
    expect(one.json.live.source).toBe('official_admin');

    // match row + schedule list embed it
    const match = await get('/api/v1/matches/1');
    expect(match.json.live.homeScore).toBe(1);
    expect(match.json.homeScore).toBeNull(); // verified score untouched
    const list = await get('/api/v1/matches');
    expect(list.json.find((m: any) => m.matchNumber === 1).live.awayScore).toBe(0);

    // intelligence board carries the ticker for match cards
    const board = await get('/api/v1/intelligence/board');
    const item = board.json.find((m: any) => m.matchNumber === 1);
    expect(item.live.homeScore).toBe(1);

    // GraphQL exposes it as Match.liveStats (PRD)
    const gql = await post('/graphql', {
      query: 'query { match(matchNumber: 1) { matchNumber liveStats } }',
    });
    expect(gql.json.data.match.liveStats.homeScore).toBe(1);
  });

  it('live state is ticker-only — it never completes a match', async () => {
    const match = await get('/api/v1/matches/1');
    expect(match.json.status).toBe('live'); // still clock-governed
    expect(match.json.homeScore).toBeNull(); // no verified result
    const standings = await get('/api/v1/standings');
    const mex = standings.json.A.find((row: any) => row.team === 'MEX');
    expect(mex.played).toBe(0); // table only moves on verified results
  });

  it('clearing the manual state removes it from the read surfaces', async () => {
    const tk = await adminLogin();
    const del = await http('DELETE', '/api/v1/admin/live/1', { token: tk });
    expect(del.status).toBeLessThan(300);
    const one = await get('/api/v1/matches/1/live');
    expect(one.json.live).toBeNull();
  });
});

describe('autonomous lifecycle & result ingestion', () => {
  let adminToken = '';

  const adminLogin = async () => {
    if (adminToken) return adminToken;
    const login = await post<Session>('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    expect(login.status).toBe(200);
    expect(login.json.user.role).toBe('admin');
    adminToken = login.json.tokens.accessToken;
    return adminToken;
  };

  const waitFor = async <T,>(fn: () => Promise<T | null>, ms = 10_000): Promise<T> => {
    const deadline = Date.now() + ms;
    for (;;) {
      const v = await fn();
      if (v !== null) return v;
      if (Date.now() > deadline) throw new Error('condition not met in time');
      await new Promise((r) => setTimeout(r, 300));
    }
  };

  it('phases advance from the schedule clock alone — no manual toggles', async () => {
    const tk = await adminLogin();
    const sweep = await post('/api/v1/admin/lifecycle/sweep', undefined, tk);
    expect(sweep.status).toBeLessThan(300);

    // clock is pinned 30' into the real opener
    const opener = await get('/api/v1/matches/1');
    expect(opener.json.status).toBe('live');

    // a match days away stays scheduled
    const future = await get('/api/v1/matches/10');
    expect(future.json.status).toBe('scheduled');
  });

  it('a result claim filed while the match cannot be over is HELD — even with operator authority', async () => {
    const tk = await adminLogin();

    // clock is 30' after kickoff — nobody can know the final score yet
    const early = await post<{ accepted: boolean; held: boolean; earliestAcceptanceUtc: string }>(
      '/api/v1/admin/results/1',
      {
        homeScore: 2,
        awayScore: 1,
        events: [
          { minute: 23, type: 'goal', team: 'MEX' },
          { minute: 58, type: 'goal', team: 'RSA' },
          { minute: 80, type: 'goal', team: 'MEX' },
        ],
      },
      tk,
    );
    expect(early.status).toBeLessThan(300);
    expect(early.json.accepted).toBe(false);
    expect(early.json.held).toBe(true);
    // earliest acceptance = kickoff (19:00Z) + 112'
    expect(early.json.earliestAcceptanceUtc).toBe('2026-06-11T20:52:00.000Z');

    // match is still governed by the clock, claim parked in the ledger
    expect((await get('/api/v1/matches/1')).json.status).toBe('live');
    const heldClaims = await get('/api/v1/admin/ingestion/claims?match=1', tk);
    expect(heldClaims.json.some((c: any) => c.status === 'pending')).toBe(true);
    const heldLogs = await get('/api/v1/admin/ingestion-logs', tk);
    expect(heldLogs.json.some((l: any) => l.dataType === 'result_held_early')).toBe(true);
  });

  it('the held claim auto-accepts once the clock window opens — zero manual steps', async () => {
    const tk = await adminLogin();
    const eloBefore = (await get('/api/v1/countries/MEX')).json.eloRating;

    // time passes: 2h after kickoff the match can plausibly be finished
    process.env.SIM_CLOCK_OFFSET_MS = String(new Date('2026-06-11T21:00:00Z').getTime() - Date.now());
    await post('/api/v1/admin/lifecycle/sweep', undefined, tk);

    // phase transition fires the bus; the parked claim resolves autonomously
    const match = await waitFor(async () => {
      const r = await get('/api/v1/matches/1');
      return r.json.status === 'completed' ? r.json : null;
    });
    expect(match.homeScore).toBe(2);

    const standings = await get('/api/v1/standings');
    const mex = standings.json.A.find((row: any) => row.team === 'MEX');
    expect(mex.points).toBe(3);
    expect(mex.played).toBe(1);

    // claim ledger records the accepted claim
    const claims = await get('/api/v1/admin/ingestion/claims?match=1', tk);
    expect(claims.json.some((c: any) => c.status === 'accepted' && c.source === 'official_admin')).toBe(true);

    // model retrains autonomously: Elo K=60 update lands (async pipeline)
    await waitFor(async () => {
      const elo = (await get('/api/v1/countries/MEX')).json.eloRating;
      return elo !== eloBefore ? elo : null;
    });

    const logs = await get('/api/v1/admin/ingestion-logs', tk);
    expect(logs.status).toBe(200);
    expect(logs.json.some((l: any) => l.dataType === 'match_result')).toBe(true);
  });

  it('external feeds complete a match only via agreeing weighted consensus', async () => {
    const tk = await adminLogin();

    // advance the clock past M2's plausible-finish window (kickoff 2026-06-12T02:00Z)
    process.env.SIM_CLOCK_OFFSET_MS = String(new Date('2026-06-12T04:00:00Z').getTime() - Date.now());
    await post('/api/v1/admin/lifecycle/sweep', undefined, tk);

    // feed_alpha (0.5) alone is below the 0.9 threshold
    const first = await post<{ accepted: boolean }>('/api/v1/admin/ingestion/claims/feed_alpha/2', { homeScore: 2, awayScore: 0 }, tk);
    expect(first.json.accepted).toBe(false);
    expect((await get('/api/v1/matches/2')).json.status).not.toBe('completed');

    // feed_beta DISAGREES — conflict is logged, match stays open
    const conflict = await post<{ accepted: boolean }>('/api/v1/admin/ingestion/claims/feed_beta/2', { homeScore: 1, awayScore: 0 }, tk);
    expect(conflict.json.accepted).toBe(false);
    const logs = await get('/api/v1/admin/ingestion-logs', tk);
    expect(logs.json.some((l: any) => l.dataType === 'result_conflict')).toBe(true);

    // feed_beta corrects to AGREE → 0.5 + 0.45 ≥ 0.9 → accepted autonomously
    const agree = await post<{ accepted: boolean; consensusWeight: number }>(
      '/api/v1/admin/ingestion/claims/feed_beta/2',
      { homeScore: 2, awayScore: 0 },
      tk,
    );
    expect(agree.json.accepted).toBe(true);
    expect(agree.json.consensusWeight).toBeGreaterThanOrEqual(0.9);

    const match = await get('/api/v1/matches/2');
    expect(match.json.status).toBe('completed');
    expect(match.json.homeScore).toBe(2);
  });

  it('retraction reverses the entire pipeline and returns the match to the clock', async () => {
    const tk = await adminLogin();
    const eloAfterResult = (await get('/api/v1/countries/MEX')).json.eloRating;

    const retract = await http('DELETE', '/api/v1/admin/results/1', { token: tk, body: { reason: 'e2e correction test' } });
    expect(retract.status).toBeLessThan(300);
    expect(['live', 'half_time', 'extra_time', 'awaiting_result']).toContain(retract.json.revertedTo);

    const match = await get('/api/v1/matches/1');
    expect(match.json.status).toBe(retract.json.revertedTo);
    expect(match.json.homeScore).toBeNull();

    const standings = await get('/api/v1/standings');
    const mex = standings.json.A.find((row: any) => row.team === 'MEX');
    expect(mex.played).toBe(0);
    expect(mex.points).toBe(0);

    const claims = await get('/api/v1/admin/ingestion/claims?match=1', tk);
    expect(claims.json.every((c: any) => c.status !== 'accepted')).toBe(true);

    // Elo reversal lands asynchronously and exactly
    await waitFor(async () => {
      const elo = (await get('/api/v1/countries/MEX')).json.eloRating;
      return elo !== eloAfterResult ? elo : null;
    });
  });
});

describe('match intelligence & tournament forecast', () => {
  it('serves the full multi-factor intelligence panel', async () => {
    const r = await get('/api/v1/intelligence/match/19'); // ARG vs ALG, in the future
    expect(r.status).toBe(200);
    const p = r.json.prediction;
    expect(p.homeWin + p.draw + p.awayWin).toBeCloseTo(1, 3);
    expect(p.upset.tier).toMatch(/low|medium|high|extreme/);
    expect(p.explanation.whyFavored.length).toBeGreaterThan(0);
    expect(p.explanation.whyUnderdogCanWin.length).toBeGreaterThan(0);
    expect(p.explanation.dataCoverage.some((d: any) => d.status === 'unavailable')).toBe(true);
    expect(p.tactics.home.axes.pressing).toBeGreaterThanOrEqual(0);
    expect(p.fatigue.home.label).toBeTruthy();
    expect(p.conditions.venueId).toBeTruthy();
    expect(p.uncertainty.homeWin).toHaveLength(2);
  });

  it('keeps a prediction audit trail with triggers', async () => {
    const history = await get('/api/v1/intelligence/match/19/history');
    expect(history.status).toBe(200);
    expect(history.json.length).toBeGreaterThanOrEqual(1);
    expect(history.json[0].trigger).toBeTruthy();
    expect(history.json[0].homeWin).toBeGreaterThan(0);
  });

  it('exposes model calibration transparency', async () => {
    const r = await get('/api/v1/intelligence/model');
    expect(r.status).toBe(200);
    expect(r.json.modelVersion).toBeGreaterThanOrEqual(2);
    expect(r.json.resultSources.some((s: any) => s.name === 'official_admin')).toBe(true);
  });

  it('computes qualification probabilities and power rankings from the system forecast', async () => {
    const login = await post<Session>('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD });
    const refresh = await post('/api/v1/admin/forecast/refresh', undefined, login.json.tokens.accessToken);
    expect(refresh.status).toBeLessThan(300);

    const qual = await get('/api/v1/tournament/qualification');
    expect(qual.json.teams).toHaveLength(48);
    const total = qual.json.teams.reduce((a: number, t: any) => a + t.champion, 0);
    expect(total).toBeGreaterThan(0.95);
    expect(total).toBeLessThan(1.05);

    const power = await get('/api/v1/tournament/power-rankings');
    expect(power.json).toHaveLength(48);
    expect(power.json[0].rank).toBe(1);
    expect(power.json[0].score).toBeGreaterThanOrEqual(power.json[47].score);
  });
});

describe('graphql', () => {
  it('queries countries and match; rejects unauthenticated myTeam', async () => {
    const q = await post('/graphql', {
      query: 'query { countries { code name eloRating } match(matchNumber: 2) { matchNumber stage } }',
    });
    expect(q.status).toBe(200);
    expect(q.json.data.countries).toHaveLength(48);
    expect(q.json.data.match.matchNumber).toBe(2);

    const denied = await post('/graphql', { query: 'query { myTeam }' });
    expect(denied.json.errors?.[0]?.extensions?.code).toBe('UNAUTHENTICATED');

    const { tokens } = await register();
    const my = await fetch(`${base}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tokens.accessToken}` },
      body: JSON.stringify({ query: 'query { myTeam }' }),
    }).then((r) => r.json());
    expect(my.errors).toBeUndefined();
  });
});
