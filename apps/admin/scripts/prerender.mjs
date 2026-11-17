// Pré-génération de l'ossature des pages (US-017b), après `vite build` : pour chaque adresse
// dont l'en-tête ne dépend pas de la personne, dist/<adresse>/index.html contient déjà le
// cadre et l'en-tête de la page. En 3G, ils s'affichent dès l'arrivée du HTML ; l'application
// reprend ensuite les mêmes éléments (rendu dans le même conteneur, sans décalage).
// Le frontal sert dist/<adresse>/index.html pour <adresse>, sinon dist/index.html
// (scripts/serve.mjs fait de même).
//   node scripts/prerender.mjs     (dist/ et dist-ssr/ doivent exister)
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const ssr = join(root, 'dist-ssr');
const ROOT_TAG = '<div id="root"></div>';

// DOM simulé : le rendu de Preact écrit dans un vrai document, comme dans le navigateur
const { window } = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'http://localhost/',
});
Object.assign(globalThis, { window, document: window.document });

const { PRERENDERED_PATHS, renderShell } = await import(
  pathToFileURL(join(ssr, 'prerender.js')).href
);

const template = readFileSync(join(dist, 'index.html'), 'utf8');
if (!template.includes(ROOT_TAG)) throw new Error(`${ROOT_TAG} introuvable dans dist/index.html`);

for (const path of PRERENDERED_PATHS) {
  const container = window.document.createElement('div');
  renderShell(path, container);
  const html = container.innerHTML;
  if (!html.includes('ui-page-header')) throw new Error(`ossature vide pour ${path}`);
  const out = join(dist, ...path.split('/').filter(Boolean));
  mkdirSync(out, { recursive: true });
  writeFileSync(
    join(out, 'index.html'),
    template.replace(ROOT_TAG, `<div id="root">${html}</div>`),
  );
}
rmSync(ssr, { recursive: true, force: true });
console.log(`Ossature pré-générée pour ${PRERENDERED_PATHS.length} pages`);
