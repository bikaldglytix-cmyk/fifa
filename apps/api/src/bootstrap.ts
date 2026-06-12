import 'reflect-metadata';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { findRepoRoot } from '@fifa/db';
import { AppModule } from './app.module';

/** Minimal .env loader (repo root, then app dir) — no extra dependency. */
export function loadEnv(): void {
  for (const dir of [findRepoRoot(), process.cwd()]) {
    const file = join(dir, '.env');
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      }
    }
  }
}

/**
 * Builds the fully configured Nest application (CORS, security headers,
 * validation, /api/v1 prefix, Swagger). Shared by main.ts and the e2e tests
 * so tests exercise the exact production wiring.
 */
export async function createApp(options: { logger?: boolean } = {}): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: options.logger === false ? false : ['error', 'warn', 'log'],
  });

  const webOrigins = (process.env.WEB_ORIGINS ?? 'http://localhost:3100,http://127.0.0.1:3100').split(',');
  app.enableCors({ origin: webOrigins, credentials: true });
  app.set('trust proxy', true);

  // security headers (helmet-equivalent essentials without the dependency)
  app.use((req: any, res: any, next: any) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false }),
  );
  app.setGlobalPrefix('api/v1', { exclude: ['health', 'graphql'] });

  const swagger = new DocumentBuilder()
    .setTitle('FIFA 2026 World Cup Simulator API')
    .setDescription('REST API — GraphQL at /graphql, WebSocket (socket.io) on the same port')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));

  return app;
}
