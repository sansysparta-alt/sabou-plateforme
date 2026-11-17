// US-017b : ossature des pages, affichée pendant la lecture de la session et pré-générée dans
// le HTML de chaque adresse (scripts/prerender.mjs, à partir de src/prerender.tsx).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { App } from './App';
import { PAGE_HEADERS } from './page-headers';
import { PRERENDERED_PATHS, renderShell } from './prerender';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

// Session qui ne répond pas : l'application reste sur son ossature
function pendingSession() {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise<Response>(() => undefined)),
  );
}

describe('Ossature pendant la lecture de la session', () => {
  it('cadre, titre et introduction de la page ; ni menu, ni profil, ni déconnexion', () => {
    pendingSession();
    window.history.replaceState(null, '', '/referentiels');
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Référentiels' }));
    expect(screen.getByText(PAGE_HEADERS['/referentiels'].lead));
    expect(screen.getByRole('navigation', { name: 'Navigation principale' }));
    expect(screen.queryAllByRole('link', { name: /Comptes|Référentiels/ })).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Se déconnecter' })).toBeNull();
  });

  it('page sans en-tête connu (tableau de bord, propre à chaque personne) : « Chargement… »', () => {
    pendingSession();
    render(<App />);
    expect(screen.getByText('Chargement…'));
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
  });
});

describe('Ossature pré-générée', () => {
  it('une page par en-tête connu, le tableau de bord exclu', () => {
    expect(PRERENDERED_PATHS).toEqual(Object.keys(PAGE_HEADERS));
    expect(PRERENDERED_PATHS).not.toContain('/');
  });

  it.each(Object.keys(PAGE_HEADERS))(
    '%s : même balisage que le premier affichage de l’application (aucun décalage)',
    (path) => {
      const prerendered = document.createElement('div');
      renderShell(path, prerendered);
      pendingSession();
      window.history.replaceState(null, '', path);
      const { container } = render(<App />);
      expect(prerendered.innerHTML).toContain('<h1>');
      expect(container.innerHTML).toBe(prerendered.innerHTML);
    },
  );
});
