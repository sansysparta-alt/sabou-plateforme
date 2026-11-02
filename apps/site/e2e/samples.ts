// QR d'essai de US-006, signés par des clés de test éphémères (jamais écrites sur disque) :
// authentique, donnée modifiée, autre clé, expiré. Pour chacun : une image PNG (à imprimer
// pour l'essai sur téléphone) et une vidéo Y4M (fausse caméra de Chromium pour Playwright).
// Seules les clés publiques sont écrites, dans keys.json.
//
// Usage : node e2e/samples.ts           génère les QR des tests dans e2e/.generated/e2e/
//         node e2e/samples.ts --serve   génère ceux de l'essai manuel dans e2e/.generated/demo/
//                                       puis lance le site avec ces clés
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeBase45, encodeBase45, QR_PREFIX, type CertificateData } from '@sabou/qr';
import { generateTestSigningKey, signCertificateQr } from '@sabou/qr/sign';
import QRCode from 'qrcode';

const siteDir = join(dirname(fileURLToPath(import.meta.url)), '..');
// Deux dossiers : les tests automatiques ne doivent jamais écraser les QR d'un essai en cours
export const E2E_DIR = join(siteDir, 'e2e', '.generated', 'e2e');
export const DEMO_DIR = join(siteDir, 'e2e', '.generated', 'demo');

export interface SampleCase {
  name: string;
  label: string;
  color: 'vert' | 'ambre' | 'rouge';
  text: string;
}

const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 480;

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Change un octet du nom du praticien, sans toucher à la structure ni à la signature. */
function tamper(qr: string, practitioner: string): string {
  const bytes = decodeBase45(qr.slice(QR_PREFIX.length));
  const name = new TextEncoder().encode(practitioner);
  const at = bytes.findIndex((_, i) => name.every((byte, j) => bytes[i + j] === byte));
  if (at < 0) throw new Error('Nom introuvable dans le QR');
  bytes[at + name.length - 1] ^= 0x01;
  return QR_PREFIX + encodeBase45(bytes);
}

/** Vidéo Y4M (4:2:0) d'une image fixe : le QR noir sur fond blanc, centré, zone de silence comprise. */
function qrVideo(text: string): Buffer {
  const { modules } = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const quietZone = 4;
  const modulePx = Math.floor((VIDEO_HEIGHT * 0.9) / (modules.size + 2 * quietZone));
  const offsetX = Math.floor((VIDEO_WIDTH - modules.size * modulePx) / 2);
  const offsetY = Math.floor((VIDEO_HEIGHT - modules.size * modulePx) / 2);
  const luma = Buffer.alloc(VIDEO_WIDTH * VIDEO_HEIGHT, 235);
  for (let row = 0; row < modules.size; row++) {
    for (let col = 0; col < modules.size; col++) {
      if (!modules.get(row, col)) continue;
      for (let y = 0; y < modulePx; y++) {
        const start = (offsetY + row * modulePx + y) * VIDEO_WIDTH + offsetX + col * modulePx;
        luma.fill(16, start, start + modulePx);
      }
    }
  }
  const chroma = Buffer.alloc((VIDEO_WIDTH / 2) * (VIDEO_HEIGHT / 2) * 2, 128);
  const header = `YUV4MPEG2 W${VIDEO_WIDTH} H${VIDEO_HEIGHT} F15:1 Ip A1:1 C420jpeg\n`;
  return Buffer.concat([Buffer.from(header), Buffer.from('FRAME\n'), luma, chroma]);
}

export async function generateSamples(
  dir: string,
): Promise<{ cases: SampleCase[]; publicKeys: string }> {
  const dgKey = generateTestSigningKey();
  const otherKey = generateTestSigningKey();
  const today = new Date();
  const certificate: CertificateData = {
    number: 'GN-CERT-ESSAI-000001',
    practitioner: 'Praticien Fictif',
    issuedOn: isoDate(today),
    expiresOn: isoDate(new Date(today.getTime() + 364 * 86_400_000)),
    authority: 'Direction générale SABOU (essai)',
  };
  const authentic = signCertificateQr(certificate, dgKey);
  const cases: SampleCase[] = [
    { name: 'authentique', label: 'QR authentique', color: 'vert', text: authentic },
    {
      name: 'modifie',
      label: 'QR dont le nom du praticien est modifié',
      color: 'rouge',
      text: tamper(authentic, certificate.practitioner),
    },
    {
      name: 'autre-cle',
      label: 'QR signé par une autre clé',
      color: 'rouge',
      text: signCertificateQr(certificate, otherKey),
    },
    {
      name: 'expire',
      label: 'QR authentique mais expiré',
      color: 'ambre',
      text: signCertificateQr(
        {
          ...certificate,
          number: 'GN-CERT-ESSAI-000002',
          issuedOn: '2024-11-01',
          expiresOn: '2025-10-31',
        },
        dgKey,
      ),
    },
  ];

  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const publicKeys = JSON.stringify([dgKey.publicJwk]);
  writeFileSync(join(dir, 'keys.json'), publicKeys);
  writeFileSync(join(dir, 'cases.json'), JSON.stringify(cases, null, 2));
  for (const sample of cases) {
    writeFileSync(join(dir, `${sample.name}.y4m`), qrVideo(sample.text));
    await QRCode.toFile(join(dir, `${sample.name}.png`), sample.text, {
      errorCorrectionLevel: 'M',
      scale: 8,
      margin: 4,
    });
  }
  return { cases, publicKeys };
}

/** Lance `next start` (site déjà compilé) avec les clés publiques données. */
export function startSite(port: number, publicKeys: string) {
  const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next');
  return spawn(
    process.execPath,
    [nextBin, 'start', '--port', String(port), '--hostname', '127.0.0.1'],
    {
      cwd: siteDir,
      env: { ...process.env, SABOU_QR_PUBLIC_KEYS: publicKeys, NEXT_TELEMETRY_DISABLED: '1' },
      stdio: 'inherit',
    },
  );
}

/** Vrai si le port est libre sur 127.0.0.1. */
function portIsFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer()
      .once('error', () => resolve(false))
      .once('listening', () => probe.close(() => resolve(true)))
      .listen(port, '127.0.0.1');
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const serve = process.argv.includes('--serve');
  // Avant toute génération : de nouveaux QR avec un site déjà lancé (anciennes clés) seraient tous rouges
  if (serve && !(await portIsFree(3000))) {
    console.error(
      'Le port 3000 est déjà pris (site déjà lancé ?) : arrêtez-le, puis relancez. Rien n’a été généré.',
    );
    process.exit(1);
  }
  const dir = serve ? DEMO_DIR : E2E_DIR;
  const { cases, publicKeys } = await generateSamples(dir);
  console.log(`QR d'essai générés dans ${dir} :`);
  for (const sample of cases)
    console.log(`  ${sample.name}.png  ${sample.label} → attendu : ${sample.color}`);
  if (serve) {
    console.log('\nSite lancé sur http://localhost:3000/verifier (Ctrl+C pour arrêter).');
    startSite(3000, publicKeys);
  }
}
