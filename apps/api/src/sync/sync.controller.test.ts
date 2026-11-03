import { randomBytes, randomUUID } from 'node:crypto';
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { SignJWT } from 'jose';
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../config/env';
import { signSyncToken } from './sync-token';
import { SyncController } from './sync.controller';
import type { SyncRepository } from './sync.repository';

const secret = randomBytes(32).toString('base64url');
const env = { SYNC_JWT_SECRET: secret } as Env;
const labe = { id: 3, role: 'prefectoral', prefectureId: 4 };

function setup() {
  const receive = vi.fn<SyncRepository['receive']>(async (_agent, ops) =>
    ops.map((op) => ({ id: op.id, result: 'creee' as const })),
  );
  return { controller: new SyncController(env, { receive }), receive };
}

const operation = (overrides: object = {}) => ({
  op: 'PUT',
  table: 'saisie_terrain',
  id: randomUUID(),
  type: 'dossier',
  contenu: { praticien: 'Sékou Kourouma' },
  version_base: null,
  ...overrides,
});
const bearer = async (agent = labe, key = secret) => `Bearer ${await signSyncToken(agent, key)}`;

describe('SyncController : authentification (US-004)', () => {
  it.each([
    ['absent', undefined],
    ['sans « Bearer »', 'Token abc.def.ghi'],
    ['illisible', 'Bearer pas-un-jeton'],
  ])('refuse un jeton %s', async (_case, authorization) => {
    const { controller, receive } = setup();
    await expect(controller.upload(authorization, { operations: [operation()] })).rejects.toThrow(
      UnauthorizedException,
    );
    expect(receive).not.toHaveBeenCalled();
  });

  it('refuse un jeton signé avec une autre clé', async () => {
    const { controller } = setup();
    const forged = await bearer(labe, randomBytes(32).toString('base64url'));
    await expect(controller.upload(forged, { operations: [operation()] })).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('refuse un jeton expiré ou destiné à un autre service', async () => {
    const { controller } = setup();
    const key = Buffer.from(secret, 'base64url');
    const now = Math.floor(Date.now() / 1000);
    const expired = await new SignJWT({ role: 'prefectoral', prefecture_id: 4 })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('3')
      .setAudience('sabou-mobile')
      .setIssuedAt(now - 7200)
      .setExpirationTime(now - 3600)
      .sign(key);
    const otherAudience = await new SignJWT({ role: 'prefectoral' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('3')
      .setAudience('autre-service')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(key);
    for (const jwt of [expired, otherAudience]) {
      await expect(
        controller.upload(`Bearer ${jwt}`, { operations: [operation()] }),
      ).rejects.toThrow(UnauthorizedException);
    }
  });

  it('refuse un compte qui n’est pas agent préfectoral', async () => {
    const { controller, receive } = setup();
    const authorization = await bearer({ id: 6, role: 'praticien', prefectureId: 4 });
    await expect(controller.upload(authorization, { operations: [operation()] })).rejects.toThrow(
      ForbiddenException,
    );
    expect(receive).not.toHaveBeenCalled();
  });
});

describe('SyncController : lot envoyé par le téléphone', () => {
  it('transmet le lot avec l’agent du jeton, jamais une identité venue du corps', async () => {
    const { controller, receive } = setup();
    const op = operation({ version_base: 2 });
    const response = await controller.upload(await bearer(), { operations: [op] });
    expect(receive).toHaveBeenCalledWith(3, [op]);
    expect(response).toEqual({ results: [{ id: op.id, result: 'creee' }] });
  });

  it.each([
    ['vide', { operations: [] }],
    ['de plus de 50 opérations', { operations: Array.from({ length: 51 }, () => operation()) }],
    ['visant une autre table', { operations: [operation({ table: 'utilisateur' })] }],
    ['avec un identifiant qui n’est pas un UUID', { operations: [operation({ id: '42' })] }],
    ['avec un champ inconnu', { operations: [operation({ auteur_id: 1 })] }],
    ['avec un contenu qui n’est pas un objet', { operations: [operation({ contenu: 'texte' })] }],
  ])('refuse un lot %s, sans recopier son contenu dans l’erreur', async (_case, body) => {
    const { controller, receive } = setup();
    const error = await controller.upload(await bearer(), body).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(JSON.stringify((error as BadRequestException).getResponse())).not.toContain('Sékou');
    expect(receive).not.toHaveBeenCalled();
  });
});
