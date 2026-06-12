'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useAuth } from '../lib/auth';
import { useApi } from '../lib/hooks';
import { Badge } from './ui';

const LINKS = [
  { href: '/', label: 'Home' },
  { href: '/simulator', label: 'Simulator' },
  { href: '/tournament', label: 'Tournament' },
  { href: '/matches', label: 'Matches' },
  { href: '/my-team', label: 'My Team' },
  { href: '/players', label: 'Players' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/leagues', label: 'Leagues' },
];

const IN_PLAY = ['live', 'half_time', 'extra_time', 'penalties'];

export function Nav() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  // global live indicator — updates itself the moment a phase changes
  const { data: matches } = useApi<any[]>('/matches', { auth: false, refreshOn: ['MATCH_PHASE'] });
  const liveCount = useMemo(() => matches?.filter((m) => IN_PLAY.includes(m.status)).length ?? 0, [matches]);

  return (
    <header className="sticky top-0 z-40 border-b border-line/60 bg-bg/80 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
        <Link href="/" className="group flex items-center gap-2.5 font-bold">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-primary to-warning text-base text-white shadow-[0_2px_14px_-2px] shadow-primary/50 transition group-hover:scale-105">
            ⚽
          </span>
          <span className="hidden leading-none sm:block">
            <span className="block text-[15px] tracking-tight">
              FIFA <span className="text-gradient">2026</span>
            </span>
            <span className="block text-[9px] font-medium uppercase tracking-[0.22em] text-muted">Where data meets destiny</span>
          </span>
        </Link>

        <nav className="hidden flex-1 items-center gap-0.5 lg:flex">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={`relative rounded-lg px-3 py-1.5 text-sm transition-colors ${
                pathname === l.href ? 'bg-primary/12 font-semibold text-primary' : 'text-muted hover:bg-elevated/60 hover:text-txt'
              }`}
            >
              {l.label}
              {l.href === '/matches' && liveCount > 0 && (
                <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-danger px-1 text-[9px] font-black text-white">
                  {liveCount}
                </span>
              )}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {liveCount > 0 && (
            <Link
              href="/matches"
              className="hidden items-center gap-1.5 rounded-full border border-danger/40 bg-danger/10 px-2.5 py-1 text-[11px] font-bold text-danger md:inline-flex"
            >
              <span className="live-dot inline-block h-1.5 w-1.5 rounded-full bg-danger" />
              {liveCount} LIVE
            </Link>
          )}
          {user ? (
            <>
              {user.role === 'premium' && <Badge color="gold">PREMIUM</Badge>}
              {user.role === 'admin' && (
                <Link href="/admin">
                  <Badge color="danger">ADMIN</Badge>
                </Link>
              )}
              <Link
                href="/profile"
                className="flex items-center gap-2 rounded-full border border-line bg-elevated/70 py-1 pl-1 pr-3 text-sm font-medium transition hover:border-primary/50"
              >
                <span className="grid h-6 w-6 place-items-center rounded-full bg-gradient-to-br from-primary to-warning text-[11px] font-bold text-white">
                  {user.username.slice(0, 1).toUpperCase()}
                </span>
                {user.username}
              </Link>
              <button onClick={() => void logout()} className="text-xs text-muted transition hover:text-danger">
                Sign out
              </button>
            </>
          ) : (
            <>
              <Link href="/login" className="rounded-lg px-3 py-1.5 text-sm text-muted transition hover:text-txt">
                Log in
              </Link>
              <Link href="/register" className="btn-gradient rounded-full px-4 py-1.5 text-sm font-semibold">
                Sign up
              </Link>
            </>
          )}
          <button className="lg:hidden" onClick={() => setOpen(!open)} aria-label="Menu">
            <span className="text-xl">☰</span>
          </button>
        </div>
      </div>
      {open && (
        <nav className="border-t border-line/60 px-4 py-2 lg:hidden">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className={`block rounded-lg px-3 py-2 text-sm ${pathname === l.href ? 'text-primary' : 'text-muted'}`}
            >
              {l.label}
              {l.href === '/matches' && liveCount > 0 && <span className="ml-2 text-[10px] font-bold text-danger">● {liveCount} live</span>}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}
