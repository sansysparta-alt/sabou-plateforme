import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { DashboardSummary, SessionUser } from '@sabou/types';
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

const prefectoral: SessionUser = {
  ...dg,
  name: 'Ibrahima Sow',
  roles: ['admin_prefectoral', 'administrateur'],
};
const regional: SessionUser = {
  ...dg,
  name: 'Alpha Barry',
  roles: ['admin_regional', 'administrateur'],
};
const committee: SessionUser = {
  ...dg,
  name: 'Aboubacar Diakité',
  roles: ['comite', 'administrateur'],
};
const SUMMARY: DashboardSummary = {
  zone: 'Labé',
  praticiens: 1240,
  dossiersSoumis: 7,
  comptes: 3,
  specialites: 8,
  activite: [
    {
      dossier: 'DS-2018',
      praticienNom: 'Mariama Diallo',
      decision: 'soumis',
      etape: 2,
      le: '2026-11-07T09:30:00Z',
    },
  ],
  smsNonRemis: {
    total: 2,
    derniers: [
      {
        objet: 'DS-2011',
        destinataire: 'Sékou Kourouma',
        raison: 'Aucun numéro de téléphone',
        le: '2026-11-12T08:15:00Z',
      },
    ],
  },
};

// Réponses de l'API, par adresse
function mockApi(session: SessionUser | null | 'panne') {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/auth/session') {
      if (session === 'panne') return new Response(null, { status: 503 });
      return session ? Response.json(session) : new Response(null, { status: 401 });
    }
    if (url === '/api/tableau-de-bord') return Response.json(SUMMARY);
    if (
      url === '/api/dossiers/verification-terrain' ||
      url === '/api/dossiers/consolidation' ||
      url === '/api/dossiers/expertise'
    )
      return Response.json({ elements: [], suivant: null });
    if (url === '/auth/logout' && init?.method === 'POST')
      return new Response(null, { status: 204 });
    return new Response(null, { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// Pages chargées à la demande (lazy) : leur première transformation par Vite peut dépasser
// le délai d'attente des tests quand toutes les suites tournent en parallèle (pipeline
// complet). Préchargées une fois, elles s'affichent aussitôt ; le test vérifie l'écran, pas
// la vitesse du poste.
beforeAll(async () => {
  await Promise.all([
    import('./Dashboard'),
    import('./AccountsPage'),
    import('./ReferentialsPage'),
  ]);
}, 60_000);

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
      /Reconnectez-vous et saisissez le code affiché/,
    );
    expect(window.location.search).toBe('');
  });

  it('DG connectée : tableau de bord, navigation de son rôle, chiffres de sa zone (US-016)', async () => {
    mockApi(dg);
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Bonjour, Awa Camara' }));
    const nav = screen.getByRole('navigation', { name: 'Navigation principale' });
    expect(
      within(nav).getByRole('link', { name: 'Tableau de bord' }).getAttribute('aria-current'),
    ).toBe('page');
    expect(within(nav).getByRole('link', { name: 'Comptes' }).getAttribute('href')).toBe(
      '/comptes',
    );
    expect(within(nav).getByRole('link', { name: 'Référentiels' }));
    expect(await screen.findByText('Direction Générale · Labé'));
    expect(screen.getByText('1 240'));
    expect(screen.getByText('Dossiers soumis').parentElement!.textContent).toMatch(/7/);
    // Activité récente : heure de Conakry, libellé en clair
    const row = screen.getByRole('row', { name: /DS-2018/ });
    expect(row.textContent).toMatch(/Mariama Diallo.*Dossier soumis.*2 sur 6/);
    expect(row.textContent).toMatch(/09:30/);
    // Fonctions à venir annoncées, sans lien vers une page qui n'existe pas
    // Plus de calendrier des sprints sur l'accueil (US-019) ; accès directs dans l'en-tête
    expect(screen.queryByRole('heading', { name: 'À venir' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Gérer les comptes' }).getAttribute('href')).toBe(
      '/comptes',
    );
    expect(screen.queryByRole('link', { name: 'Activer le double facteur' })).toBeNull();
  });

  it('DG : SMS non remis après tous les essais, avec le dossier et la raison (US-031)', async () => {
    mockApi(dg);
    render(<App />);
    expect(await screen.findByText('Direction Générale · Labé'));
    expect(screen.getByText('SMS non remis', { selector: 'p' }).parentElement!.textContent).toMatch(
      /2.*Après 4 essais/,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'SMS non remis' }));
    const row = screen.getByRole('row', { name: /DS-2011/ });
    expect(row.textContent).toMatch(/08:15.*Sékou Kourouma.*Aucun numéro de téléphone/);
  });

  it('administrateur préfectoral : pas de carte ni de liste des SMS non remis (DG seule)', async () => {
    mockApi(prefectoral);
    render(<App />);
    expect(await screen.findByText('Administrateur préfectoral · Labé'));
    expect(screen.queryByText('SMS non remis')).toBeNull();
  });

  it('DG : rubrique Entonnoir de certification dans Pilotage, réservée à la DG (US-048)', async () => {
    mockApi(dg);
    render(<App />);
    const link = await screen.findByRole('link', { name: 'Entonnoir de certification' });
    expect(link.getAttribute('href')).toBe('/entonnoir');
    cleanup();
    for (const user of [prefectoral, regional, committee]) {
      mockApi(user);
      window.history.replaceState(null, '', '/entonnoir');
      render(<App />);
      expect(await screen.findByRole('heading', { level: 1 }));
      expect(screen.queryByRole('link', { name: 'Entonnoir de certification' })).toBeNull();
      expect(screen.queryByRole('heading', { name: 'Entonnoir de certification' })).toBeNull();
      cleanup();
    }
  });

  it('administrateur préfectoral : pas de rubrique Administration (navigation selon le rôle)', async () => {
    mockApi(prefectoral);
    render(<App />);
    expect(await screen.findByText('Administrateur préfectoral · Labé'));
    expect(screen.queryByRole('link', { name: 'Comptes' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Administration' })).toBeNull();
  });

  it('administrateur préfectoral : rubrique Vérification terrain et sa page (US-042)', async () => {
    mockApi(prefectoral);
    window.history.replaceState(null, '', '/verification-terrain');
    render(<App />);
    const link = await screen.findByRole('link', { name: 'Vérification terrain' });
    expect(link.getAttribute('href')).toBe('/verification-terrain');
    expect(await screen.findByRole('heading', { level: 1, name: 'Vérification terrain' }));
  });

  it('administrateur régional : rubrique Consolidation régionale et sa page (US-043)', async () => {
    mockApi(regional);
    window.history.replaceState(null, '', '/consolidation');
    render(<App />);
    const link = await screen.findByRole('link', { name: 'Consolidation régionale' });
    expect(link.getAttribute('href')).toBe('/consolidation');
    expect(await screen.findByRole('heading', { level: 1, name: 'Consolidation régionale' }));
    expect(screen.queryByRole('link', { name: 'Vérification terrain' })).toBeNull();
  });

  it.each([
    ['DG (niveau national)', dg],
    ['préfectoral', prefectoral],
  ])(
    '%s : ni rubrique ni page de consolidation (décision du seul régional)',
    async (_who, user) => {
      mockApi(user);
      window.history.replaceState(null, '', '/consolidation');
      render(<App />);
      expect(await screen.findByRole('heading', { level: 1 }));
      expect(screen.queryByRole('link', { name: 'Consolidation régionale' })).toBeNull();
      expect(
        screen.queryByRole('heading', { level: 1, name: 'Consolidation régionale' }),
      ).toBeNull();
    },
  );

  it('Comité scientifique : rubrique Expertise des dossiers et sa page (US-044)', async () => {
    mockApi(committee);
    window.history.replaceState(null, '', '/expertise');
    render(<App />);
    const link = await screen.findByRole('link', { name: 'Expertise des dossiers' });
    expect(link.getAttribute('href')).toBe('/expertise');
    expect(await screen.findByRole('heading', { level: 1, name: 'Expertise des dossiers' }));
  });

  it.each([
    ['DG', dg],
    ['régional', regional],
  ])('%s : ni rubrique ni page d’expertise (décision du seul Comité)', async (_who, user) => {
    mockApi(user);
    window.history.replaceState(null, '', '/expertise');
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1 }));
    expect(screen.queryByRole('link', { name: 'Expertise des dossiers' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 1, name: 'Expertise des dossiers' })).toBeNull();
  });

  it('DG : ni rubrique ni page de vérification terrain (décision du seul préfectoral)', async () => {
    mockApi(dg);
    window.history.replaceState(null, '', '/verification-terrain');
    render(<App />);
    expect(await screen.findByRole('link', { name: 'Comptes' }));
    expect(screen.queryByRole('link', { name: 'Vérification terrain' })).toBeNull();
    expect(screen.queryByRole('heading', { level: 1, name: 'Vérification terrain' })).toBeNull();
  });

  it('compte sans zone active en base : refus de l’API dit en français', async () => {
    const fetchMock = mockApi(dg);
    fetchMock.mockImplementation(async (url: string) =>
      url === '/auth/session'
        ? Response.json(dg)
        : Response.json({ message: 'Forbidden' }, { status: 403 }),
    );
    render(<App />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/rattaché à aucune zone active/);
    expect(alert.textContent).not.toMatch(/Forbidden/);
  });

  it('praticien : pas de chiffres de zone (réservés aux administrateurs)', async () => {
    const fetchMock = mockApi(praticien);
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Bonjour, Sékou Condé' }));
    expect(screen.queryByRole('heading', { name: 'Chiffres de votre zone' })).toBeNull();
    expect(fetchMock).not.toHaveBeenCalledWith('/api/tableau-de-bord', expect.anything());
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
