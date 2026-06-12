import { Controller, Get } from '@nestjs/common';
import { Public } from './common/auth.guard';
import { DbService } from './common/db.service';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly dbs: DbService) {}

  @Get()
  health() {
    return {
      status: 'ok',
      database: this.dbs.kind,
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }
}
