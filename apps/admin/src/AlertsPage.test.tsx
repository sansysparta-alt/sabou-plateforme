// US-102 : alertes territoriales dans la gestion. API simulée ; la détection, le cloisonnement
// et les droits de chaque action sont prouvés par la base (packages/db/test/alertes.test.ts)
// et l'API (apps/api/src/alerts/alerts.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { TerritorialAlert } from '@sabou/types';
import { DirectorAlertsPage, PrefectoralAlertsPage, RegionalAlertsPage } from './AlertsPage';
import { openDossier } from './test-dossier';

const blocked: TerritorialAlert = {
  id: 3,
  type: 'dossier_bloque',
  statut: 'nouvelle',
  region: 'Labé',
  prefecture: 'Labé',
  maladie: null,
  dossier: 'DS-1041',
  description: 'DS-1041 : étape 2 depuis le 01/11/2026.',
  creeLe: '2026-11-19T08:00:00Z',
  accuseeLe: null,
  relances: 0,
  relanceeLe: null,
};
const desert: TerritorialAlert = {
  ...blocked,
  id: 4,
  type: 'desert_therapeutique',
  prefecture: 'Mali',
  dossier: null,
  description: 'Aucun praticien certifié dans la préfecture de Mali.',
};

let posts: { url: string; body: unknown }[];

beforeEach(() => {
  posts = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        if (url.endsWith('/relance')) return Response.json({ prevenus: 2 });
        if (url === '/api/alertes') return Response.json({ id: 9 }, { status: 201 });
        return new Response(null, { status: 204 });
      }
      if (url === '/api/alertes') return Response.json([blocked, desert]);
      if (url === '/api/alertes/referentiels') {
        return Response.json({
          prefectures: [{ id: 4, nom: 'Labé' }],
          maladies: [{ code: 'MA-001', nomFr: 'Paludisme' }],
        });
      }
      return new Response(null, { status: 404 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Critère 1 : les trois types d’alerte', () => {
  it('dossier bloqué et désert listés avec leur constat', async () => {
    render(<RegionalAlertsPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Alertes territoriales' }));
    const row = await openDossier(/Dossier bloqué · Labé/);
    expect(within(row).getByText('DS-1041 : étape 2 depuis le 01/11/2026.'));
    expect(await screen.findByRole('heading', { level: 3, name: /Désert thérapeutique · Mali/ }));
    // Le régional ne déclare pas de hausse de pathologie
    expect(screen.queryByRole('heading', { name: 'Déclarer une hausse de pathologie' })).toBeNull();
  });

  it('préfectoral : hausse de pathologie déclarée pour sa préfecture (choisie d’office)', async () => {
    render(<PrefectoralAlertsPage />);
    const form = (await screen.findByRole('heading', { name: 'Déclarer une hausse de pathologie' }))
      .parentElement!;
    fireEvent.click(within(form).getByRole('button', { name: 'Déclarer l’alerte' }));
    expect(within(form).getByText('Choisissez la maladie.'));
    expect(within(form).getByText('Décrivez la hausse constatée.'));
    await waitFor(() =>
      expect((within(form).getByLabelText(/Préfecture/) as HTMLSelectElement).value).toBe('4'),
    );
    fireEvent.change(within(form).getByLabelText(/Maladie/), { target: { value: 'MA-001' } });
    fireEvent.change(within(form).getByLabelText(/Ce qui est constaté/), {
      target: { value: '12 cas en une semaine à Garambé.' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Déclarer l’alerte' }));
    await waitFor(() =>
      expect(posts).toEqual([
        {
          url: '/api/alertes',
          body: {
            prefectureId: 4,
            maladie: 'MA-001',
            description: '12 cas en une semaine à Garambé.',
          },
        },
      ]),
    );
    expect(await screen.findByText(/Hausse de pathologie déclarée/));
  });
});

describe('Critère 2 : accusé de réception et relance', () => {
  it('accusé de réception, puis relance qui dit combien de responsables sont prévenus', async () => {
    render(<DirectorAlertsPage />);
    const row = await openDossier(/Dossier bloqué · Labé/);
    fireEvent.click(within(row).getByRole('button', { name: /Accuser réception/ }));
    expect(await screen.findByText('Accusé de réception donné pour l’alerte AL-3.'));
    const again = await openDossier(/Dossier bloqué · Labé/);
    fireEvent.click(within(again).getByRole('button', { name: /Relancer/ }));
    expect(await screen.findByText(/relancée : 2 responsables prévenus/));
    expect(posts.map((p) => p.url)).toEqual(['/api/alertes/3/accuse', '/api/alertes/3/relance']);
  });

  it('clôture : motif exigé', async () => {
    render(<RegionalAlertsPage />);
    const row = await openDossier(/Désert thérapeutique · Mali/);
    fireEvent.click(within(row).getByRole('button', { name: /Clore l’alerte/ }));
    expect(within(row).getByText('Indiquez le motif de la clôture.'));
    fireEvent.change(within(row).getByLabelText(/Motif de la clôture/), {
      target: { value: 'Campagne de certification lancée.' },
    });
    fireEvent.click(within(row).getByRole('button', { name: /Clore l’alerte/ }));
    await waitFor(() =>
      expect(posts).toEqual([
        { url: '/api/alertes/4/cloture', body: { motif: 'Campagne de certification lancée.' } },
      ]),
    );
  });

  it('préfectoral : accuse réception, ne relance ni ne clôt', async () => {
    render(<PrefectoralAlertsPage />);
    const row = await openDossier(/Dossier bloqué · Labé/);
    expect(within(row).getByRole('button', { name: /Accuser réception/ }));
    expect(within(row).queryByRole('button', { name: /Relancer/ })).toBeNull();
    expect(within(row).queryByRole('button', { name: /Clore/ })).toBeNull();
  });
});
