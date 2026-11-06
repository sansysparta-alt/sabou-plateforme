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
  sets = new Map<string, Set<string>>();
  async set(key: string, value: string, _ex?: 'EX', ttl = -1) {
    this.data.set(key, { value, ttl });
    return 'OK';
  }
  async sadd(key: string, member: string) {
    this.sets.set(key, (this.sets.get(key) ?? new Set()).add(member));
    return 1;
  }
  async expire() {
    return 1;
  }
  async smembers(key: string) {
    return [...(this.sets.get(key) ?? [])];
  }
  async exists(key: string) {
    return this.data.has(key) ? 1 : 0;
  }
  // Transaction : les commandes sont jouées dans l'ordre à exec()
  multi() {
    const queue: (() => Promise<unknown>)[] = [];
    const chain = {
      set: (...args: Parameters<FakeValkey['set']>) => (queue.push(() => this.set(...args)), chain),
      sadd: (key: string, member: string) => (queue.push(() => this.sadd(key, member)), chain),
      expire: () => chain,
      exec: async () => {
        for (const command of queue) await command();
        return [];
      },
    };
    return chain;
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
  async del(...keys: string[]) {
    let n = 0;
    for (const key of keys) n += Number(this.data.delete(key) || this.sets.delete(key));
    return n;
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

  it('suspension (US-013) : ferme toutes les sessions du compte, pas celles des autres', async () => {
    const { valkey, store } = setup();
    const first = await store.create(session(Date.now()));
    const second = await store.create(session(Date.now()));
    const other = await store.create({ ...session(Date.now()), sub: 'u-2' });
    await store.revokeAccount('u-1');
    expect(await store.touch(first)).toBeNull();
    expect(await store.touch(second)).toBeNull();
    expect(await store.touch(other)).toMatchObject({ sub: 'u-2' });
    expect(valkey.sets.has('sabou:compte:u-1:sessions')).toBe(false);
  });

  it('suspension : refuse aussi une session ouverte après coup (connexion en cours)', async () => {
    const { store } = setup();
    await store.revokeAccount('u-1');
    const late = await store.create(session(Date.now()));
    expect(await store.touch(late)).toBeNull();
    await store.restoreAccount('u-1');
    const after = await store.create(session(Date.now()));
    expect(await store.touch(after)).toMatchObject({ sub: 'u-1' });
  });

  it("ne rend une transaction de connexion qu'une seule fois", async () => {
    const { store } = setup();
    await store.saveLogin({ state: 's', nonce: 'n', codeVerifier: 'v', returnTo: '/' });
    expect(await store.takeLogin('s')).toMatchObject({ nonce: 'n' });
    expect(await store.takeLogin('s')).toBeNull();
  });
});
