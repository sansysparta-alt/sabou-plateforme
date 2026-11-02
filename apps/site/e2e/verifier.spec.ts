// US-006 : vérification d'un QR signé sur un téléphone sans réseau (UC-06, R-QR-05).
// Chaque QR est montré à une fausse caméra de Chromium. La page est chargée une fois en
// ligne, puis le serveur est ARRÊTÉ et le réseau coupé : le verdict ne peut venir que
// du code et des clés gardés par le service worker.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium, expect, test, type Browser, type Page } from '@playwright/test';
import { E2E_DIR, startSite, type SampleCase } from './samples.ts';

const PORT = 3100;
const BASE_URL = `http://127.0.0.1:${PORT}`;
// R-QR-05 : réponse en moins de 5 secondes
const MAX_VERDICT_MS = 5000;

const cases: SampleCase[] = JSON.parse(readFileSync(join(E2E_DIR, 'cases.json'), 'utf8'));
const opened = new Map<string, { browser: Browser; page: Page }>();
let site: ReturnType<typeof startSite> | undefined;

test.describe.configure({ mode: 'serial' });

async function waitForSite(): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt++) {
    try {
      if ((await fetch(`${BASE_URL}/verifier`)).ok) return;
    } catch {
      // serveur pas encore prêt
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error('Le site ne démarre pas');
}

test.beforeAll(async () => {
  test.setTimeout(120_000);
  site = startSite(PORT, readFileSync(join(E2E_DIR, 'keys.json'), 'utf8'));
  await waitForSite();

  // Première visite en ligne, une par QR (la fausse caméra est fixée au lancement du navigateur)
  for (const sample of cases) {
    const browser = await chromium.launch({
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-video-capture=${join(E2E_DIR, `${sample.name}.y4m`)}`,
      ],
    });
    const context = await browser.newContext({ baseURL: BASE_URL, permissions: ['camera'] });
    const page = await context.newPage();
    await page.goto('/verifier');
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
    await expect(page.getByRole('button', { name: 'Scanner un QR code' })).toBeEnabled();
    await context.setOffline(true);
    opened.set(sample.name, { browser, page });
  }

  // Plus aucun serveur : seul le service worker peut répondre
  site.kill();
  await expect
    .poll(() =>
      fetch(`${BASE_URL}/verifier`).then(
        () => 'en ligne',
        () => 'arrêté',
      ),
    )
    .toBe('arrêté');
});

test.afterAll(async () => {
  site?.kill();
  await Promise.all([...opened.values()].map(({ browser }) => browser.close()));
});

for (const sample of cases) {
  test(`${sample.label} → verdict ${sample.color}, sans réseau, en moins de 5 s`, async () => {
    const { page } = opened.get(sample.name)!;
    await page.reload();
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    expect(await page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);

    const button = page.getByRole('button', { name: 'Scanner un QR code' });
    await expect(button).toBeEnabled();
    const started = Date.now();
    await button.click();
    const verdict = page.getByRole('status').locator('[data-color]');
    await expect(verdict).toBeVisible({ timeout: MAX_VERDICT_MS });
    const elapsed = Date.now() - started;
    test.info().annotations.push({ type: 'Délai du verdict', description: `${elapsed} ms` });

    expect(elapsed).toBeLessThan(MAX_VERDICT_MS);
    // Caméra arrêtée et aperçu masqué : le verdict n'est pas poussé sous un cadre noir
    await expect(page.getByLabel('Aperçu de la caméra')).toBeHidden();
    await expect(verdict).toHaveAttribute('data-color', sample.color);
    if (sample.color === 'vert') {
      await expect(verdict).toContainText('certificat authentique');
      await expect(verdict).toContainText('Praticien Fictif');
    } else if (sample.color === 'rouge') {
      await expect(verdict).toContainText('Rouge : non authentique');
      await expect(verdict).not.toContainText('Praticien Fictif');
    } else {
      await expect(verdict).toContainText('expiré le 31/10/2025');
    }
  });
}
