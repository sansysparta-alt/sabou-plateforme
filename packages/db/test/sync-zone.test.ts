// US-004, critère 4 : un agent d'une zone ne reçoit, à la synchronisation, aucune donnée
// d'une autre zone. Le service PowerSync réel (même image que infra/local/compose.yaml)
// lit la base par réplication logique ; le test lit le flux de synchronisation comme le
// ferait le téléphone. PowerSync voit toute la table : seul sync-rules.yaml cloisonne.
// Les avis de conflit (R-DON-04, point 4) ne vont qu'à leur destinataire.
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inject } from 'vitest';
import { packageDir } from '../src/atlas.ts';
import { composeImage } from './global-setup.ts';
import { createSeededDatabase, runSql, type TestDatabase } from './helpers.ts';

const LABE = 4; // agent préfectoral n° 3 du jeu d'exemple
const KANKAN = 7; // agent préfectoral n° 5
const jwtSecret = randomBytes(32).toString('base64url');

let db: TestDatabase;
let powersync: StartedTestContainer;
const ids = {
  labe: randomUUID(),
  kankan: randomUUID(),
  avisLabe: randomUUID(),
  avisKankan: randomUUID(),
};

interface Claims {
  sub: string;
  role: string;
  prefecture_id?: number;
}

// Jeton HS256 signé comme le fera l'émetteur (Keycloak en production, clés RS256)
function token(claims: Claims, secret = jwtSecret): string {
  const now = Math.floor(Date.now() / 1000);
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const body = `${part({ alg: 'HS256', typ: 'JWT', kid: 'sabou-dev' })}.${part({
    ...claims,
    aud: 'sabou-mobile',
    iat: now,
    exp: now + 300,
  })}`;
  const signature = createHmac('sha256', Buffer.from(secret, 'base64url'))
    .update(body)
    .digest('base64url');
  return `${body}.${signature}`;
}

interface SyncResult {
  status: number;
  rows: { object_type: string; object_id: string; data: Record<string, unknown> }[];
}

const objects = (rows: SyncResult['rows'], table: string) =>
  rows.filter((row) => row.object_type === table).map((row) => row.object_id);

// Lit le flux NDJSON de /sync/stream jusqu'au premier point de contrôle complet
async function sync(jwt: string): Promise<SyncResult> {
  const url = `http://${powersync.getHost()}:${powersync.getMappedPort(8080)}/sync/stream`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Token ${jwt}`,
      'content-type': 'application/json',
      accept: 'application/x-ndjson',
    },
    body: JSON.stringify({ buckets: [], include_checksum: true, raw_data: true }),
    signal: AbortSignal.timeout(60_000),
  });
  const rows: SyncResult['rows'] = [];
  if (!response.ok || !response.body) return { status: response.status, rows };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
    pending += decoder.decode(chunk.value, { stream: true });
    let newline: number;
    while ((newline = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, newline).trim();
      pending = pending.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      for (const op of message.data?.data ?? []) {
        if (op.op === 'PUT')
          rows.push({
            object_type: op.object_type,
            object_id: op.object_id,
            data: JSON.parse(op.data),
          });
      }
      if (message.checkpoint_complete) {
        await reader.cancel();
        return { status: response.status, rows };
      }
    }
  }
  throw new Error('Flux de synchronisation terminé sans point de contrôle complet');
}

beforeAll(async () => {
  const { network, passwords } = inject('server');
  db = await createSeededDatabase();
  await runSql(db.url.postgres, `CREATE DATABASE ${db.name}_ps OWNER powersync_storage`);
  // Données posées par le propriétaire des tables, hors cloisonnement par zone (US-011)
  await runSql(
    db.url.migrator,
    `INSERT INTO sabou.saisie_terrain (id, type, prefecture_id, auteur_id, contenu) VALUES
       ('${ids.labe}', 'dossier', ${LABE}, 3, '{"praticien": "Sékou Kourouma"}'),
       ('${ids.kankan}', 'dossier', ${KANKAN}, 5, '{"praticien": "Aïssatou Traoré"}');
     INSERT INTO sabou.saisie_terrain_avis (id, saisie_id, destinataire_id, motif) VALUES
       ('${ids.avisLabe}', '${ids.labe}', 3, 'version_plus_recente'),
       ('${ids.avisKankan}', '${ids.kankan}', 5, 'version_plus_recente')`,
  );

  const pg = (user: string, password: string, database: string) =>
    `postgresql://${user}:${encodeURIComponent(password)}@postgres:5432/${database}`;
  powersync = await new GenericContainer(composeImage('journeyapps/powersync-service'))
    .withNetworkMode(network)
    .withEnvironment({
      POWERSYNC_CONFIG_PATH: '/config/powersync.yaml',
      PS_DATA_SOURCE_URI: pg('sabou_sync', passwords.sync, db.name),
      PS_STORAGE_URI: pg('powersync_storage', passwords.powersyncStorage, `${db.name}_ps`),
      PS_JWT_SECRET: jwtSecret,
    })
    .withCopyDirectoriesToContainer([{ source: join(packageDir, 'sync'), target: '/config' }])
    .withExposedPorts(8080)
    .withWaitStrategy(Wait.forHttp('/probes/readiness', 8080))
    .withStartupTimeout(180_000)
    .start();

  // « Prêt » ne veut pas dire « copie initiale finie » : on attend que le dossier de Labé
  // soit diffusé (sans rien supposer du cloisonnement, vérifié par les tests)
  const deadline = Date.now() + 90_000;
  const labe = token({ sub: '3', role: 'prefectoral', prefecture_id: LABE });
  while (!(await sync(labe)).rows.some((row) => row.object_id === ids.labe)) {
    if (Date.now() > deadline)
      throw new Error('PowerSync : copie initiale non terminée après 90 s');
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
});

afterAll(async () => {
  await powersync?.stop();
});

describe('Cloisonnement par zone de la synchronisation (US-004, R-DON-04)', () => {
  it("l'agent de Labé reçoit le dossier de Labé et aucun dossier de Kankan", async () => {
    const { status, rows } = await sync(
      token({ sub: '3', role: 'prefectoral', prefecture_id: LABE }),
    );
    expect(status).toBe(200);
    expect(objects(rows, 'saisie_terrain')).toEqual([ids.labe]);
    expect(objects(rows, 'saisie_terrain_avis')).toEqual([ids.avisLabe]);
    expect(
      rows
        .filter((row) => row.object_type === 'saisie_terrain')
        .every((row) => row.data.prefecture_id === LABE),
    ).toBe(true);
  });

  it("l'agent de Kankan reçoit le dossier de Kankan et aucun dossier de Labé", async () => {
    const { rows } = await sync(token({ sub: '5', role: 'prefectoral', prefecture_id: KANKAN }));
    expect(objects(rows, 'saisie_terrain')).toEqual([ids.kankan]);
    expect(objects(rows, 'saisie_terrain_avis')).toEqual([ids.avisKankan]);
  });

  it("un compte qui n'est pas agent préfectoral ne reçoit rien, même avec une préfecture", async () => {
    const { status, rows } = await sync(
      token({ sub: '6', role: 'praticien', prefecture_id: LABE }),
    );
    expect(status).toBe(200);
    expect(rows).toEqual([]);
  });

  it('un jeton signé avec une autre clé est refusé', async () => {
    const forged = token(
      { sub: '3', role: 'prefectoral', prefecture_id: KANKAN },
      randomBytes(32).toString('base64url'),
    );
    const { status, rows } = await sync(forged);
    expect(status).toBe(401);
    expect(rows).toEqual([]);
  });
});
