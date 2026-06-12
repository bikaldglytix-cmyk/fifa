'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { WS_EVENTS, type LiveMatchStateDto, type LiveStateBroadcast } from '@fifa/shared';
import { get } from './api';

/** App-wide shared socket: one connection, reference-counted subscribers. */
let sharedSocket: Socket | null = null;
let sharedRefs = 0;

function acquireSocket(): Socket {
  if (!sharedSocket) {
    const url = process.env.NEXT_PUBLIC_WS_URL ?? 'http://localhost:4000';
    sharedSocket = io(url, { transports: ['websocket', 'polling'] });
  }
  sharedRefs++;
  return sharedSocket;
}

function releaseSocket(): void {
  sharedRefs--;
  if (sharedRefs <= 0 && sharedSocket) {
    sharedSocket.disconnect();
    sharedSocket = null;
    sharedRefs = 0;
  }
}

/**
 * SWR-style data hook with realtime invalidation: pass `refreshOn` socket
 * events (MATCH_PHASE, PREDICTIONS_UPDATED, STANDINGS_UPDATED…) and the data
 * refetches itself the moment the server announces a change — no manual
 * refresh anywhere.
 */
export function useApi<T>(
  path: string | null,
  opts?: { auth?: boolean; refreshMs?: number; refreshOn?: string[] },
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));

  const reload = useCallback(async () => {
    if (!path) return;
    try {
      setData(await get<T>(path, opts?.auth ?? true));
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [path, opts?.auth]);

  useEffect(() => {
    setLoading(Boolean(path));
    void reload();
    if (opts?.refreshMs && path) {
      const t = setInterval(() => void reload(), opts.refreshMs);
      return () => clearInterval(t);
    }
  }, [reload, path, opts?.refreshMs]);

  const events = opts?.refreshOn?.join(',') ?? '';
  useEffect(() => {
    if (!events || !path) return;
    const socket = acquireSocket();
    const handler = () => void reload();
    for (const ev of events.split(',')) socket.on(ev, handler);
    return () => {
      for (const ev of events.split(',')) socket.off(ev, handler);
      releaseSocket();
    };
  }, [events, path, reload]);

  return { data, error, loading, reload };
}

/**
 * Real live-feed state for one match: seeds from the API payload (`initial`),
 * then updates instantly from MATCH_LIVE_UPDATE room broadcasts — the live
 * score ticks without any refetching.
 */
export function useLiveMatch(
  matchNumber: number | null,
  initial?: LiveMatchStateDto | null,
): LiveMatchStateDto | null {
  const socket = useSocket();
  const [state, setState] = useState<LiveMatchStateDto | null>(initial ?? null);

  // parent refetches (phase changes etc.) re-seed the snapshot. `initial` is a
  // new object identity every render — bail out unless the content moved, or
  // this effect becomes an infinite render loop.
  useEffect(() => {
    if (!initial) return;
    setState((prev) =>
      prev &&
      prev.fetchedAt === initial.fetchedAt &&
      prev.homeScore === initial.homeScore &&
      prev.awayScore === initial.awayScore &&
      prev.phase === initial.phase &&
      prev.minuteLabel === initial.minuteLabel
        ? prev
        : initial,
    );
  }, [initial]);

  useEffect(() => {
    if (!socket || !matchNumber) return;
    socket.emit(WS_EVENTS.SUBSCRIBE_MATCH, { matchNumber });
    const onUpdate = (p: LiveStateBroadcast) => {
      if (p?.kind === 'live_state' && p.state?.matchNumber === matchNumber) setState(p.state);
    };
    socket.on(WS_EVENTS.MATCH_LIVE_UPDATE, onUpdate);
    return () => {
      socket.emit(WS_EVENTS.UNSUBSCRIBE_MATCH, { matchNumber });
      socket.off(WS_EVENTS.MATCH_LIVE_UPDATE, onUpdate);
    };
  }, [socket, matchNumber]);

  return state;
}

/** Shared socket.io connection to the API server. */
export function useSocket(): Socket | null {
  const [socket, setSocket] = useState<Socket | null>(null);
  useEffect(() => {
    const s = acquireSocket();
    setSocket(s);
    return () => {
      releaseSocket();
      setSocket(null);
    };
  }, []);
  return socket;
}

export function useCountdown(targetIso: string | null): string {
  const [text, setText] = useState('');
  useEffect(() => {
    if (!targetIso) return;
    const tick = () => {
      const diff = new Date(targetIso).getTime() - Date.now();
      if (diff <= 0) {
        setText('LIVE');
        return;
      }
      const d = Math.floor(diff / 86_400_000);
      const h = Math.floor((diff % 86_400_000) / 3_600_000);
      const m = Math.floor((diff % 3_600_000) / 60_000);
      const s = Math.floor((diff % 60_000) / 1000);
      setText(d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m ${s}s`);
    };
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, [targetIso]);
  return text;
}

export const fmtPct = (p: number | undefined | null, dp = 1): string =>
  p == null ? '–' : `${(p * 100).toFixed(dp)}%`;

export const flagUrl = (code: string, countries?: Array<{ code: string; flagUrl?: string | null }>): string => {
  const found = countries?.find((c) => c.code === code)?.flagUrl;
  return found ?? `https://flagcdn.com/w80/${code.toLowerCase()}.png`;
};
