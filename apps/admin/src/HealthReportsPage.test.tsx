// US-100 : signalements et traitements suspendus (Comité scientifique). API simulée ; l'ordre de
// la file (graves en tête), les décisions, le cloisonnement et la levée sont prouvés par la base
// (packages/db/test/signalements.test.ts) et l'API (apps/api/src/health-reports/health-reports.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { HealthReportItem, SuspendedTreatment } from '@sabou/types';
import { HealthReportsPage, SuspendedTreatmentsPage } from './HealthReportsPage';
import { openDossier } from './test-dossier';

const severe: HealthReportItem = {
  code: 'SIG-00001',
  type: 'danger',
  gravite: 'grave',
  objetType: 'recette',
  objetCode: 'REC-2041',
  objetNom: 'Décoction de Caïlcédrat',
  objetStatut: 'certifiee',
  praticienNom: 'Aïssatou Traoré',
  prefecture: 'Kindia',
  description: 'Vomissements après la deuxième prise.',
  contact: '622 00 00 00',
  recuLe: '2026-11-18T08:00:00Z',
  echeance: '2026-11-19T08:00:00Z',
  enRetard: true,
};
const plant: HealthReportItem = {
  ...severe,
  code: 'SIG-00002',
  type: 'effet_indesirable',
  gravite: 'faible',
  objetType: 'plante',
  objetCode: 'PL-001',
  objetNom: 'Caïlcédrat',
  objetStatut: 'validee',
  praticienNom: null,
  prefecture: null,
  contact: null,
  echeance: null,
  enRetard: false,
};
const suspended: SuspendedTreatment = {
  code: 'REC-2042',
  titreFr: 'Infusion de Néré',
  praticienNom: 'Mamadou Diallo',
  suspenduLe: '2026-11-18T09:00:00Z',
  motif: 'Signalement grave en cours d’examen',
};

let posts: { url: string; body: unknown }[];
let refusal: { status: number; message: string } | null;

beforeEach(() => {
  posts = [];
  refusal = null;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        if (refusal) return Response.json(refusal, { status: refusal.status });
        posts.push({ url, body: JSON.parse(String(init.body)) });
        return new Response(null, { status: 204 });
      }
      if (url.startsWith('/api/signalements/a-traiter')) {
        const left = [severe, plant].filter((e) => !posts.some((p) => p.url.includes(e.code)));
        return Response.json({ elements: left, suivant: null, total: left.length });
      }
      if (url === '/api/signalements/suspendus') {
        return Response.json(posts.length ? [] : [suspended]);
      }
      return new Response(null, { status: 404 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Critère : signalements graves en tête, délai cible 24 h', () => {
  it('gravité, délai dépassé, objet, praticien, contact et description dans le panneau', async () => {
    render(<HealthReportsPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Signalements' }));
    const rows = await screen.findAllByRole('heading', { level: 3 });
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('SIG-00001') as string,
      expect.stringContaining('SIG-00002') as string,
    ]);
    const first = await openDossier(/SIG-00001/);
    expect(within(first).getAllByText('Délai de 24 h dépassé').length).toBeGreaterThan(0);
    expect(within(first).getByText(/Délai cible dépassé depuis le/));
    expect(within(first).getByText('Aïssatou Traoré · Kindia'));
    expect(within(first).getByText('622 00 00 00'));
    expect(within(first).getByText('Vomissements après la deuxième prise.'));
    const second = await openDossier(/SIG-00002/);
    expect(within(second).getByText('Aucun (signalement anonyme)'));
  });
});

describe('Critère : décision motivée (aucune action, révision, suspension, retrait)', () => {
  it('traitement : quatre décisions ; motif et décision exigés ; envoi puis retrait de la file', async () => {
    render(<HealthReportsPage />);
    const row = await openDossier(/SIG-00001/);
    const select = within(row).getByRole('combobox', { name: /Votre décision/ });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Choisir…', 'Aucune action', 'Révision', 'Suspension', 'Retrait définitif']);
    const submit = within(row).getByRole('button', {
      name: 'Enregistrer la décision sur le signalement SIG-00001',
    });
    fireEvent.click(submit);
    expect(await within(row).findByText('Choisissez une décision.'));
    fireEvent.change(select, { target: { value: 'suspension' } });
    expect(within(row).getByText(/quitte le site immédiatement/));
    fireEvent.click(submit);
    expect(await within(row).findByText('Indiquez le motif de la décision.'));
    fireEvent.change(within(row).getByLabelText(/^Motif/), {
      target: { value: ' Danger à examiner ' },
    });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(posts).toEqual([
        {
          url: '/api/signalements/SIG-00001/decision',
          body: { decision: 'suspension', motif: 'Danger à examiner' },
        },
      ]),
    );
    expect(await screen.findByText(/Signalement SIG-00001 clos : suspension \(REC-2041\)/));
    await waitFor(() => expect(screen.queryByRole('heading', { name: /SIG-00001/ })).toBeNull());
  });

  it('plante : seulement aucune action ou révision ; refus de l’API affiché', async () => {
    render(<HealthReportsPage />);
    const row = await openDossier(/SIG-00002/);
    const select = within(row).getByRole('combobox', { name: /Votre décision/ });
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Choisir…', 'Aucune action', 'Révision']);
    refusal = { status: 409, message: 'Ce signalement est déjà traité. Rechargez la liste.' };
    fireEvent.change(select, { target: { value: 'revision' } });
    fireEvent.change(within(row).getByLabelText(/^Motif/), { target: { value: 'À revoir' } });
    fireEvent.click(within(row).getByRole('button', { name: /Enregistrer la décision/ }));
    expect(await within(row).findByText('Ce signalement est déjà traité. Rechargez la liste.'));
  });
});

describe('Levée d’une suspension par le Comité, avec un motif', () => {
  it('motif de la suspension affiché ; motif de la levée exigé ; le traitement quitte la liste', async () => {
    render(<SuspendedTreatmentsPage />);
    const row = await openDossier(/REC-2042/);
    expect(within(row).getByText('Signalement grave en cours d’examen'));
    const lift = within(row).getByRole('button', {
      name: 'Lever la suspension du traitement REC-2042',
    });
    fireEvent.click(lift);
    expect(await within(row).findByText('Indiquez le motif de la levée.'));
    fireEvent.change(within(row).getByLabelText(/^Motif de la levée/), {
      target: { value: 'Effet sans lien' },
    });
    fireEvent.click(lift);
    await waitFor(() =>
      expect(posts).toEqual([
        { url: '/api/signalements/suspendus/REC-2042/levee', body: { motif: 'Effet sans lien' } },
      ]),
    );
    expect(await screen.findByText(/Suspension levée : le traitement REC-2042/));
    expect(screen.getByText('Aucun traitement suspendu.'));
  });
});
