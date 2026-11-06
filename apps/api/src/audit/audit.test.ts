// US-030 : relève des événements de connexion de Keycloak vers le journal d'audit.
// Keycloak est simulé par un petit serveur HTTP ; l'écriture en base est prouvée sur un
// vrai PostgreSQL (packages/db/test/journal-audit.test.ts) et de bout en bout (apps/admin/e2e).
import { randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Logger } from '@nestjs/common';
import {
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  sql,
  type CompiledQuery,
  type DatabaseConnection,
} from 'kysely';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadEnv, type Env } from '../config/env';
import { keycloakEventRow, normalizeIp, PgAuditLog, type AuditLog } from './audit.log';
import type { Database } from '../database/database';
import { KeycloakAdminEventSource, type KeycloakEvent } from './keycloak-events';
import { KeycloakEventsPoller, OVERLAP_MS } from './keycloak-events.poller';

const event = (n: number, extra: Partial<KeycloakEvent> = {}): KeycloakEvent => ({
  id: `evt-${n}`,
  time: 1_762_416_000_000 + n,
  type: 'LOGIN_ERROR',
  ...extra,
});

describe('normalizeIp', () => {
  it('garde une adresse valide, retire le préfixe IPv4 dans IPv6, écarte le reste', () => {
    expect(normalizeIp('197.149.10.24')).toBe('197.149.10.24');
    expect(normalizeIp('::ffff:197.149.10.24')).toBe('197.149.10.24');
    expect(normalizeIp('2001:db8::1')).toBe('2001:db8::1');
    for (const value of [undefined, '', 'inconnue', "1.2.3.4'; DROP TABLE x"]) {
      expect(normalizeIp(value)).toBeNull();
    }
  });
});

// Base simulée : journalise chaque requête et ses paramètres
function fakeDatabase() {
  const log: string[] = [];
  const connection: DatabaseConnection = {
    async executeQuery<R>(query: CompiledQuery) {
      log.push(`${query.sql.trim()} ${JSON.stringify(query.parameters)}`);
      return { rows: [] as R[] };
    },
    // eslint-disable-next-line require-yield
    async *streamQuery() {
      throw new Error('non utilisé');
    },
  };
  const db: Database = new Kysely({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createIntrospector: (k) => new PostgresIntrospector(k),
      createQueryCompiler: () => new PostgresQueryCompiler(),
      createDriver: () => ({
        init: async () => undefined,
        acquireConnection: async () => connection,
        beginTransaction: async () => void log.push('BEGIN'),
        commitTransaction: async () => void log.push('COMMIT'),
        rollbackTransaction: async () => void log.push('ROLLBACK'),
        releaseConnection: async () => undefined,
        destroy: async () => undefined,
      }),
    },
  });
  return { db, log };
}

describe('PgAuditLog.decide', () => {
  it('pose l’IP de la requête au début de la transaction de la décision', async () => {
    const { db, log } = fakeDatabase();
    await new PgAuditLog(db).decide('::ffff:197.149.10.24', (trx) =>
      sql`SELECT sabou.dossier_transition(1, 'soumis', 6)`.execute(trx),
    );
    expect(log).toEqual([
      'BEGIN',
      'SELECT sabou.audit_contexte($1::inet) ["197.149.10.24"]',
      "SELECT sabou.dossier_transition(1, 'soumis', 6) []",
      'COMMIT',
    ]);
  });

  it('annule la décision et sa ligne d’audit ensemble en cas d’erreur', async () => {
    const { db, log } = fakeDatabase();
    await expect(
      new PgAuditLog(db).decide(undefined, async () => {
        throw new Error('refus');
      }),
    ).rejects.toThrow('refus');
    expect(log).toEqual(['BEGIN', 'SELECT sabou.audit_contexte($1::inet) [null]', 'ROLLBACK']);
  });
});

describe('keycloakEventRow', () => {
  it('reprend qui, quoi, quand et IP de l’événement', () => {
    expect(
      keycloakEventRow(
        event(1, {
          userId: 'kc-1',
          ipAddress: '197.149.10.24',
          clientId: 'sabou-admin',
          error: 'invalid_user_credentials',
          details: { username: 'awa.camara', auth_method: 'openid-connect' },
        }),
      ),
    ).toEqual({
      ref: 'evt-1',
      occurred_at: new Date(1_762_416_000_001).toISOString(),
      action: 'keycloak.login_error',
      account: 'kc-1',
      ip: '197.149.10.24',
      details: {
        client: 'sabou-admin',
        erreur: 'invalid_user_credentials',
        identifiant: 'awa.camara',
        session: undefined,
      },
    });
  });

  it('borne les champs libres et donne une référence stable à un événement sans identifiant', () => {
    const anonymous = event(2, { id: undefined, details: { username: 'x'.repeat(5000) } });
    const row = keycloakEventRow(anonymous);
    expect(row.details.identifiant).toHaveLength(255);
    expect(row.ref).toMatch(/^[0-9a-f]{64}$/);
    expect(keycloakEventRow(anonymous).ref).toBe(row.ref);
  });
});

