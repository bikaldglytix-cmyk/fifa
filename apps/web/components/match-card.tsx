'use client';

import Link from 'next/link';
import type { LiveMatchStateDto } from '@fifa/shared';
import { Flag } from './ui';
import { ConfidenceMeter, PhaseChip, TriProbBar, UpsetBadge } from './intel';

export interface BoardMatch {
  matchNumber: number;
  phase: string;
  kickoffUtc: string;
  stage: string;
  groupLetter: string | null;
  venueId: string;
  home: string;
  away: string;
  homeScore: number | null;
  awayScore: number | null;
  /** real feed state while in play / awaiting result verification */
  live: LiveMatchStateDto | null;
  prediction: {
    homeWin: number;
    draw: number;
    awayWin: number;
    predictedScore: { home: number; away: number };
    confidence: number;
    confidenceLevel: string;
    upset: { tier: string; score: number; underdog: string };
    conditions: { city: string; avgHighC: number; altitudeM: number } | null;
  } | null;
}

const IN_PLAY = ['live', 'half_time', 'extra_time', 'penalties'];

/** Center cell: verified final > real live feed > kickoff + model view. */
function ScoreCell({ m }: { m: BoardMatch }) {
  if (m.homeScore != null) {
    return (
      <div>
        <div className="mb-0.5 text-[9px] font-bold uppercase tracking-wider text-muted">Actual</div>
        <span className="font-mono text-2xl font-black">{m.homeScore}–{m.awayScore}</span>
      </div>
    );
  }
  if (m.live) {
    return (
      <div>
        <div className="font-mono text-2xl font-black">
          {m.live.homeScore}–{m.live.awayScore}
        </div>
        {m.live.homePenalties != null && (
          <div className="font-mono text-[10px] text-muted">({m.live.homePenalties}–{m.live.awayPenalties} pens)</div>
        )}
        <div className="font-mono text-[11px] font-bold text-danger">
          {m.live.finished || m.phase === 'awaiting_result' ? (
            <span className="text-warning">FT · verifying</span>
          ) : (
            <>
              <span className="live-dot mr-1 inline-block h-1.5 w-1.5 rounded-full bg-danger align-middle" />
              {m.live.phase === 'half_time' ? 'HT' : m.live.minuteLabel ?? 'LIVE'}
            </>
          )}
        </div>
      </div>
    );
  }
  const kickoff = new Date(m.kickoffUtc);
  return (
    <div>
      <div className="font-mono text-sm font-bold text-muted">
        {kickoff.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
      </div>
      {m.prediction && (
        <div className="text-[10px] text-muted">
          predicted: <b className="text-txt">{m.prediction.predictedScore.home}–{m.prediction.predictedScore.away}</b>
        </div>
      )}
    </div>
  );
}

/** Premium match card: identity, live state, model view, conditions. */
export function MatchCard({ m, venueName }: { m: BoardMatch; venueName?: string }) {
  const inPlay = IN_PLAY.includes(m.phase);
  const lastGoal = m.live?.events?.length ? m.live.events[m.live.events.length - 1] : null;

  return (
    <Link
      href={`/match/${m.matchNumber}`}
      className={`slide-up grid gap-3 rounded-xl border bg-card p-4 transition hover:border-primary/60 ${
        inPlay ? 'border-danger/50' : 'border-line'
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] text-muted">
          M{m.matchNumber} · {m.stage === 'group' ? `Group ${m.groupLetter}` : m.stage.replace(/_/g, ' ')}
        </span>
        <div className="flex items-center gap-1.5">
          {m.prediction && <UpsetBadge tier={m.prediction.upset.tier} score={m.prediction.upset.score} underdog={m.prediction.upset.underdog} />}
          <PhaseChip phase={m.phase} />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Flag code={m.home} size={30} />
          <b className="truncate">{m.home}</b>
        </div>
        <div className="px-2 text-center">
          <ScoreCell m={m} />
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          <b className="truncate">{m.away}</b>
          <Flag code={m.away} size={30} />
        </div>
      </div>

      {inPlay && lastGoal && (
        <div className="slide-up text-center text-[11px] text-muted">
          Goal {lastGoal.minuteLabel} <b className="text-txt">{lastGoal.player ?? 'Goal'}</b> ({lastGoal.teamCode})
        </div>
      )}

      {m.prediction ? (
        <>
          <TriProbBar
            home={m.prediction.homeWin}
            draw={m.prediction.draw}
            away={m.prediction.awayWin}
            homeCode={m.home}
            awayCode={m.away}
          />
          <div className="flex items-end justify-between gap-3">
            <div className="flex-1">
              <ConfidenceMeter level={m.prediction.confidenceLevel} value={m.prediction.confidence} />
            </div>
            <div className="text-right text-[10px] leading-4 text-muted">
              {venueName && <div>{venueName}</div>}
              {m.prediction.conditions && (
                <div>
                  {m.prediction.conditions.city} · ~{m.prediction.conditions.avgHighC}°C
                  {m.prediction.conditions.altitudeM >= 1400 ? ` · ${m.prediction.conditions.altitudeM}m alt` : ''}
                </div>
              )}
            </div>
          </div>
        </>
      ) : (
        <p className="text-center text-xs text-muted">Participants not decided yet — projections activate when the bracket resolves.</p>
      )}
    </Link>
  );
}
