import { describe, expect, it } from 'vitest';
import { healthResponseSchema, readinessResponseSchema } from './health.js';

describe('healthResponseSchema', () => {
  it('accepte une réponse valide', () => {
    expect(healthResponseSchema.parse({ status: 'ok', service: 'api' })).toEqual({
      status: 'ok',
      service: 'api',
    });
  });

  it('refuse un statut inconnu', () => {
    expect(healthResponseSchema.safeParse({ status: 'ko', service: 'api' }).success).toBe(false);
  });
});

describe('readinessResponseSchema', () => {
  it('accepte une base disponible et une base indisponible', () => {
    expect(
      readinessResponseSchema.safeParse({ status: 'ok', service: 'api', database: 'ok' }).success,
    ).toBe(true);
    expect(
      readinessResponseSchema.safeParse({
        status: 'error',
        service: 'api',
        database: 'unavailable',
      }).success,
    ).toBe(true);
  });

  it('refuse un état incohérent et tout champ en trop', () => {
    expect(
      readinessResponseSchema.safeParse({ status: 'ok', service: 'api', database: 'unavailable' })
        .success,
    ).toBe(false);
    expect(
      readinessResponseSchema.safeParse({
        status: 'ok',
        service: 'api',
        database: 'ok',
        version: '17.6',
      }).success,
    ).toBe(false);
  });
});
