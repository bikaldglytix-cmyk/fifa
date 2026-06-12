import { Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, gte, isNull, sql } from 'drizzle-orm';
import { fraudFlags, predictions, userSessions, users } from '@fifa/db';
import { DbService } from '../common/db.service';

/**
 * Fraud & anti-cheat heuristics (PRD §16.3):
 *  - inhuman submission cadence (sub-300ms form completions, burst spam)
 *  - identical-prediction flooding
 *  - multi-account detection via shared device fingerprints
 * Flags are recorded for admin review; repeated high-severity flags suspend.
 */
@Injectable()
export class FraudService {
  private readonly logger = new Logger(FraudService.name);
  private readonly recentSubmissions = new Map<string, number[]>(); // userId -> timestamps

  constructor(private readonly dbs: DbService) {}

  private get db() {
    return this.dbs.db;
  }

  async onPredictionSubmitted(userId: string, predictionId: string, submissionMs: number | null): Promise<void> {
    try {
      const now = Date.now();
      const times = this.recentSubmissions.get(userId) ?? [];
      const recent = times.filter((t) => now - t < 60_000);
      recent.push(now);
      this.recentSubmissions.set(userId, recent);

      if (submissionMs !== null && submissionMs < 300) {
        await this.flag(userId, 'inhuman_submission_speed', 'medium', { predictionId, submissionMs });
      }
      if (recent.length > 25) {
        await this.flag(userId, 'prediction_burst', 'high', { perMinute: recent.length });
      }

      // identical scoreline across most recent predictions (bot signature)
      const last = await this.db
        .select({ h: predictions.predictedHomeScore, a: predictions.predictedAwayScore })
        .from(predictions)
        .where(eq(predictions.userId, userId))
        .orderBy(desc(predictions.createdAt))
        .limit(12);
      if (last.length >= 10 && new Set(last.map((r) => `${r.h}-${r.a}`)).size === 1) {
        await this.flag(userId, 'identical_prediction_pattern', 'medium', { sample: last.length });
      }
    } catch (e) {
      this.logger.warn(`fraud check failed: ${e}`);
    }
  }

  async detectMultiAccounts(userId: string): Promise<string[]> {
    const sessions = await this.db
      .select({ fp: userSessions.deviceFingerprint })
      .from(userSessions)
      .where(and(eq(userSessions.userId, userId), sql`${userSessions.deviceFingerprint} is not null`));
    const fps = [...new Set(sessions.map((s) => s.fp).filter(Boolean))] as string[];
    if (!fps.length) return [];

    const others = new Set<string>();
    for (const fp of fps) {
      const rows = await this.db
        .select({ userId: userSessions.userId })
        .from(userSessions)
        .where(and(eq(userSessions.deviceFingerprint, fp), sql`${userSessions.userId} != ${userId}`));
      for (const r of rows) others.add(r.userId);
    }
    if (others.size) {
      await this.flag(userId, 'shared_device_fingerprint', 'high', { relatedAccounts: [...others] });
    }
    return [...others];
  }

  private async flag(userId: string, reason: string, severity: 'low' | 'medium' | 'high', details: unknown): Promise<void> {
    await this.db.insert(fraudFlags).values({ userId, reason, severity, details: details as never });

    if (severity === 'high') {
      const [{ count }] = await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(fraudFlags)
        .where(and(eq(fraudFlags.userId, userId), eq(fraudFlags.severity, 'high'), isNull(fraudFlags.resolvedAt)));
      if (count >= 3) {
        await this.db
          .update(users)
          .set({ suspendedAt: new Date(), suspensionReason: 'Automated suspension: repeated integrity flags (pending review)' })
          .where(eq(users.id, userId));
        this.logger.warn(`user ${userId} auto-suspended after ${count} high-severity flags`);
      }
    }
  }

  async listFlags(unresolvedOnly = true) {
    return unresolvedOnly
      ? this.db.select().from(fraudFlags).where(isNull(fraudFlags.resolvedAt)).orderBy(desc(fraudFlags.createdAt))
      : this.db.select().from(fraudFlags).orderBy(desc(fraudFlags.createdAt)).limit(200);
  }

  async resolveFlag(flagId: number, adminId: string) {
    await this.db.update(fraudFlags).set({ resolvedAt: new Date(), resolvedBy: adminId }).where(eq(fraudFlags.id, flagId));
    return { resolved: true };
  }
}
