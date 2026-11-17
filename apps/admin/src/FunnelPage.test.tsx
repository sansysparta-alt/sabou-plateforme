// US-048 : écran de l'entonnoir (DG). API simulée ; les calculs sont prouvés par la base
// (packages/db/test/entonnoir-certification.test.ts), l'écran complet de bout en bout
// (e2e/entonnoir.spec.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { CertificationFunnel } from '@sabou/types';
import { FunnelPage } from './FunnelPage';

const step = (etape: number, extra: Partial<CertificationFunnel['etapes'][number]> = {}) => ({
  etape,
  enCours: 0,
  bloques: 0,
  passages: 0,
  delaiMoyenJours: null,
  ...extra,
});

const FUNNEL: CertificationFunnel = {
  delaiCibleJours: 3,
  seuilBlocageJours: 15,
  etapes: [
    step(1, { enCours: 4, passages: 10, delaiMoyenJours: 1.5 }),
    step(2, { enCours: 3, bloques: 1, passages: 8, delaiMoyenJours: 5.25 }),
    step(3, { enCours: 1, passages: 6, delaiMoyenJours: 2 }),
    step(4),
    step(5),
    step(6, { passages: 5, delaiMoyenJours: 0 }),
  ],
  bloques: {
    total: 1,
    dossiers: [
      {
        dossier: 'DS-1041',
        praticien: 'PR-1041',
        nom: 'Sékou Kourouma',
        etape: 2,
        prefecture: 'Labé',
        region: 'Labé',
        depuis: '2026-10-20T08:00:00Z',
        jours: 25,
      },
    ],
  },
};

let response: () => Response;
beforeEach(() => {
  response = () => Response.json(FUNNEL);
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response()),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Entonnoir de certification', () => {
  it('critère : nombre par étape, délai moyen par étape, délai au-delà de la cible signalé', async () => {
    render(<FunnelPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Entonnoir de certification' }));
    const table = await screen.findByRole('table', { name: 'Dossiers par étape et délai moyen' });
    const rows = within(table).getAllByRole('row');
    // En-tête puis les 6 étapes, dans l'ordre
    expect(rows).toHaveLength(7);
    expect(rows[1]!.textContent).toBe('1. Dépôt du dossier401,5 j10');
    expect(rows[2]!.textContent).toBe('2. Vérification terrain315,3 j8');
    expect(rows[4]!.textContent).toBe('4. Expertise du Comité00—0');
    expect(rows[6]!.textContent).toBe('6. Publication000 j5');
    expect(screen.getByText(/Délai cible : 3 jours par étape/));
  });

  it('critère : dossiers sans décision depuis plus de 15 jours, avec praticien, étape et zone', async () => {
    render(<FunnelPage />);
    const table = await screen.findByRole('table', { name: 'Dossiers bloqués' });
    const row = within(table).getByRole('row', { name: /DS-1041/ });
    expect(row.textContent).toMatch(
      /DS-1041Sékou Kourouma \(PR-1041\)2\. Vérification terrainLabé, Labé25 j \(le 20\/10\/2026\)/,
    );
    expect(screen.getByText(/1 dossier sans décision depuis plus de 15 jours/));
  });

  it('aucun dossier bloqué : message, pas de tableau vide', async () => {
    response = () => Response.json({ ...FUNNEL, bloques: { total: 0, dossiers: [] } });
    render(<FunnelPage />);
    expect(await screen.findByText('Aucun dossier sans décision depuis plus de 15 jours.'));
    expect(screen.queryByRole('table', { name: 'Dossiers bloqués' })).toBeNull();
  });

  it('plus de dossiers bloqués que la liste : le total est donné', async () => {
    response = () =>
      Response.json({ ...FUNNEL, bloques: { total: 140, dossiers: FUNNEL.bloques.dossiers } });
    render(<FunnelPage />);
    expect(
      await screen.findByText(/140 dossiers sans décision.*les 1 plus anciens sont affichés\./),
    );
  });

  it('accès refusé : message en clair', async () => {
    response = () => Response.json({ message: 'Forbidden' }, { status: 403 });
    render(<FunnelPage />);
    expect((await screen.findByRole('alert')).textContent).toMatch(
      /réservé à la Direction Générale/,
    );
  });
});
