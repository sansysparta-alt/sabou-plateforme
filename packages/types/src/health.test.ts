import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from './health.js';

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
