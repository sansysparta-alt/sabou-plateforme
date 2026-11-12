// US-042 : écran de vérification terrain. API simulée ; les règles elles-mêmes (visite,
// motif, zone) sont prouvées par la base (packages/db/test/decision-etape-2.test.ts) et
// de bout en bout (e2e/verification-terrain.spec.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FieldVerificationItem } from '@sabou/types';
import { FieldVerificationPage } from './FieldVerificationPage';

const visited: FieldVerificationItem = {
  code: 'DS-2001',
  praticien: 'PR-2001',
  praticienNom: 'Mariama Soumah',
  specialite: 'Phytothérapie',
  type: 'initial',
  soumisLe: '2026-11-07T10:00:00Z',
  visiteRequise: true,
  visiteRealisee: true,
};
const notVisited: FieldVerificationItem = {
  ...visited,
  code: 'DS-2002',
  praticien: 'PR-2002',
  praticienNom: 'Sékou Kourouma',
  visiteRealisee: false,
};

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;

let decisions: { url: string; body: unknown }[];

function mockApi(
  pages: Record<string, { elements: FieldVerificationItem[]; suivant: string | null }>,
  decide?: Handler,
) {
  decisions = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        decisions.push({ url, body: JSON.parse(String(init.body)) });
        return decide ? decide(url, init) : Response.json({ code: 'DS-2001', etape: 3 });
      }
      const page = pages[url];
      return page ? Response.json(page) : new Response(null, { status: 404 });
    }),
  );
}

const LIST = '/api/dossiers/verification-terrain';

beforeEach(() => mockApi({ [LIST]: { elements: [visited, notVisited], suivant: null } }));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const item = async (code: string) =>
  (await screen.findByRole('heading', { level: 3, name: new RegExp(code) })).closest('li')!;

describe('Liste des dossiers à l’étape 2', () => {
  it('montre chaque dossier et l’état de sa visite', async () => {
    render(<FieldVerificationPage />);
    const first = await item('DS-2001');
    expect(within(first).getByText('Réalisée, compte rendu signé'));
    expect(within(first).getByText('Phytothérapie'));
    const second = await item('DS-2002');
    expect(within(second).getByText('À réaliser'));
  });

  it('sans visite réalisée : pas de bouton Valider, la raison est dite (critère 2)', async () => {
    render(<FieldVerificationPage />);
    const second = await item('DS-2002');
    expect(within(second).queryByRole('button', { name: /^Valider/ })).toBeNull();
    expect(within(second).getByText(/possible une fois la visite réalisée/));
    // Le rejet reste possible sans visite (pièce illisible, par exemple)
    expect(
      within(second).getByRole('button', { name: 'Rejeter le dossier DS-2002, Sékou Kourouma' }),
    );
  });

  it('renouvellement sans visite exigée : validation possible (R-QR-07)', async () => {
    mockApi({
      [LIST]: {
        elements: [{ ...notVisited, type: 'renouvellement', visiteRequise: false }],
        suivant: null,
      },
    });
    render(<FieldVerificationPage />);
    const only = await item('DS-2002');
    expect(within(only).getByText('Non requise'));
    expect(within(only).getByRole('button', { name: /^Valider/ }));
  });

  it('liste vide : message explicite', async () => {
    mockApi({ [LIST]: { elements: [], suivant: null } });
    render(<FieldVerificationPage />);
    expect(await screen.findByText('Aucun dossier en attente de vérification.'));
  });

  it('charge la page suivante à la demande', async () => {
    mockApi({
      [LIST]: { elements: [visited], suivant: 'DS-2001' },
      [`${LIST}?apres=DS-2001`]: { elements: [notVisited], suivant: null },
    });
    render(<FieldVerificationPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Afficher les dossiers suivants' }));
    expect(await item('DS-2002'));
    expect(screen.queryByRole('button', { name: 'Afficher les dossiers suivants' })).toBeNull();
  });

  it('erreur de chargement : message de l’API', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ message: 'Accès refusé.' }, { status: 403 })),
    );
    render(<FieldVerificationPage />);
    expect((await screen.findByRole('alert')).textContent).toContain('Accès refusé.');
  });
});

