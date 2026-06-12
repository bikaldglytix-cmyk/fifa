import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { getDb, type Db, type DbHandle } from '@fifa/db';

/**
 * Lazy, order-independent DB access: any service may call `ensureReady()`
 * before first use, so lifecycle-hook ordering can never race the connection.
 */
@Injectable()
export class DbService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DbService.name);
  private handle: DbHandle | null = null;
  private pending: Promise<DbHandle> | null = null;

  get db(): Db {
    if (!this.handle) throw new Error('Database not initialized — call ensureReady() first');
    return this.handle.db;
  }

  get kind(): 'postgres' | 'pglite' {
    if (!this.handle) throw new Error('Database not initialized');
    return this.handle.kind;
  }

  async ensureReady(): Promise<DbHandle> {
    if (this.handle) return this.handle;
    this.pending ??= getDb();
    this.handle = await this.pending;
    this.logger.log(`database connected (${this.handle.kind})`);
    return this.handle;
  }

  async onModuleInit(): Promise<void> {
    await this.ensureReady();
  }

  async onModuleDestroy(): Promise<void> {
    await this.handle?.close().catch(() => undefined);
  }
}
