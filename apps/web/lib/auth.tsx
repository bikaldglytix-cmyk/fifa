'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { PublicUser } from '@fifa/shared';
import { api, post, setBearerProvider, tokenStore } from './api';
import { supabase, supabaseConfigured } from './supabase';

/**
 * Auth: Supabase is the identity provider for end users (sessions persisted
 * and auto-refreshed by the SDK; the API verifies tokens via JWKS and
 * provisions a profile on first request). The platform's local login remains
 * as a fallback for the seeded operator account and legacy users — a single
 * login form tries Supabase first, then the local path (incl. MFA).
 */

interface AuthState {
  user: (PublicUser & { preferences?: any }) | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ requiresMfa?: boolean; mfaToken?: string }>;
  completeMfa: (mfaToken: string, code: string) => Promise<void>;
  register: (input: {
    email: string;
    username: string;
    password: string;
    countryCode?: string;
  }) => Promise<{ needsEmailConfirm?: boolean }>;
  resetPassword: (email: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

let currentSession: Session | null = null;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthState['user']>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    if (!currentSession && !tokenStore.get()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      // first authenticated call provisions the Supabase user server-side
      setUser(await api<AuthState['user']>('/users/me'));
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!supabaseConfigured()) {
      void refreshUser();
      return;
    }
    const sb = supabase();
    setBearerProvider(() => currentSession?.access_token ?? null);

    void sb.auth.getSession().then(({ data }) => {
      currentSession = data.session;
      void refreshUser();
    });

    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      currentSession = session;
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') void refreshUser();
      if (event === 'SIGNED_OUT') setUser(null);
      // TOKEN_REFRESHED needs no refetch — the provider reads the new token lazily
    });
    return () => sub.subscription.unsubscribe();
  }, [refreshUser]);

  const login = useCallback(
    async (email: string, password: string) => {
      if (supabaseConfigured()) {
        const { data, error } = await supabase().auth.signInWithPassword({ email, password });
        if (!error && data.session) {
          currentSession = data.session;
          await refreshUser();
          return {};
        }
        if (error && !/invalid|not.*found|credentials/i.test(error.message)) {
          throw new Error(error.message); // real failure (rate limit, email unconfirmed…)
        }
        // fall through: account may be a local/operator one
      }
      const res = await post<any>('/auth/login', { email, password }, false);
      if (res.requiresMfa) return { requiresMfa: true, mfaToken: res.mfaToken };
      tokenStore.set({ accessToken: res.tokens.accessToken, refreshToken: res.tokens.refreshToken });
      await refreshUser();
      return {};
    },
    [refreshUser],
  );

  const completeMfa = useCallback(
    async (mfaToken: string, code: string) => {
      const res = await post<any>('/auth/mfa/login', { mfaToken, code }, false);
      tokenStore.set({ accessToken: res.tokens.accessToken, refreshToken: res.tokens.refreshToken });
      await refreshUser();
    },
    [refreshUser],
  );

  const register = useCallback(
    async (input: { email: string; username: string; password: string; countryCode?: string }) => {
      if (!supabaseConfigured()) {
        const res = await post<any>('/auth/register', input, false);
        tokenStore.set({ accessToken: res.tokens.accessToken, refreshToken: res.tokens.refreshToken });
        await refreshUser();
        return {};
      }
      const { data, error } = await supabase().auth.signUp({
        email: input.email,
        password: input.password,
        options: { data: { username: input.username, country_code: input.countryCode ?? null } },
      });
      if (error) throw new Error(error.message);
      if (!data.session) return { needsEmailConfirm: true }; // project requires email confirmation
      currentSession = data.session;
      await refreshUser();
      return {};
    },
    [refreshUser],
  );

  const resetPassword = useCallback(async (email: string) => {
    if (!supabaseConfigured()) throw new Error('Password reset requires Supabase');
    const { error } = await supabase().auth.resetPasswordForEmail(email, {
      redirectTo: typeof window !== 'undefined' ? `${window.location.origin}/login` : undefined,
    });
    if (error) throw new Error(error.message);
  }, []);

  const logout = useCallback(async () => {
    if (supabaseConfigured()) {
      try {
        await supabase().auth.signOut();
      } catch {
        /* already signed out */
      }
      currentSession = null;
    }
    const tokens = tokenStore.get();
    try {
      if (tokens) await post('/auth/logout', { refreshToken: tokens.refreshToken });
    } catch {
      // session may already be gone
    }
    tokenStore.set(null);
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, completeMfa, register, resetPassword, logout, refreshUser }),
    [user, loading, login, completeMfa, register, resetPassword, logout, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
