import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { compare, hash } from 'bcryptjs';
import { sign } from 'jsonwebtoken';
import { authenticator } from 'otplib';
import { toDataURL } from 'qrcode';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  BCRYPT_COST,
  REFRESH_TOKEN_TTL_SECONDS,
  type AuthTokens,
  type PublicUser,
} from '@fifa/shared';
import { userPreferences, userSessions, users } from '@fifa/db';
import { DbService } from '../common/db.service';
import { loadOrCreateKeys } from '../common/keys';
import type { RegisterDto, LoginDto } from './auth.dto';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

@Injectable()
export class AuthService {
  private readonly privateKey = loadOrCreateKeys().privateKey;

  constructor(private readonly dbs: DbService) {}

  private get db() {
    return this.dbs.db;
  }

  // -------------------------------------------------------------------------

  async register(dto: RegisterDto, meta: SessionMeta): Promise<{ user: PublicUser; tokens: AuthTokens }> {
    const email = dto.email.toLowerCase().trim();
    const username = dto.username.trim();

    const clash = await this.db
      .select({ id: users.id, email: users.email, username: users.username })
      .from(users)
      .where(sql`lower(${users.email}) = ${email} or lower(${users.username}) = ${username.toLowerCase()}`);
    if (clash.length) {
      throw new ConflictException(
        clash[0].email.toLowerCase() === email ? 'Email already registered' : 'Username taken',
      );
    }

    const [row] = await this.db
      .insert(users)
      .values({
        email,
        username,
        passwordHash: await hash(dto.password, BCRYPT_COST),
        countryCode: dto.countryCode ?? null,
        role: 'registered',
      })
      .returning();
    await this.db.insert(userPreferences).values({ userId: row.id, favoriteTeamCountry: dto.countryCode ?? null });

    return { user: this.toPublic(row), tokens: await this.issueTokens(row, meta) };
  }

