// Magasin de l'inscription (lot D : US-014) contre un vrai Valkey : le script Lua de
// vérification du code, les durées et les compteurs ne se simulent pas fidèlement.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Redis } from 'ioredis';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  SIGNUP_CODE_ATTEMPTS,
  SIGNUP_CODE_SECONDS,
  SIGNUP_TICKET_SECONDS,
  ValkeySignupStore,
} from './signup.store';

// Même image que l'environnement local (empreinte lue dans infra/local/compose.yaml)
function composeImage(name: string): string {
  const compose = readFileSync(
    join(__dirname, '..', '..', '..', '..', 'infra', 'local', 'compose.yaml'),
    'utf8',
  );
  const match = new RegExp(`image: (${name}@sha256:[0-9a-f]{64})`).exec(compose);
  if (!match) throw new Error(`Image ${name} introuvable dans infra/local/compose.yaml`);
  return match[1]!;
}

let container: StartedTestContainer;
let valkey: Redis;
let store: ValkeySignupStore;

beforeAll(async () => {
  container = await new GenericContainer(composeImage('valkey/valkey'))
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
    .start();
  valkey = new Redis(container.getMappedPort(6379), container.getHost());
  store = new ValkeySignupStore(valkey);
}, 120_000);

afterAll(async () => {
  valkey?.disconnect();
  await container?.stop();
});

beforeEach(() => valkey.flushall());

describe('Code de vérification', () => {
  it('accepte le bon code une seule fois, et seulement pour son numéro', async () => {
    await store.saveCode('621234567', '042917');
    expect(await store.checkCode('621234568', '042917')).toEqual({ result: 'expired' });
    expect(await store.checkCode('621234567', '042917')).toEqual({ result: 'valid' });
    expect(await store.checkCode('621234567', '042917')).toEqual({ result: 'expired' });
  });

  it(`efface le code après ${SIGNUP_CODE_ATTEMPTS} mauvais essais, même si le bon suit`, async () => {
    await store.saveCode('621234567', '042917');
    for (let left = SIGNUP_CODE_ATTEMPTS - 1; left > 0; left -= 1) {
      expect(await store.checkCode('621234567', '000000')).toEqual({
        result: 'invalid',
        remainingAttempts: left,
      });
    }
    expect(await store.checkCode('621234567', '000000')).toEqual({ result: 'expired' });
    expect(await store.checkCode('621234567', '042917')).toEqual({ result: 'expired' });
  });

  it('garde la durée de vie du code après un mauvais essai ; un nouveau code remplace l’ancien', async () => {
    await store.saveCode('621234567', '042917');
    await store.checkCode('621234567', '000000');
    const ttl = await valkey.ttl('sabou:inscription:code:621234567');
    expect(ttl).toBeGreaterThan(SIGNUP_CODE_SECONDS - 5);
    expect(ttl).toBeLessThanOrEqual(SIGNUP_CODE_SECONDS);
    await store.saveCode('621234567', '555111');
    expect(await store.checkCode('621234567', '042917')).toMatchObject({ result: 'invalid' });
    expect(await store.checkCode('621234567', '555111')).toEqual({ result: 'valid' });
  });

  it('n’écrit ni le code ni le ticket en clair', async () => {
    await store.saveCode('621234567', '042917');
    const ticket = await store.issueTicket('621234567');
    const dump = JSON.stringify(
      await Promise.all((await valkey.keys('*')).map(async (key) => [key, await valkey.get(key)])),
    );
    expect(dump).not.toContain('042917');
    expect(dump).not.toContain(ticket);
  });
});

describe('Ticket d’inscription', () => {
  it('ne sert qu’une fois ; peut être lu sans être consommé, puis rendu', async () => {
    const ticket = await store.issueTicket('621234567');
    expect(ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await store.peekTicket(ticket)).toBe('621234567');
    expect(await store.takeTicket(ticket)).toBe('621234567');
    expect(await store.takeTicket(ticket)).toBeNull();
    await store.restoreTicket(ticket, '621234567');
    expect(await store.takeTicket(ticket)).toBe('621234567');
  });

  it(`expire après ${SIGNUP_TICKET_SECONDS / 60} minutes`, async () => {
    await store.issueTicket('621234567');
    const [key] = await valkey.keys('sabou:inscription:ticket:*');
    expect(await valkey.ttl(key!)).toBeLessThanOrEqual(SIGNUP_TICKET_SECONDS);
  });
});

describe('Limites', () => {
  it('compte les demandes dans une fenêtre fixe et donne le délai d’attente', async () => {
    for (let i = 0; i < 3; i += 1)
      expect(await store.hit('code:tel:621234567', 3, 3600)).toBeNull();
    const wait = await store.hit('code:tel:621234567', 3, 3600);
    expect(wait).toBeGreaterThan(3500);
    expect(wait).toBeLessThanOrEqual(3600);
    // La fenêtre n'est pas prolongée par les demandes refusées
    expect(await valkey.ttl('sabou:inscription:limite:code:tel:621234567')).toBeLessThanOrEqual(
      3600,
    );
    expect(await store.hit('code:tel:621234568', 3, 3600)).toBeNull();
  });
});
