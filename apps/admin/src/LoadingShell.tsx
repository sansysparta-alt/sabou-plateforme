import { AppShell, PageHeader } from '@sabou/ui';
import { headingOf } from './page-headers';

// Ossature d'une page (US-017b) : le cadre de l'application, sans menu ni profil, et l'en-tête
// de la page quand il ne dépend pas de la personne. Elle s'affiche pendant la lecture de la
// session, et elle est pré-générée dans le HTML de chaque adresse à la compilation
// (scripts/prerender.mjs) : en 3G, titre et introduction paraissent dès l'arrivée du HTML.
// L'application reprend ensuite les mêmes éléments, à la même place : rien ne bouge.
export function LoadingShell({ path }: { path: string }) {
  return (
    <AppShell nav={[]} currentPath={path}>
      <PageFallback path={path} />
    </AppShell>
  );
}

// En attendant la page : son en-tête s'il est connu, sinon « Chargement… »
export function PageFallback({ path }: { path: string }) {
  const heading = headingOf(path);
  return heading ? <PageHeader {...heading} /> : <p>Chargement…</p>;
}
