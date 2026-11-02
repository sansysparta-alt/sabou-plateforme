import { describe, expect, it, vi } from 'vitest';
import {
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresDialect,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import type { Pool } from 'pg';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import { healthResponseSchema, readinessResponseSchema } from '@sabou/types';
import type { Database } from '../database/database';
import { HealthController } from './health.controller';

// Base qui répond à toute requête par un résultat vide
const reachableDb: Database = new Kysely({
  dialect: {
    createAdapter: () => new PostgresAdapter(),
    createDriver: () => new DummyDriver(),
    createIntrospector: (db) => new PostgresIntrospector(db),
    createQueryCompiler: () => new PostgresQueryCompiler(),
  },
});

// Base injoignable : toute connexion échoue
const unreachableDb: Database = new Kysely({
  dialect: new PostgresDialect({
    pool: {
      connect: () => Promise.reject(new Error('connect ECONNREFUSED 127.0.0.1:5432')),
      end: () => Promise.resolve(),
    } as unknown as Pool,
  }),
});

describe('HealthController', () => {
  it('renvoie une réponse conforme au schéma partagé', () => {
    const response = new HealthController(reachableDb).check();
    expect(healthResponseSchema.parse(response)).toEqual({ status: 'ok', service: 'api' });
  });

  it('confirme la lecture de la base quand elle répond', async () => {
    const response = await new HealthController(reachableDb).ready();
    expect(readinessResponseSchema.parse(response)).toEqual({
      status: 'ok',
      service: 'api',
      database: 'ok',
    });
  });

  it('répond 503 sans détail technique quand la base est injoignable', async () => {
    const logged = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const error = await new HealthController(unreachableDb).ready().catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ServiceUnavailableException);
    const body = (error as ServiceUnavailableException).getResponse();
    expect(readinessResponseSchema.parse(body)).toEqual({
      status: 'error',
      service: 'api',
      database: 'unavailable',
    });
    // Le détail reste dans les journaux, jamais dans la réponse
    expect(JSON.stringify(body)).not.toContain('ECONNREFUSED');
    expect(logged).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
  });
});
