import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, tap } from 'rxjs';
import { auditLogs } from '@fifa/db';
import { DbService } from './db.service';

/** Persists an audit trail for every mutating REST call (PRD §6 audit_logs). */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(private readonly dbService: DbService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (ctx.getType<string>() !== 'http') return next.handle();
    const req = ctx.switchToHttp().getRequest();
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next.handle();
    // skip noisy/sensitive routes
    if (/\/auth\/(login|register|refresh|mfa)/.test(req.url)) return next.handle();

    return next.handle().pipe(
      tap({
        next: () => {
          void this.dbService.db
            .insert(auditLogs)
            .values({
              userId: req.user?.id ?? null,
              action: `${req.method} ${req.route?.path ?? req.url}`,
              entityType: req.url.split('/')[3] ?? null,
              newValues: sanitize(req.body),
              ipAddress: req.ip,
              userAgent: req.headers['user-agent'] ?? null,
            })
            .catch(() => undefined);
        },
      }),
    );
  }
}

function sanitize(body: unknown): unknown {
  if (!body || typeof body !== 'object') return null;
  const clone: Record<string, unknown> = { ...(body as Record<string, unknown>) };
  for (const k of Object.keys(clone)) {
    if (/password|token|secret|mfa/i.test(k)) clone[k] = '[redacted]';
  }
  return clone;
}
