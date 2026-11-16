import { createRoot } from 'react-dom/client';
import { LoadingShell } from './LoadingShell';
import { PAGE_HEADERS } from './page-headers';

// Entrée de la pré-génération (US-017b), compilée pour Node par `vite build --ssr` puis
// appelée par scripts/prerender.mjs dans un DOM simulé (jsdom) : même code et mêmes
// composants que l'application, donc le même balisage que son ossature de chargement.

export const PRERENDERED_PATHS = Object.keys(PAGE_HEADERS);

export function renderShell(path: string, container: Element): void {
  createRoot(container).render(<LoadingShell path={path} />);
}
