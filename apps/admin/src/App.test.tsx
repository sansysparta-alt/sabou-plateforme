import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { SessionUser } from '@sabou/types';
import { App } from './App';

const dg: SessionUser = {
  username: 'awa.camara',
  name: 'Awa Camara',
  roles: ['dg', 'administrateur'],
  administrator: true,
  secondFactor: true,
};
const praticien: SessionUser = {
  username: 'sekou.conde',
  name: 'Sékou Condé',
  roles: ['praticien'],
  administrator: false,
  secondFactor: false,
};

// Réponses de l'API, par adresse
function mockApi(session: SessionUser | null | 'panne') {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/auth/session') {
      if (session === 'panne') return new Response(null, { status: 503 });
      return session ? Response.json(session) : new Response(null, { status: 401 });
    }
    if (url === '/auth/logout' && init?.method === 'POST')
      return new Response(null, { status: 204 });
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

beforeEach(() => window.history.replaceState(null, '', '/'));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('sans session : page de connexion, lien vers /auth/login et garanties de sécurité', async () => {
    mockApi(null);
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Application de gestion' }));
    expect(screen.getByRole('link', { name: 'Se connecter' }).getAttribute('href')).toBe(
      '/auth/login',
    );
    expect(screen.getByText(/Double facteur obligatoire pour tous les administrateurs/));
    expect(screen.getByText(/bloqué 15 minutes après 5 mots de passe erronés/));
  });

  it("affiche le motif d'un échec puis le retire de l'adresse", async () => {
    mockApi(null);
    window.history.replaceState(null, '', '/?erreur=double-facteur');
    render(<App />);
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /Si vous venez de l’activer, reconnectez-vous/,
    );
    expect(window.location.search).toBe('');
  });

  it('administrateur connecté : profil affiché, pas de proposition de double facteur', async () => {
    mockApi(dg);
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Bonjour, Awa Camara' }));
    expect(screen.getByText('Direction Générale'));
    expect(screen.queryByRole('link', { name: 'Activer le double facteur' })).toBeNull();
  });

  it('praticien sans double facteur : il lui est proposé, pas imposé', async () => {
    mockApi(praticien);
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Bonjour, Sékou Condé' }));
    expect(
      screen.getByRole('link', { name: 'Activer le double facteur' }).getAttribute('href'),
    ).toBe('/auth/login?action=configure-totp');
  });

  it('après activation du double facteur : confirmation, plus de proposition', async () => {
    mockApi(praticien);
    window.history.replaceState(null, '', '/?info=double-facteur');
    render(<App />);
    expect((await screen.findByRole('status')).textContent).toMatch(/Double facteur activé/);
    expect(screen.queryByRole('link', { name: 'Activer le double facteur' })).toBeNull();
    expect(window.location.search).toBe('');
  });

  it("citoyen : pas d'accès à l'application de gestion (moindre privilège)", async () => {
    mockApi({ ...praticien, roles: ['citoyen'] });
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Accès non autorisé' }));
  });

  it('déconnexion : POST /auth/logout puis retour à la page de connexion', async () => {
    const fetchMock = mockApi(dg);
    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: 'Se déconnecter' }));
    expect(await screen.findByRole('link', { name: 'Se connecter' }));
    expect(fetchMock).toHaveBeenCalledWith(
      '/auth/logout',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('API indisponible : message clair, sans détail technique', async () => {
    mockApi('panne');
    render(<App />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/momentanément indisponible/);
  });
});