describe('KeycloakAdminEventSource', () => {
  const secret = randomBytes(32).toString('base64url');
  const all = Array.from({ length: 230 }, (_, i) => event(i));
  const requests: URL[] = [];
  let tokens = 0;
  let rejectNextToken = false;
  let server: Server;
  let source: KeycloakAdminEventSource;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const url = new URL(req.url!, 'http://keycloak.test');
      requests.push(url);
      if (url.pathname === '/realms/sabou/protocol/openid-connect/token') {
        const expected = `Basic ${Buffer.from(`sabou-audit:${secret}`).toString('base64')}`;
        if (req.headers.authorization !== expected) return res.writeHead(401).end();
        tokens++;
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify({ access_token: `jeton-${tokens}`, expires_in: 300 }));
      }
      if (url.pathname === '/admin/realms/sabou/events') {
        if (rejectNextToken || req.headers.authorization !== `Bearer jeton-${tokens}`) {
          rejectNextToken = false;
          return res.writeHead(401).end();
        }
        const from = Number(url.searchParams.get('dateFrom') ?? 0);
        const first = Number(url.searchParams.get('first'));
        const max = Number(url.searchParams.get('max'));
        const page = all.filter((e) => e.time >= from).slice(first, first + max);
        res.setHeader('content-type', 'application/json');
        return res.end(JSON.stringify(page));
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    source = new KeycloakAdminEventSource(
      loadEnv({
        DATABASE_URL: 'postgres://u:p@localhost:5432/sabou',
        SYNC_JWT_SECRET: randomBytes(32).toString('base64url'),
        KEYCLOAK_ISSUER: 'http://localhost:8080/realms/sabou',
        KEYCLOAK_INTERNAL_URL: `http://127.0.0.1:${port}`,
        KEYCLOAK_ALLOW_HTTP: 'true',
        ADMIN_CLIENT_SECRET: randomBytes(32).toString('base64url'),
        AUDIT_CLIENT_SECRET: secret,
        ADMIN_APP_URL: 'http://localhost:5173',
        VALKEY_URL: 'redis://localhost:6379',
      }),
    );
  });

  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  beforeEach(() => {
    requests.length = 0;
  });

  it('lit toutes les pages depuis le point de reprise, avec le compte de service', async () => {
    const events = await source.since(all[100]!.time);
    expect(events.map((e) => e.id)).toEqual(all.slice(100).map((e) => e.id));
    const pages = requests.filter((u) => u.pathname.endsWith('/events'));
    expect(pages.map((u) => u.searchParams.get('first'))).toEqual(['0', '100']);
    expect(pages[0]!.searchParams.get('dateFrom')).toBe(String(all[100]!.time));
    expect(pages[0]!.searchParams.get('direction')).toBe('asc');
  });

  it('garde le jeton tant qu’il est valide, le redemande après un refus', async () => {
    const before = tokens;
    await source.since(all[229]!.time);
    expect(tokens).toBe(before);
    rejectNextToken = true;
    await expect(source.since(all[229]!.time)).rejects.toThrow('HTTP 401');
    await source.since(all[229]!.time);
    expect(tokens).toBe(before + 1);
  });

  it('refuse une réponse qui n’a pas la forme d’un événement', async () => {
    all.push({ id: 'x', time: all[229]!.time + 1, type: 'pas un type' });
    await expect(source.since(all[229]!.time)).rejects.toThrow();
    all.pop();
  });
});

describe('KeycloakEventsPoller', () => {
  const env = { AUDIT_POLL_SECONDS: 0 } as Env;
  let audit: Pick<AuditLog, 'lastKeycloakEventTime' | 'importKeycloakEvents'> & {
    imported: KeycloakEvent[];
    last: number | null;
  };
  const since = vi.fn<(since: number | null) => Promise<KeycloakEvent[]>>();
  let poller: KeycloakEventsPoller;

  beforeEach(() => {
    audit = {
      imported: [],
      last: null,
      async lastKeycloakEventTime() {
        return this.last;
      },
      async importKeycloakEvents(events) {
        this.imported.push(...events);
        return events.length;
      },
    };
    since.mockReset();
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    poller = new KeycloakEventsPoller(env, audit as unknown as AuditLog, { since });
  });

  it('première relève : tout ce que Keycloak garde ; ensuite, depuis le dernier versé', async () => {
    since.mockResolvedValue([event(1)]);
    expect(await poller.poll()).toBe(1);
    expect(since).toHaveBeenLastCalledWith(null);
    audit.last = event(1).time;
    await poller.poll();
    // Recouvrement : un événement écrit pendant la relève précédente n'est pas perdu
    expect(since).toHaveBeenLastCalledWith(event(1).time - OVERLAP_MS);
  });

  it('une seule relève à la fois', async () => {
    let release!: (events: KeycloakEvent[]) => void;
    since.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    const first = poller.poll();
    const second = poller.poll();
    release([event(1)]);
    expect(await Promise.all([first, second])).toEqual([1, 1]);
    expect(since).toHaveBeenCalledTimes(1);
  });

  it('Keycloak injoignable : rien n’est versé, la relève suivante reprend', async () => {
    since.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect(await poller.poll()).toBe(0);
    expect(Logger.prototype.warn).toHaveBeenCalledWith(expect.stringContaining('ECONNREFUSED'));
    since.mockResolvedValueOnce([event(2)]);
    expect(await poller.poll()).toBe(1);
  });
});
