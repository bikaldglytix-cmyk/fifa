'use client';

/**
 * API client: token storage, transparent refresh-rotation on 401, typed verbs.
 * Requests go through Next rewrites (/api/v1 → API server) so no CORS in dev.
 */

const TOKENS_KEY = 'fifa2026.tokens';

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
}

export const tokenStore = {
  get(): StoredTokens | null {
    if (typeof window === 'undefined') return null;
    try {
      const raw = localStorage.getItem(TOKENS_KEY);
      return raw ? (JSON.parse(raw) as StoredTokens) : null;
    } catch {
      return null;
    }
  },
  set(tokens: StoredTokens | null): void {
    if (typeof window === 'undefined') return;
    if (tokens) localStorage.setItem(TOKENS_KEY, JSON.stringify(tokens));
    else localStorage.removeItem(TOKENS_KEY);
  },
};

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly body?: unknown,
  ) {
    super(message);
  }
}

/**
 * Primary bearer source (Supabase session token, kept fresh by the SDK).
 * Legacy tokenStore remains as the fallback for operator/local accounts.
 */
let bearerProvider: (() => string | null) | null = null;
export function setBearerProvider(fn: (() => string | null) | null): void {
  bearerProvider = fn;
}
export function currentBearer(): string | null {
  return bearerProvider?.() ?? tokenStore.get()?.accessToken ?? null;
}

let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  const tokens = tokenStore.get();
  if (!tokens?.refreshToken) return false;
  refreshing ??= (async () => {
    try {
      const res = await fetch('/api/v1/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens.refreshToken }),
      });
      if (!res.ok) {
        tokenStore.set(null);
        return false;
      }
      const next = (await res.json()) as { accessToken: string; refreshToken: string };
      tokenStore.set({ accessToken: next.accessToken, refreshToken: next.refreshToken });
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; auth?: boolean; retry?: boolean } = {},
): Promise<T> {
  const { method = 'GET', body, auth = true, retry = true } = options;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const bearer = currentBearer();
  if (auth && bearer) headers.Authorization = `Bearer ${bearer}`;

  const res = await fetch(`/api/v1${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && auth && retry && (await tryRefresh())) {
    return api(path, { ...options, retry: false });
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const msg = Array.isArray(json?.message) ? json.message.join('; ') : (json?.message ?? res.statusText);
    throw new ApiError(res.status, msg, json);
  }
  return json as T;
}

export const get = <T,>(path: string, auth = true) => api<T>(path, { auth });
export const post = <T,>(path: string, body?: unknown, auth = true) => api<T>(path, { method: 'POST', body, auth });
export const put = <T,>(path: string, body?: unknown) => api<T>(path, { method: 'PUT', body });
export const patch = <T,>(path: string, body?: unknown) => api<T>(path, { method: 'PATCH', body });
export const del = <T,>(path: string) => api<T>(path, { method: 'DELETE' });
