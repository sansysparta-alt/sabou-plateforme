// US-091 : rapports mensuels et historique des exports dans la gestion. API simulée ; le
// préremplissage, le cloisonnement, le figement à l'envoi et le renvoi motivé sont prouvés par
// la base (packages/db/test/rapports.test.ts) et l'API (apps/api/src/reports).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type {
  ExportEntry,
  MonthlyReport,
  MonthlyReportList,
  PrefectoralReportContent,
} from '@sabou/types';
import { monthLabel, pastMonths, ReportsPage } from './ReportsPage';

const CONTENT: PrefectoralReportContent = {
  activite: {
    nouveauxPraticiens: 3,
    dossiersSoumis: 4,
    visitesRealisees: 2,
    recettesNumerisees: 1,
    praticiensPublies: 1,
  },
  delais: {
    passages: 4,
    valides: 3,
    renvoyes: 1,
    moyenneJours: 2.5,
    horsDelai: 1,
    objectifJours: 3,
  },
  anomalies: {
    dossiersBloques: [{ dossier: 'DS-1041', etape: 2, depuis: '2026-10-01T08:00:00Z' }],
    alertesOuvertes: 1,
  },
  registre: { enregistres: 186, certifies: 140, enAttente: 46 },
};

const DRAFT: MonthlyReport = {
  id: 7,
  niveau: 'prefectoral',
  zone: 'Labé',
  mois: '2026-10-01',
  version: 1,
  statut: 'brouillon',
  auteur: 'Ibrahima Sow',
  envoyeLe: null,
  renvoyeLe: null,
  contenu: CONTENT,
  commentaire: null,
  calculeLe: '2026-11-20T10:00:00Z',
  renvoiMotif: null,
  versions: [],
  peutModifier: true,
  peutRenvoyer: false,
};

const HISTORY: ExportEntry[] = [
  {
    id: 12,
    type: 'tableau_de_bord',
    format: 'pdf',
    objet: 'Tableau de bord · Labé',
    auteur: 'Ibrahima Sow',
    le: '2026-11-20T09:00:00Z',
  },
];

let list: MonthlyReportList;
let report: MonthlyReport;
let requests: { method: string; url: string; body: unknown }[];

