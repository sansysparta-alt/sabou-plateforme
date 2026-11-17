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
import { clearPrefetched, requestKey, takePrefetched } from './prefetch';

afterEach(() => {
  clearPrefetched();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

describe('Préchargement de la page (US-017)', () => {
  it('demande le morceau de la page de l’adresse, seul ; une page sans données ne lit rien', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    window.history.replaceState(null, '', '/rejet-definitif/');
    preloadCurrentPage();
    await vi.waitFor(() => expect(loaded.rejection).toBe(1));
    expect(loaded.accounts).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('demande aussi les lectures de la page, celles qu’elle fera à son ouverture', () => {
    const fetchSpy = vi.fn(async (url: string) => Response.json([url]));
    vi.stubGlobal('fetch', fetchSpy);
    window.history.replaceState(null, '', '/comptes');
    preloadCurrentPage();
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual([
      '/api/comptes',
      '/api/comptes/referentiels',
    ]);
    expect(takePrefetched(requestKey('GET', '/api/comptes'))).toBeDefined();
  });

  it('invitation : la consultation avec le jeton du lien, rien sans jeton valide', () => {
    const fetchSpy = vi.fn(async () => Response.json({}));
    vi.stubGlobal('fetch', fetchSpy);
    const token = 'a'.repeat(43);
    window.history.replaceState(null, '', `/invitation#${token}`);
    preloadCurrentPage();
    const body = JSON.stringify({ token });
    expect(takePrefetched(requestKey('POST', '/api/invitation/consultation', body))).toBeDefined();
    window.history.replaceState(null, '', '/invitation#court');
    preloadCurrentPage();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('retour de connexion en erreur : aucune lecture', () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    window.history.replaceState(null, '', '/?erreur=connexion');
    preloadCurrentPage();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('certificat : le morceau de la page à imprimer et le certificat', async () => {
    const fetchSpy = vi.fn(async (url: string) => Response.json({ url }));
    vi.stubGlobal('fetch', fetchSpy);
    window.history.replaceState(null, '', '/certificats/SAB-2026-PR12-AB3');
    preloadCurrentPage();
    await vi.waitFor(() => expect(loaded.certificate).toBe(1));
    expect(fetchSpy.mock.calls.map(([url]) => url)).toEqual(['/api/certificats/SAB-2026-PR12-AB3']);
  });

  it('adresse inconnue : rien n’est demandé', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const before = { ...loaded };
    window.history.replaceState(null, '', '/inconnue');
    preloadCurrentPage();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(loaded).toEqual(before);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
