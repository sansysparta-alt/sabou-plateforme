// Un serveur PostgreSQL 17 + PostGIS pour toute la suite de tests (Testcontainers) :
// même image que l'environnement local, mêmes rôles, initialisé par le même script.
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GenericContainer, Network, Wait } from 'testcontainers';
import type { TestProject } from 'vitest/node';
import { packageDir } from '../src/atlas.ts';

declare module 'vitest' {
  export interface ProvidedContext {
    server: {
      host: string;
      port: number;
      network: string;
      passwords: { postgres: string; migrator: string; app: string };
    };
  }
}

const repoRoot = join(packageDir, '..', '..');

// Image lue dans infra/local/compose.yaml : une seule source pour l'empreinte
function postgisImage(): string {
  const compose = readFileSync(join(repoRoot, 'infra', 'local', 'compose.yaml'), 'utf8');
  const match = /image: (postgis\/postgis@sha256:[0-9a-f]{64})/.exec(compose);
  if (!match) throw new Error('Image PostGIS introuvable dans infra/local/compose.yaml');
  return match[1];
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const secret = () => randomBytes(18).toString('base64url');
  const passwords = { postgres: secret(), migrator: secret(), app: secret() };

  const network = await new Network().start();
  const container = await new GenericContainer(postgisImage())
    .withNetwork(network)
    .withNetworkAliases('postgres')
    .withEnvironment({
      POSTGRES_PASSWORD: passwords.postgres,
      POSTGRES_DB: 'sabou',
      SABOU_MIGRATOR_PASSWORD: passwords.migrator,
      SABOU_APP_PASSWORD: passwords.app,
      KEYCLOAK_DB_PASSWORD: secret(),
    })
    // Remplace le script de l'image, comme dans infra/local/compose.yaml
    .withCopyFilesToContainer([
      {
        source: join(repoRoot, 'infra', 'local', 'postgres', '10-roles.sh'),
        target: '/docker-entrypoint-initdb.d/10_postgis.sh',
        mode: 0o755,
      },
    ])
    .withExposedPorts(5432)
    // Le serveur redémarre une fois après l'initialisation : prêt au second message
    .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
    .withStartupTimeout(180_000)
    .start();

  project.provide('server', {
    host: container.getHost(),
    port: container.getMappedPort(5432),
    network: network.getName(),
    passwords,
  });

  return async () => {
    await container.stop();
    await network.stop();
  };
}