describe('Validation (critère 1)', () => {
  it('envoie l’étape vue, retire le dossier, annonce la décision et garde le focus', async () => {
    render(<FieldVerificationPage />);
    const first = await item('DS-2001');
    fireEvent.click(
      within(first).getByRole('button', { name: 'Valider le dossier DS-2001, Mariama Soumah' }),
    );
    await waitFor(() => expect(screen.queryByRole('heading', { name: /DS-2001/ })).toBeNull());
    expect(decisions).toEqual([
      { url: '/api/dossiers/DS-2001/decision', body: { etape: 2, decision: 'valide' } },
    ]);
    expect(screen.getByRole('status').textContent).toBe(
      'Dossier DS-2001 validé : il passe à la consolidation régionale.',
    );
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: 'Dossiers à vérifier' }),
    );
  });

  it('refus de l’API : message dans la carte du dossier, qui reste affiché', async () => {
    mockApi({ [LIST]: { elements: [visited], suivant: null } }, () =>
      Response.json(
        { error: 'stale', message: 'Ce dossier a changé d’étape entre-temps. Rechargez la liste.' },
        { status: 409 },
      ),
    );
    render(<FieldVerificationPage />);
    const first = await item('DS-2001');
    fireEvent.click(within(first).getByRole('button', { name: /^Valider/ }));
    expect((await within(first).findByRole('alert')).textContent).toContain('changé d’étape');
    expect(
      within(first)
        .getByRole('button', { name: /^Valider/ })
        .hasAttribute('disabled'),
    ).toBe(false);
  });
});

describe('Rejet (critère 3)', () => {
  it('ouvre le formulaire, focus sur le motif', async () => {
    render(<FieldVerificationPage />);
    const second = await item('DS-2002');
    fireEvent.click(within(second).getByRole('button', { name: /^Rejeter/ }));
    const motif = within(second).getByLabelText('Motif du rejet');
    await waitFor(() => expect(document.activeElement).toBe(motif));
    expect(motif.getAttribute('maxlength')).toBe('1000');
  });

  it('sans motif : erreur liée au champ, rien n’est envoyé', async () => {
    render(<FieldVerificationPage />);
    const second = await item('DS-2002');
    fireEvent.click(within(second).getByRole('button', { name: /^Rejeter/ }));
    const motif = within(second).getByLabelText('Motif du rejet');
    fireEvent.change(motif, { target: { value: '   ' } });
    fireEvent.click(within(second).getByRole('button', { name: 'Confirmer le rejet' }));
    expect(motif.getAttribute('aria-invalid')).toBe('true');
    expect(within(second).getByText('Indiquez le motif du rejet.'));
    expect(decisions).toEqual([]);
  });

  it('avec motif : envoie le motif sans espaces autour et retire le dossier', async () => {
    mockApi({ [LIST]: { elements: [visited, notVisited], suivant: null } }, () =>
      Response.json({ code: 'DS-2002', etape: 1 }),
    );
    render(<FieldVerificationPage />);
    const second = await item('DS-2002');
    fireEvent.click(within(second).getByRole('button', { name: /^Rejeter/ }));
    fireEvent.change(within(second).getByLabelText('Motif du rejet'), {
      target: { value: '  Pièce d’identité illisible  ' },
    });
    fireEvent.click(within(second).getByRole('button', { name: 'Confirmer le rejet' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: /DS-2002/ })).toBeNull());
    expect(decisions).toEqual([
      {
        url: '/api/dossiers/DS-2002/decision',
        body: { etape: 2, decision: 'rejete', motif: 'Pièce d’identité illisible' },
      },
    ]);
    expect(screen.getByRole('status').textContent).toBe(
      'Dossier DS-2002 rejeté : il revient au praticien.',
    );
  });

  it('annuler : formulaire fermé, focus rendu au bouton Rejeter', async () => {
    render(<FieldVerificationPage />);
    const second = await item('DS-2002');
    fireEvent.click(within(second).getByRole('button', { name: /^Rejeter/ }));
    fireEvent.click(within(second).getByRole('button', { name: 'Annuler' }));
    expect(within(second).queryByLabelText('Motif du rejet')).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(within(second).getByRole('button', { name: /^Rejeter/ })),
    );
  });
});
