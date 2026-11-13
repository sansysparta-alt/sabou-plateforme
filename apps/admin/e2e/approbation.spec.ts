// US-045 : la DG approuve un dossier à l'étape 5 ; le certificat signé par le vrai coffre
// (OpenBao Transit) est émis et sa page s'ouvre, de bout en bout. Vrai Keycloak (second
// facteur), vraie API, vrai coffre, vraie base. Le QR est vérifié hors ligne avec la clé
// publique enregistrée, comme le fera le site public.
import { verifyCertificateQr } from '@sabou/qr';
import { expect, test } from '@playwright/test';
import { psql } from './audit';
import { dossierAtStep, stepOf } from './dossiers';
import { administrator, expectAccessible, firstAdministratorLogin } from './helpers';
import { APP } from './keycloak';

test('US-045 : approuver émet un certificat de 12 mois signé par le coffre, QR vérifiable', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const prefectoral = await administrator('admin_prefectoral', { prefecture: 'Kankan' });
  const user = await administrator('dg', { national: true });
  await firstAdministratorLogin(page, user);
  const code = dossierAtStep(5, 'Kankan', prefectoral.id);

  await page.goto(APP);
  await page.getByRole('link', { name: 'Approbation des dossiers' }).click();
  const card = page
    .getByRole('listitem')
    .filter({ has: page.getByRole('heading', { name: new RegExp(`^${code} `) }) });
  await expect(card.getByText('Réalisée, compte rendu signé')).toBeVisible();
  await expectAccessible(page, 'approbation des dossiers');

  await card.getByRole('button', { name: /^Approuver et émettre le certificat/ }).click();

  // La page du certificat s'ouvre ; le dossier est à l'étape 6
  await expect(page.getByRole('heading', { name: 'Certificat de tradipraticien' })).toBeVisible();
  const numero = decodeURIComponent(new URL(page.url()).pathname.split('/').at(-1)!);
  expect(numero).toMatch(/^SAB-\d{4}-[A-Z0-9]+-[A-Z2-9]{3}$/);
  await expect(
    page.getByRole('img', { name: `QR code signé du certificat ${numero}` }),
  ).toBeVisible();
  await expectAccessible(page, 'certificat à imprimer');
  expect(stepOf(code)).toBe(6);

  // Critère 1 : 12 mois, actif, empreinte SHA3-256 et signature Ed25519 de 64 octets
  const [statut, months, digest, signatureLength, kid, publicKey, qr] = psql(
    `SELECT c.statut, (c.expire_le + 1 - c.emis_le) / 30, c.empreinte_sha3,
            length(decode(c.signature, 'base64')), k.kid, k.cle_publique, c.qr
       FROM sabou.certificat c JOIN sabou.cle_signature k ON k.id = c.cle_id
      WHERE c.numero = '${numero}'`,
  )
    .trim()
    .split('|');
  expect(statut).toBe('actif');
  expect(Number(months)).toBe(12);
  expect(digest).toMatch(/^[0-9a-f]{64}$/);
  expect(Number(signatureLength)).toBe(64);

  // Critère 2 : la signature vient du coffre ; le QR est authentique pour la clé enregistrée
  // et falsifié pour toute autre
  const verdict = verifyCertificateQr(qr!, [
    { kty: 'OKP', crv: 'Ed25519', kid: kid!, x: publicKey! },
  ]);
  expect(verdict).toMatchObject({ color: 'vert', status: 'authentique', digest, kid });
  const otherKey = Buffer.alloc(32, 7).toString('base64url');
  expect(
    verifyCertificateQr(qr!, [{ kty: 'OKP', crv: 'Ed25519', kid: kid!, x: otherKey }]).color,
  ).toBe('rouge');

  // Approuver une seconde fois : refusé, le dossier n'est plus à l'étape 5
  const again = await page.request.post(`${APP}/api/dossiers/${code}/approbation`, {
    headers: { origin: APP },
  });
  expect(again.ok()).toBe(false);
});
