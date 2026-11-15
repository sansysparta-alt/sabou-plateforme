import { afterEach, describe, expect, it, vi } from 'vitest';

// US-017 : le morceau de la page est demandé au démarrage, sans attendre la session. Chaque
// page simulée compte ses chargements (la fabrique de vi.mock tourne à la première importation).
const loaded = vi.hoisted(() => ({ rejection: 0, accounts: 0, certificate: 0 }));
vi.mock('./RejectionPage', () => {
  loaded.rejection += 1;
  return { RejectionPage: () => null };
});
vi.mock('./AccountsPage', () => {
  loaded.accounts += 1;
  return { AccountsPage: () => null };
});
vi.mock('./CertificatePage', () => {
  loaded.certificate += 1;
  return { CertificatePage: () => null };
});

import { preloadCurrentPage } from './App';

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('Préchargement de la page (US-017)', () => {
  it('demande le morceau de la page de l’adresse, seul, avant toute requête', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    window.history.replaceState(null, '', '/rejet-definitif/');
    preloadCurrentPage();
    await vi.waitFor(() => expect(loaded.rejection).toBe(1));
    expect(loaded.accounts).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('certificat : le morceau de la page à imprimer', async () => {
    window.history.replaceState(null, '', '/certificats/SAB-2026-PR12-AB3');
    preloadCurrentPage();
    await vi.waitFor(() => expect(loaded.certificate).toBe(1));
  });

  it('adresse inconnue : rien n’est demandé', async () => {
    window.history.replaceState(null, '', '/inconnue');
    preloadCurrentPage();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(loaded.accounts).toBe(0);
  });
});
