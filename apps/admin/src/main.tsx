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

// US-017b : quand l'adresse a son ossature pré-générée (cadre, titre et introduction), elle
// est peinte d'abord ; l'application démarre une fois ce premier affichage signalé par le
// navigateur, avec ses demandes en avance (session, morceau de la page, données), qui ne le
// retardent donc plus. Filet : 500 ms au plus (navigateur sans ce signal). Sans ossature, ou
// onglet caché (rien n'est peint), l'application démarre tout de suite.
const FIRST_PAINT_WAIT_MS = 500;

function afterFirstPaint(run: () => void) {
  let started = false;
  const go = () => {
    if (started) return;
    started = true;
    run();
  };
  try {
    new PerformanceObserver((list, observer) => {
      if (list.getEntriesByName('first-contentful-paint').length === 0) return;
      observer.disconnect();
      setTimeout(go, 0);
    }).observe({ type: 'paint', buffered: true });
  } catch {
    // Signal indisponible : le filet ci-dessous démarre l'application
  }
  setTimeout(go, FIRST_PAINT_WAIT_MS);
}

const prerendered = document.getElementById('root')!.hasChildNodes();
if (prerendered && document.visibilityState !== 'hidden') afterFirstPaint(start);
else start();
