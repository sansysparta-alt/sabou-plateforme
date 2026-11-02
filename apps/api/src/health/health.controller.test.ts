import { describe, expect, it } from 'vitest';
import { healthResponseSchema } from '@sabou/types';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('renvoie une réponse conforme au schéma partagé', () => {
    const response = new HealthController().check();
    expect(healthResponseSchema.parse(response)).toEqual({ status: 'ok', service: 'api' });
  });
});
