// Feuille de style servie par les pages de connexion Keycloak (thèmes « sabou » et
// « sabou-public », qui en hérite) : tokens.css puis sabou.css, réunis et minifiés en un seul
// fichier, sabou.min.css (généré, versionné).
// Pourquoi : en 3G simulée (Lighthouse, seuils bloquants), les deux feuilles commentées
// (22 Ko, Keycloak ne compresse pas) coûtaient un aller-retour réseau de plus ; le LCP de la
// page de connexion oscillait entre 2,45 et 2,75 s pour un seuil de 2,5 s. Réunies et
// minifiées (≈ 14 Ko) : 2,18 à 2,46 s (05 §2.72).
//   node infra/local/keycloak/theme-css.mjs           régénère sabou.min.css
//   node infra/local/keycloak/theme-css.mjs --check   échoue si le fichier n'est pas à jour
//                                                     (contrôles du dépôt)
// On modifie tokens.css et sabou.css, jamais sabou.min.css à la main.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'lightningcss';

const dir = join(
  dirname(fileURLToPath(import.meta.url)),
  'themes',
  'sabou',
  'login',
  'resources',
  'css',
);
const sources = ['tokens.css', 'sabou.css'];
const target = join(dir, 'sabou.min.css');

const header = `/* Généré par infra/local/keycloak/theme-css.mjs depuis ${sources.join(' et ')} : ne pas modifier */\n`;
const { code } = transform({
  filename: 'sabou.min.css',
  code: Buffer.from(sources.map((file) => readFileSync(join(dir, file), 'utf8')).join('\n')),
  minify: true,
});
const expected = `${header}${code.toString()}\n`;

if (process.argv.includes('--check')) {
  let current = '';
  try {
    current = readFileSync(target, 'utf8');
  } catch {
    // Fichier absent : signalé ci-dessous
  }
  if (current !== expected) {
    console.error(
      'sabou.min.css n’est pas à jour : lancer « node infra/local/keycloak/theme-css.mjs »',
    );
    process.exit(1);
  }
} else {
  writeFileSync(target, expected);
  console.log(`sabou.min.css régénéré (${Buffer.byteLength(expected)} octets).`);
}
