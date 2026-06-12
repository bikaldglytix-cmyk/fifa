import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { createPublicKey } from 'node:crypto';
import { decode, verify, type JwtHeader } from 'jsonwebtoken';
import { eq, sql } from 'drizzle-orm';
import { users } from '@fifa/db';
import { DbService } from './db.service';
import type { AuthUser } from './auth.guard';

/**
 * Supabase identity integration. End users authenticate against the Supabase
 * project; this service verifies their access tokens server-side (asymmetric
 * JWKS by default, optional legacy HS256 via SUPABASE_JWT_SECRET) and
 * provisions a local profile row on first sight — all existing domain tables
 * keep their users.id foreign keys, with id = the Supabase user id.
 */

interface Jwk {
  kid: string;
  kty: string;
  alg?: string;
  [k: string]: unknown;
}

const JWKS_TTL_MS = 10 * 60_000;
const USER_CACHE_TTL_MS = 60_000;

@Injectable()
export class SupabaseAuthService {
  private readonly logger = new Logger(SupabaseAuthService.name);
  private jwks: { keys: Jwk[]; fetchedAt: number } | null = null;
  private pemByKid = new Map<string, string>();
  private userCache = new Map<string, { user: AuthUser; at: number }>();

  constructor(private readonly dbs: DbService) {}

  get configured(): boolean {
    return Boolean(process.env.SUPABASE_URL);
  }

  private get issuer(): string {
    return `${(process.env.SUPABASE_URL ?? '').replace(/\/$/, '')}/auth/v1`;
  }

  /** Verifies a Supabase access token and returns the local AuthUser (provisioning if new). */
  async authenticate(token: string): Promise<AuthUser | null> {
    if (!this.configured) return null;
    const payload = await this.verifyToken(token);
    if (!payload?.sub) return null;
    return this.resolveUser(payload);
  }

  // --- token verification ------------------------------------------------------

  private async verifyToken(token: string): Promise<any | null> {
    const decoded = decode(token, { complete: true }) as { header: JwtHeader; payload: any } | null;
    if (!decoded) return null;
    // cheap pre-check before any crypto: must be our project's token
    if (decoded.payload?.iss !== this.issuer) return null;

    const { alg, kid } = decoded.header;
    try {
      if (alg === 'HS256') {
        const secret = process.env.SUPABASE_JWT_SECRET;
        if (!secret) {
          this.logger.warn(
            'Supabase token is HS256 but SUPABASE_JWT_SECRET is not set — migrate the project to asymmetric JWT signing keys (Dashboard → Settings → JWT keys) or provide the secret',
          );
          return null;
        }
        return verify(token, secret, { algorithms: ['HS256'], issuer: this.issuer, audience: 'authenticated' });
      }
      const pem = await this.pemFor(kid);
      if (!pem) return null;
      return verify(token, pem, { algorithms: ['ES256', 'RS256'], issuer: this.issuer, audience: 'authenticated' });
    } catch {
      return null; // expired / bad signature — caller decides on 401
    }
  }

  private async pemFor(kid: string | undefined): Promise<string | null> {
    if (!kid) return null;
    const cached = this.pemByKid.get(kid);
    if (cached && this.jwks && Date.now() - this.jwks.fetchedAt < JWKS_TTL_MS) return cached;

    if (!this.jwks || Date.now() - this.jwks.fetchedAt >= JWKS_TTL_MS || !this.jwks.keys.some((k) => k.kid === kid)) {
      try {
        const res = await fetch(`${this.issuer}/.well-known/jwks.json`, { signal: AbortSignal.timeout(5_000) });
        if (!res.ok) throw new Error(`JWKS HTTP ${res.status}`);
        const body = (await res.json()) as { keys: Jwk[] };
        this.jwks = { keys: body.keys ?? [], fetchedAt: Date.now() };
        this.pemByKid.clear();
        for (const jwk of this.jwks.keys) {
          try {
            this.pemByKid.set(jwk.kid, createPublicKey({ key: jwk as never, format: 'jwk' }).export({ type: 'spki', format: 'pem' }) as string);
          } catch {
            /* unsupported key type — skip */
          }
        }
        if (!this.jwks.keys.length) {
          this.logger.warn('Supabase JWKS is empty — the project may still use legacy HS256 signing (set SUPABASE_JWT_SECRET or migrate to signing keys)');
        }
      } catch (e: any) {
        this.logger.warn(`JWKS fetch failed: ${e?.message ?? e}`);
        return this.pemByKid.get(kid) ?? null; // stale key beats none
      }
    }
    return this.pemByKid.get(kid) ?? null;
  }

  // --- local profile provisioning -----------------------------------------------

  private async resolveUser(payload: any): Promise<AuthUser | null> {
    const sub: string = payload.sub;
    const hit = this.userCache.get(sub);
    if (hit && Date.now() - hit.at < USER_CACHE_TTL_MS) return hit.user;

    await this.dbs.ensureReady();
    const db = this.dbs.db;
    const email: string = payload.email ?? `${sub}@users.supabase`;

    let [row] = await db.select().from(users).where(eq(users.id, sub));
    if (!row) {
      // same person may have registered locally before — reuse that profile
      [row] = await db.select().from(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`);
    }
    if (!row) {
      const username = await this.uniqueUsername(
        (payload.user_metadata?.username as string | undefined) ?? email.split('@')[0] ?? 'fan',
      );
      const admins = (process.env.ADMIN_EMAILS ?? '')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter(Boolean);
      [row] = await db
        .insert(users)
        .values({
          id: sub,
          email,
          username,
          passwordHash: null, // identity lives in Supabase
          role: admins.includes(email.toLowerCase()) ? 'admin' : 'registered',
          emailVerified: Boolean(payload.user_metadata?.email_verified ?? true),
          lastLogin: new Date(),
        })
        .returning();
      this.logger.log(`provisioned Supabase user ${username} <${email}> (${row.role})`);
    }
    if (row.suspendedAt) throw new ForbiddenException('Account suspended');

    const user: AuthUser = { id: row.id, email: row.email, role: row.role, username: row.username };
    this.userCache.set(sub, { user, at: Date.now() });
    return user;
  }

  private async uniqueUsername(base: string): Promise<string> {
    const clean = base.replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 40) || 'fan';
    const db = this.dbs.db;
    for (let i = 0; i < 25; i++) {
      const candidate = i === 0 ? clean : `${clean}${Math.floor(1000 + Math.random() * 9000)}`;
      const [existing] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.username}) = ${candidate.toLowerCase()}`);
      if (!existing) return candidate;
    }
    return `${clean}-${Date.now().toString(36)}`;
  }

  /** Invalidate the profile cache (e.g. after admin role/suspension changes). */
  invalidate(userId?: string): void {
    if (userId) this.userCache.delete(userId);
    else this.userCache.clear();
  }
}