  async login(dto: LoginDto, meta: SessionMeta): Promise<
    | { user: PublicUser; tokens: AuthTokens; requiresMfa?: false }
    | { requiresMfa: true; mfaToken: string }
  > {
    const row = await this.findByEmail(dto.email);
    if (!row?.passwordHash || !(await compare(dto.password, row.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    if (!row.isActive || row.suspendedAt) throw new UnauthorizedException('Account suspended');

    if (row.mfaEnabled) {
      // short-lived MFA challenge token (5 min) — exchanged at /auth/mfa/login
      const mfaToken = sign({ sub: row.id, mfa: true }, this.privateKey, {
        algorithm: 'RS256',
        expiresIn: 300,
      });
      return { requiresMfa: true, mfaToken };
    }

    await this.db.update(users).set({ lastLogin: new Date() }).where(eq(users.id, row.id));
    return { user: this.toPublic(row), tokens: await this.issueTokens(row, meta) };
  }

  async completeMfaLogin(userId: string, code: string, meta: SessionMeta) {
    const row = await this.findById(userId);
    if (!row?.mfaSecret) throw new UnauthorizedException('MFA not configured');
    if (!authenticator.verify({ token: code, secret: row.mfaSecret })) {
      throw new UnauthorizedException('Invalid MFA code');
    }
    await this.db.update(users).set({ lastLogin: new Date() }).where(eq(users.id, row.id));
    return { user: this.toPublic(row), tokens: await this.issueTokens(row, meta) };
  }

  async refresh(refreshToken: string, meta: SessionMeta): Promise<AuthTokens> {
    const tokenHash = sha256(refreshToken);
    const [session] = await this.db
      .select()
      .from(userSessions)
      .where(
        and(
          eq(userSessions.refreshTokenHash, tokenHash),
          isNull(userSessions.revokedAt),
          gt(userSessions.expiresAt, new Date()),
        ),
      );
    if (!session) throw new UnauthorizedException('Invalid refresh token');

    const row = await this.findById(session.userId);
    if (!row || !row.isActive) throw new UnauthorizedException('Account unavailable');

    // rotation: revoke the used session, issue a fresh one
    await this.db.update(userSessions).set({ revokedAt: new Date() }).where(eq(userSessions.id, session.id));
    return this.issueTokens(row, meta);
  }

  async logout(userId: string, refreshToken?: string): Promise<void> {
    if (refreshToken) {
      await this.db
        .update(userSessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(userSessions.userId, userId), eq(userSessions.refreshTokenHash, sha256(refreshToken))));
    } else {
      await this.db.update(userSessions).set({ revokedAt: new Date() }).where(eq(userSessions.userId, userId));
    }
  }

  // --- MFA enrollment -------------------------------------------------------

  async setupMfa(userId: string): Promise<{ secret: string; otpauthUrl: string; qrDataUrl: string }> {
    const row = await this.findById(userId);
    if (!row) throw new UnauthorizedException();
    if (row.mfaEnabled) throw new BadRequestException('MFA already enabled');
    const secret = authenticator.generateSecret();
    const otpauthUrl = authenticator.keyuri(row.email, 'FIFA2026 Simulator', secret);
    // store pending secret on the user row until verified
    await this.db.update(users).set({ mfaSecret: secret }).where(eq(users.id, userId));
    return { secret, otpauthUrl, qrDataUrl: await toDataURL(otpauthUrl) };
  }

  async verifyMfa(userId: string, code: string): Promise<{ enabled: boolean }> {
    const row = await this.findById(userId);
    if (!row?.mfaSecret) throw new BadRequestException('Run MFA setup first');
    if (!authenticator.verify({ token: code, secret: row.mfaSecret })) {
      throw new UnauthorizedException('Invalid MFA code');
    }
    await this.db.update(users).set({ mfaEnabled: true }).where(eq(users.id, userId));
    return { enabled: true };
  }

  async disableMfa(userId: string, code: string): Promise<{ enabled: boolean }> {
    const row = await this.findById(userId);
    if (!row?.mfaEnabled || !row.mfaSecret) throw new BadRequestException('MFA not enabled');
    if (!authenticator.verify({ token: code, secret: row.mfaSecret })) {
      throw new UnauthorizedException('Invalid MFA code');
    }
    await this.db.update(users).set({ mfaEnabled: false, mfaSecret: null }).where(eq(users.id, userId));
    return { enabled: false };
  }

  // -------------------------------------------------------------------------

  private async issueTokens(row: typeof users.$inferSelect, meta: SessionMeta): Promise<AuthTokens> {
    const role = await this.effectiveRole(row);
    const accessToken = sign(
      { sub: row.id, email: row.email, username: row.username, role },
      this.privateKey,
      { algorithm: 'RS256', expiresIn: ACCESS_TOKEN_TTL_SECONDS },
    );
    const refreshToken = randomBytes(48).toString('hex');
    await this.db.insert(userSessions).values({
      userId: row.id,
      refreshTokenHash: sha256(refreshToken),
      userAgent: meta.userAgent ?? null,
      ipAddress: meta.ip ?? null,
      deviceFingerprint: meta.fingerprint ?? null,
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
    });
    return { accessToken, refreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS };
  }

  /** premium expiry downgrades automatically */
  private async effectiveRole(row: typeof users.$inferSelect) {
    if (row.role === 'premium' && row.premiumUntil && row.premiumUntil < new Date()) {
      await this.db.update(users).set({ role: 'registered' }).where(eq(users.id, row.id));
      return 'registered' as const;
    }
    return row.role;
  }

  private findByEmail(email: string) {
    return this.db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email.toLowerCase().trim()}`)
      .then((r) => r[0]);
  }

  private findById(id: string) {
    return this.db.select().from(users).where(eq(users.id, id)).then((r) => r[0]);
  }

  toPublic(row: typeof users.$inferSelect): PublicUser {
    return {
      id: row.id,
      username: row.username,
      email: row.email,
      role: row.role,
      countryCode: row.countryCode,
      favoriteTeam: row.countryCode,
      mfaEnabled: row.mfaEnabled,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

export interface SessionMeta {
  ip?: string;
  userAgent?: string;
  fingerprint?: string;
}
