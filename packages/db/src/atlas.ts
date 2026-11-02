import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Atlas, édition communautaire (Apache 2), épinglé par empreinte (1.3.6-community)
export const ATLAS_IMAGE =
  'arigaio/atlas@sha256:66a344bff417fa22820c13742eb45c6d0b6f630f2f0f402273d520347198417a';

export const packageDir = fileURLToPath(new URL('..', import.meta.url));
export const migrationsDir = join(packageDir, 'migrations');

export interface AtlasResult {
  ok: boolean;
  output: string;
}

export interface AtlasOptions {
  // Dossier des migrations (par défaut celui du paquet ; un autre dans les tests)
  dir?: string;
  // Réseau Docker où la base est joignable, et adresse de la base vue depuis ce réseau
  network?: string;
  databaseUrl?: string;
  // Écriture dans le dossier des migrations (migrate hash seulement) ; lecture seule sinon
  writable?: boolean;
}

// Lance Atlas dans son conteneur. L'adresse de la base passe par l'environnement
// (ATLAS_DATABASE_URL, lue par atlas.hcl), jamais en argument visible.
export function runAtlas(args: string[], options: AtlasOptions = {}): AtlasResult {
  const docker = ['run', '--rm', '--workdir', '/'];
  if (options.network) docker.push('--network', options.network);
  if (options.databaseUrl) docker.push('--env', 'ATLAS_DATABASE_URL');
  docker.push(
    '--volume',
    `${options.dir ?? migrationsDir}:/migrations${options.writable ? '' : ':ro'}`,
    '--volume',
    `${join(packageDir, 'atlas.hcl')}:/atlas.hcl:ro`,
    ATLAS_IMAGE,
    ...args,
  );
  const result = spawnSync('docker', docker, {
    encoding: 'utf8',
    env: { ...process.env, ATLAS_DATABASE_URL: options.databaseUrl ?? '' },
  });
  if (result.error) throw new Error(`Docker introuvable : ${result.error.message}`);
  return { ok: result.status === 0, output: `${result.stdout}${result.stderr}` };
}
