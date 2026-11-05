import { describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import {
  SESSION_IDLE_SECONDS,
  SESSION_MAX_SECONDS,
  ValkeySessionStore,
  type SessionData,
} from './session.store';

// Valkey simulé : les seules commandes utilisées par le magasin de sessions
class FakeValkey {
  data = new Map<string, { value: string; ttl: number }>();
  async set(key: string, value: string, _ex: 'EX', ttl: number) {
    this.data.set(key, { value, ttl });
    return 'OK';
  }
  async getex(key: string, _ex: 'EX', ttl: number) {
    const entry = this.data.get(key);
    if (!entry) return null;
    entry.ttl = ttl;
    return entry.value;
  }
  async getdel(key: string) {
    const entry = this.data.get(key);
    this.data.delete(key);
    return entry?.value ?? null;
  }
  async del(key: string) {
    return this.data.delete(key) ? 1 : 0;
  }
}

const session = (createdAt: number): SessionData => ({
  sub: 'u-1',
  username: 'awa.camara',
  name: 'Awa Camara',
  roles: ['dg', 'administrateur'],
  secondFactor: true,
  refreshToken: 'r',
  createdAt,
});

function setup() {
  const valkey = new FakeValkey();
  return { valkey, store: new ValkeySessionStore(valkey as unknown as Redis) };
}

describe('ValkeySessionStore', () => {
  it("n'écrit jamais l'identifiant de session en clair, seulement son empreinte", async () => {
    const { valkey, store } = setup();
    const id = await store.create(session(Date.now()));
    expect(id).toMatch(/^[\w-]{43}$/);
    const [key] = [...valkey.data.keys()];
    expect(key).toMatch(/^sabou:session:[\w-]{43}$/);
    expect(key).not.toContain(id);
  });

  it('expire après 30 minutes sans activité ; chaque lecture prolonge ce délai', async () => {
    const { valkey, store } = setup();
    const id = await store.create(session(Date.now()));
    const entry = [...valkey.data.values()][0]!;
    expect(entry.ttl).toBe(SESSION_IDLE_SECONDS);
    entry.ttl = 5;
    expect(await store.touch(id)).toMatchObject({ sub: 'u-1' });
    expect(entry.ttl).toBe(SESSION_IDLE_SECONDS);
  });

  it('refuse et supprime une session ouverte depuis 10 heures, même active', async () => {
    const { valkey, store } = setup();
    const now = Date.now();
    const id = await store.create(session(now - SESSION_MAX_SECONDS * 1000));
    expect(await store.touch(id, now)).toBeNull();
    expect(valkey.data.size).toBe(0);
  });

  it("ne rend une transaction de connexion qu'une seule fois", async () => {
    const { store } = setup();
    await store.saveLogin({ state: 's', nonce: 'n', codeVerifier: 'v', returnTo: '/' });
    expect(await store.takeLogin('s')).toMatchObject({ nonce: 'n' });
    expect(await store.takeLogin('s')).toBeNull();
  });
});
