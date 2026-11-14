// Comptes et dossiers d'essai, fictifs, pour vérifier le sprint dans le navigateur :
//   pnpm --filter @sabou/admin essai
// Crée un compte par profil d'administration (mots de passe tirés au hasard) et des dossiers
// à chaque étape dans la préfecture de Kankan, puis écrit le tout dans apps/admin/.essai/
// comptes.txt (non versionné). Base locale seulement : jamais de donnée réelle.
import { test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { psql } from '../e2e/audit';
import { certifiedPractitioner, dossierAtStep, dossierAtStep2 } from '../e2e/dossiers';
import { administrator } from '../e2e/helpers';
import { APP } from '../e2e/keycloak';

test('comptes et dossiers d’essai', async () => {
  const prefectoral = await administrator('admin_prefectoral', { prefecture: 'Kankan' });
  const regional = await administrator('admin_regional', { region: 'Kankan' });
  const committee = await administrator('comite', { national: true });
  const dg = await administrator('dg', { national: true });

  const step2Done = dossierAtStep2('Kankan', prefectoral.id, 'realisee');
  const step2Planned = dossierAtStep2('Kankan', prefectoral.id, 'planifiee');
  const step3 = dossierAtStep(3, 'Kankan', prefectoral.id);
  const step4 = dossierAtStep(4, 'Kankan', prefectoral.id);
  const step5 = dossierAtStep(5, 'Kankan', prefectoral.id);
  // Bloqué : à l'étape 4 depuis 20 jours (entonnoir, US-048)
  const blocked = dossierAtStep(4, 'Kankan', prefectoral.id);
  psql(`UPDATE sabou.dossier_certification SET etape_entree_le = now() - interval '20 days'
         WHERE code = '${blocked}'`);
  const certified = certifiedPractitioner();

  const text = [
    `Application de gestion : ${APP}`,
    'Au premier passage, Keycloak demande d’enregistrer le code dans une application',
    'd’authentification du téléphone (FreeOTP, Aegis, Google Authenticator…).',
    '',
    'Comptes (identifiant / mot de passe) :',
    `  DG                      ${dg.username} / ${dg.password}`,
    `  Admin préfectoral Kankan ${prefectoral.username} / ${prefectoral.password}`,
    `  Admin régional Kankan   ${regional.username} / ${regional.password}`,
    `  Comité scientifique     ${committee.username} / ${committee.password}`,
    '',
    'Dossiers (préfecture de Kankan) :',
    `  Étape 2, visite réalisée (décision du préfectoral)        ${step2Done}`,
    `  Étape 2, visite planifiée (compte rendu à saisir, US-041)  ${step2Planned}`,
    `  Étape 3 (consolidation régionale)                         ${step3}`,
    `  Étape 4 (expertise du Comité)                             ${step4}`,
    `  Étape 4 depuis 20 jours (bloqué, entonnoir)               ${blocked}`,
    `  Étape 5 (approbation par la DG, certificat)               ${step5}`,
    `  Praticien certifié sans dossier (rejet définitif)         ${certified.praticien} (certificat ${certified.certificat})`,
    '',
  ].join('\n');
  const dir = fileURLToPath(new URL('../.essai/', import.meta.url));
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}comptes.txt`, text, { mode: 0o600 });
  console.log(`\n${text}\nÉcrit dans apps/admin/.essai/comptes.txt`);
});
