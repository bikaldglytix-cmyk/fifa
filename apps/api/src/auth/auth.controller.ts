import { Body, Controller, HttpCode, Post, Req, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { verify } from 'jsonwebtoken';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto, MfaCodeDto, MfaLoginDto, RefreshDto, RegisterDto } from './auth.dto';
import { CurrentUser, Public, type AuthUser } from '../common/auth.guard';
import { loadOrCreateKeys } from '../common/keys';

const meta = (req: Request) => ({
  ip: req.ip,
  userAgent: req.headers['user-agent'],
  fingerprint: (req.headers['x-device-fingerprint'] as string) ?? undefined,
});

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly publicKey = loadOrCreateKeys().publicKey;

  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('register')
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.auth.register(dto, meta(req));
  }

  @Public()
  @Throttle({ default: { limit: 15, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, meta(req));
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('mfa/login')
  mfaLogin(@Body() dto: MfaLoginDto, @Req() req: Request) {
    let payload: any;
    try {
      payload = verify(dto.mfaToken, this.publicKey, { algorithms: ['RS256'] });
    } catch {
      throw new UnauthorizedException('MFA challenge expired');
    }
    if (!payload?.mfa) throw new UnauthorizedException('Not an MFA token');
    return this.auth.completeMfaLogin(payload.sub, dto.code, meta(req));
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(200)
  @Post('refresh')
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, meta(req));
  }

  @ApiBearerAuth()
  @HttpCode(204)
  @Post('logout')
  async logout(@CurrentUser() user: AuthUser, @Body() body: Partial<RefreshDto>) {
    await this.auth.logout(user.id, body.refreshToken);
  }

  @ApiBearerAuth()
  @Post('mfa/setup')
  setupMfa(@CurrentUser() user: AuthUser) {
    return this.auth.setupMfa(user.id);
  }

  @ApiBearerAuth()
  @HttpCode(200)
  @Post('mfa/verify')
  verifyMfa(@CurrentUser() user: AuthUser, @Body() dto: MfaCodeDto) {
    return this.auth.verifyMfa(user.id, dto.code);
  }

  @ApiBearerAuth()
  @HttpCode(200)
  @Post('mfa/disable')
  disableMfa(@CurrentUser() user: AuthUser, @Body() dto: MfaCodeDto) {
    return this.auth.disableMfa(user.id, dto.code);
  }
}
