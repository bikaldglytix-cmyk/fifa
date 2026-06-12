import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { verify } from 'jsonwebtoken';
import type { UserRole } from '@fifa/shared';
import { loadOrCreateKeys } from './keys';
import { SupabaseAuthService } from './supabase-auth.service';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  username: string;
}

export const PUBLIC_KEY = 'isPublic';
export const OPTIONAL_AUTH_KEY = 'optionalAuth';
export const ROLES_KEY = 'roles';

/** Route is reachable without a token. */
export const Public = () => SetMetadata(PUBLIC_KEY, true);
/** Token parsed when present; route still reachable anonymously. */
export const OptionalAuth = () => SetMetadata(OPTIONAL_AUTH_KEY, true);
/** Restrict to roles (admin implies everything). */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser | null => {
  const req = requestOf(ctx);
  return req.user ?? null;
});

function requestOf(ctx: ExecutionContext): any {
  if (ctx.getType<string>() === 'graphql') {
    return GqlExecutionContext.create(ctx).getContext().req;
  }
  return ctx.switchToHttp().getRequest();
}

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly publicKey = loadOrCreateKeys().publicKey;

  constructor(
    private readonly reflector: Reflector,
    private readonly supabase: SupabaseAuthService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [ctx.getHandler(), ctx.getClass()]);
    const optional = this.reflector.getAllAndOverride<boolean>(OPTIONAL_AUTH_KEY, [ctx.getHandler(), ctx.getClass()]);
    const req = requestOf(ctx);

    const header: string | undefined = req.headers?.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : null;

    if (token) {
      req.user = await this.resolveUser(token);
      if (!req.user && !isPublic && !optional) {
        throw new UnauthorizedException('Invalid or expired access token');
      }
    } else if (!isPublic && !optional) {
      throw new UnauthorizedException('Missing access token');
    }

    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (roles?.length) {
      const role: UserRole | undefined = req.user?.role;
      if (!role) throw new UnauthorizedException('Missing access token');
      if (role !== 'admin' && !roles.includes(role)) {
        throw new ForbiddenException(`Requires role: ${roles.join(' or ')}`);
      }
    }
    return true;
  }

  /** Dual-mode: platform-issued RS256 tokens (ops/e2e), else Supabase identity. */
  private async resolveUser(token: string): Promise<AuthUser | null> {
    try {
      const payload = verify(token, this.publicKey, { algorithms: ['RS256'] }) as any;
      return { id: payload.sub, email: payload.email, role: payload.role, username: payload.username } satisfies AuthUser;
    } catch {
      /* not a local token — try Supabase */
    }
    try {
      return await this.supabase.authenticate(token);
    } catch (e) {
      if (e instanceof ForbiddenException) throw e; // suspended account
      return null;
    }
  }
}