beforeEach(() => {
  requests = [];
  list = { miens: [], recus: [], peutRediger: true, moisPossibles: ['2026-10-01', '2026-09-01'] };
  report = DRAFT;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method !== 'GET') {
        requests.push({ method, url, body: init?.body ? JSON.parse(String(init.body)) : null });
        if (url === '/api/rapports-mensuels') return Response.json({ id: 7 }, { status: 201 });
        if (url === '/api/exports') return Response.json({ id: 13 }, { status: 201 });
        if (url.endsWith('/envoi')) report = { ...report, statut: 'envoye', peutModifier: false };
        return new Response(null, { status: 204 });
      }
      if (url === '/api/rapports-mensuels') return Response.json(list);
      if (url === '/api/rapports-mensuels/7') return Response.json(report);
      if (url === '/api/exports') return Response.json(HISTORY);
      return new Response(null, { status: 404 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Critère 1 : rapport mensuel préfectoral prérempli, envoi au régional', () => {
  it('prépare le mois choisi et affiche les chiffres préremplis', async () => {
    render(<ReportsPage role="prefectoral" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Rapports et exports' }));
    const month = await screen.findByRole('combobox', { name: /Mois/ });
    // Mois proposés par l'API, une fois sa réponse arrivée (12 mois calculés avant)
    await waitFor(() =>
      expect(
        within(month)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['octobre 2026', 'septembre 2026']),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Préparer le rapport' }));
    expect(
      await screen.findByRole('heading', {
        level: 2,
        name: 'Rapport préfectoral · Labé · octobre 2026',
      }),
    );
    expect(requests[0]).toEqual({
      method: 'POST',
      url: '/api/rapports-mensuels',
      body: { mois: '2026-10-01' },
    });
    expect(screen.getByText('Dossiers soumis').nextElementSibling!.textContent).toBe('4');
    expect(screen.getByText('Délai moyen').nextElementSibling!.textContent).toBe('2,5 jours');
    expect(screen.getByRole('row', { name: /DS-1041/ })).toBeTruthy();
  });

  it('commentaire puis envoi avec l’heure du calcul lue à l’écran', async () => {
    render(<ReportsPage role="prefectoral" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Préparer le rapport' }));
    const comment = await screen.findByRole('textbox', { name: /Commentaire/ });
    fireEvent.change(comment, { target: { value: 'Deux visites reportées.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer à l’administration régionale' }));
    await waitFor(() =>
      expect(screen.getAllByRole('status')[0]!.textContent).toBe(
        'Rapport de octobre 2026 envoyé à l’administration régionale.',
      ),
    );
    expect(requests.slice(1)).toEqual([
      {
        method: 'PATCH',
        url: '/api/rapports-mensuels/7/commentaire',
        body: { commentaire: 'Deux visites reportées.' },
      },
      {
        method: 'POST',
        url: '/api/rapports-mensuels/7/envoi',
        body: { calculeLe: '2026-11-20T10:00:00Z' },
      },
    ]);
  });

  it('rapport renvoyé : motif affiché ; envoyé : lecture seule', async () => {
    report = {
      ...DRAFT,
      statut: 'renvoye',
      renvoiMotif: 'Délais à expliquer.',
      commentaire: 'Mois calme.',
      peutModifier: false,
    };
    list = { ...list, miens: [report] };
    render(<ReportsPage role="prefectoral" />);
    const row = await screen.findByRole('row', { name: /octobre 2026/ });
    fireEvent.click(within(row).getByRole('button', { name: /Ouvrir/ }));
    expect(await screen.findByText('Délais à expliquer.'));
    expect(screen.getByText('Mois calme.'));
    expect(screen.queryByRole('textbox', { name: /Commentaire/ })).toBeNull();
  });
});

describe('Critère 1 : réception et renvoi par le régional', () => {
  it('rapports reçus des préfectures ; renvoi avec motif obligatoire', async () => {
    report = { ...DRAFT, statut: 'envoye', peutModifier: false, peutRenvoyer: true };
    list = { ...list, recus: [report] };
    render(<ReportsPage role="regional" />);
    expect(await screen.findByRole('heading', { name: 'Rapports reçus des préfectures' }));
    fireEvent.click(await screen.findByRole('button', { name: /Ouvrir le rapport Labé/ }));
    const send = await screen.findByRole('button', { name: 'Renvoyer le rapport' });
    fireEvent.click(send);
    expect(await screen.findByText('Indiquez ce qui doit être revu.'));
    expect(requests).toEqual([]);
    fireEvent.change(screen.getByRole('textbox', { name: /Motif du renvoi/ }), {
      target: { value: 'Délais à expliquer.' },
    });
    fireEvent.click(send);
    await waitFor(() =>
      expect(requests).toEqual([
        {
          method: 'POST',
          url: '/api/rapports-mensuels/7/renvoi',
          body: { motif: 'Délais à expliquer.' },
        },
      ]),
    );
  });

  it('la DG ne rédige pas : rapports reçus des régions seulement', async () => {
    list = { miens: [], recus: [], peutRediger: false, moisPossibles: [] };
    render(<ReportsPage role="dg" />);
    expect(await screen.findByRole('heading', { name: 'Rapports reçus des régions' }));
    expect(screen.queryByRole('button', { name: 'Préparer le rapport' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Mes rapports' })).toBeNull();
  });
});

describe('Critère 2 : historique des exports', () => {
  it('liste et lien de téléchargement du fichier régénéré', async () => {
    render(<ReportsPage role="scientifique" />);
    const row = await screen.findByRole('row', { name: /Tableau de bord · Labé/ });
    expect(row.textContent).toMatch(/PDF.*Ibrahima Sow/);
    expect(
      within(row)
        .getByRole('link', { name: /Télécharger/ })
        .getAttribute('href'),
    ).toBe('/api/exports/12/fichier');
  });

  it('export d’un rapport : demande enregistrée puis téléchargement', async () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    render(<ReportsPage role="prefectoral" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Préparer le rapport' }));
    fireEvent.click(await screen.findByRole('button', { name: /Exporter en XLSX/ }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/api/exports/13/fichier'));
    expect(requests.at(-1)).toEqual({
      method: 'POST',
      url: '/api/exports',
      body: { type: 'rapport_mensuel', format: 'xlsx', rapport: 7 },
    });
  });
});

it('mois en clair', () => {
  expect(monthLabel('2026-01-01')).toBe('janvier 2026');
});

it('mois proposés avant la réponse de l’API : les 12 derniers mois écoulés', () => {
  const months = pastMonths(new Date('2026-01-15T10:00:00Z'));
  expect(months).toHaveLength(12);
  expect(months[0]).toBe('2025-12-01');
  expect(months.at(-1)).toBe('2025-01-01');
});

it('blocs du profil présents dès l’ouverture, avant les données (aucun décalage)', () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => new Promise(() => {})),
  );
  render(<ReportsPage role="prefectoral" />);
  expect(screen.getByRole('button', { name: 'Préparer le rapport' }));
  expect(screen.getByRole('heading', { name: 'Mes rapports' }));
  expect(screen.getByRole('heading', { name: 'Historique des exports' }));
});
