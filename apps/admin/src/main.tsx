import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App, preloadCurrentPage } from './App';
import '@sabou/ui/styles.css';

function start() {
  preloadCurrentPage();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

// US-017b : l'ossature pré-générée (cadre, titre et introduction) est peinte d'abord ;
// l'application démarre à l'image suivante, avec ses demandes en avance (session, morceau
// de la page, données). Elles ne retardent plus le premier affichage. Onglet caché : aucune
// image n'est peinte, l'application démarre tout de suite.
if (document.visibilityState === 'hidden') {
  start();
} else {
  requestAnimationFrame(() => setTimeout(start, 0));
}
