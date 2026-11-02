import {
  Controller,
  Get,
  Header,
  Inject,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { sql } from 'kysely';
import type { HealthResponse, ReadinessResponse } from '@sabou/types';
import { DATABASE, type Database } from '../database/database';

@Controller('health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  // L'API répond, sans dépendre de la base
  @Get()
  @Header('Cache-Control', 'no-store')
  check(): HealthResponse {
    return { status: 'ok', service: 'api' };
  }

  // L'API lit la base : échoue si PostgreSQL est injoignable ou si PostGIS est absent
  @Get('ready')
  @Header('Cache-Control', 'no-store')
  async ready(): Promise<ReadinessResponse> {
    try {
      await sql`SELECT public.postgis_lib_version()`.execute(this.db);
      return { status: 'ok', service: 'api', database: 'ok' };
    } catch (error) {
      this.logger.error(`Base indisponible : ${error instanceof Error ? error.message : error}`);
      const body: ReadinessResponse = { status: 'error', service: 'api', database: 'unavailable' };
      throw new ServiceUnavailableException(body);
    }
  }
}
