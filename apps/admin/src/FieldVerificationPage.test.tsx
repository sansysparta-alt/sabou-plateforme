// US-042 et US-041 : écran de vérification terrain et visites. API simulée ; les règles
// elles-mêmes (visite, compte rendu, motif, zone) sont prouvées par la base
// (packages/db/test/decision-etape-2.test.ts, visites-terrain.test.ts) et de bout en bout
// (e2e/verification-terrain.spec.ts, e2e/visites-terrain.spec.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FieldVerificationItem, FieldVisit } from '@sabou/types';
import { FieldVerificationPage } from './FieldVerificationPage';

const planned: FieldVisit = {
  id: 7,
  statut: 'planifiee',
  prevueLe: '2026-11-20T09:30',
  rappelEnvoye: false,
  realiseeLe: null,
  avis: null,
  signePar: null,
  signeLe: null,
  empreinte: null,
  photo: false,
};
const realized: FieldVisit = {
  ...planned,
  statut: 'realisee',
  rappelEnvoye: true,
  realiseeLe: '2026-11-12',
  avis: 'favorable',
  signePar: 'Ibrahima Sow',
  signeLe: '2026-11-12T16:05:00Z',
  empreinte: 'f9190c213cd642697300a0b21be71eae76f1dba5db274de7f8b2ad3489e9d502',
};

const visited: FieldVerificationItem = {
  code: 'DS-2001',
  praticien: 'PR-2001',
  praticienNom: 'Mariama Soumah',
  specialite: 'Phytothérapie',
  type: 'initial',
  soumisLe: '2026-11-07T10:00:00Z',
  visiteRequise: true,
  visiteRealisee: true,
  visite: realized,
};
const notVisited: FieldVerificationItem = {
  ...visited,
  code: 'DS-2002',
  praticien: 'PR-2002',
  praticienNom: 'Sékou Kourouma',
  visiteRealisee: false,
  visite: null,
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
        decisions.push({
          url,
          body: init.body instanceof Blob ? init.body : JSON.parse(String(init.body)),
        });
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

describe('US-041 : visite sur place', () => {
  const VISIT = '/api/dossiers/DS-2002/visite';
  const status = () => screen.getByRole('status').textContent;

  it('sans visite : planifier ouvre le formulaire, focus sur la date', async () => {
    render(<FieldVerificationPage />);
    const second = await item('DS-2002');
    fireEvent.click(
      within(second).getByRole('button', { name: 'Planifier la visite du dossier DS-2002' }),
    );
    const field = within(second).getByLabelText('Date et heure de la visite');
    await waitFor(() => expect(document.activeElement).toBe(field));
    expect(field.getAttribute('type')).toBe('datetime-local');
    expect(field.getAttribute('min')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it('sans date : erreur liée au champ, rien n’est envoyé', async () => {
    render(<FieldVerificationPage />);
    const second = await item('DS-2002');
    fireEvent.click(within(second).getByRole('button', { name: /^Planifier la visite/ }));
    fireEvent.click(within(second).getByRole('button', { name: 'Enregistrer la date' }));
    expect(
      within(second).getByLabelText('Date et heure de la visite').getAttribute('aria-invalid'),
    ).toBe('true');
    expect(decisions).toEqual([]);
  });

  it('planifie : envoie la date saisie, annonce le rappel de la veille', async () => {
    mockApi({ [LIST]: { elements: [notVisited], suivant: null } }, () => Response.json(planned));
    render(<FieldVerificationPage />);
    const second = await item('DS-2002');
    fireEvent.click(within(second).getByRole('button', { name: /^Planifier la visite/ }));
    fireEvent.change(within(second).getByLabelText('Date et heure de la visite'), {
      target: { value: '2026-11-20T09:30' },
    });
    fireEvent.click(within(second).getByRole('button', { name: 'Enregistrer la date' }));
    expect(await within(second).findByText('20 novembre 2026 à 09:30'));
    expect(decisions).toEqual([{ url: VISIT, body: { prevueLe: '2026-11-20T09:30' } }]);
    expect(status()).toBe(
      'Visite planifiée le 20 novembre 2026 à 09:30. Le praticien sera prévenu la veille.',
    );
    expect(within(second).getByText('Par SMS, la veille'));
    await waitFor(() => expect(document.activeElement?.textContent).toContain('Visite sur place'));
  });

  describe('Critère 2 : compte rendu signé obligatoire', () => {
    const withPlanned = { ...notVisited, visite: planned };
    const openReport = async () => {
      render(<FieldVerificationPage />);
      const card = await item('DS-2002');
      fireEvent.click(within(card).getByRole('button', { name: /^Enregistrer le compte rendu/ }));
      return card;
    };

    it('chaque champ manquant est signalé, l’attestation comprise ; rien n’est envoyé', async () => {
      mockApi({ [LIST]: { elements: [withPlanned], suivant: null } });
      const card = await openReport();
      expect(within(card).getByLabelText('Date de la visite').getAttribute('max')).toMatch(
        /^\d{4}-\d{2}-\d{2}$/,
      );
      fireEvent.click(within(card).getByRole('button', { name: 'Signer le compte rendu' }));
      expect(within(card).getByText('Choisissez un avis.'));
      expect(within(card).getByText('Décrivez ce que vous avez constaté.'));
      expect(within(card).getByText('Cochez l’attestation pour signer le compte rendu.'));
      expect(document.activeElement).toBe(within(card).getByLabelText('Favorable'));
      expect(decisions).toEqual([]);
    });

    it('signe : envoie le compte rendu, rend la validation possible', async () => {
      mockApi({ [LIST]: { elements: [withPlanned], suivant: null } }, () =>
        Response.json({ ...realized, realiseeLe: '2026-11-13' }),
      );
      const card = await openReport();
      expect(within(card).queryByRole('button', { name: /^Valider/ })).toBeNull();
      fireEvent.change(within(card).getByLabelText('Date de la visite'), {
        target: { value: '2026-11-13' },
      });
      fireEvent.click(within(card).getByLabelText('Favorable avec réserves'));
      fireEvent.change(within(card).getByLabelText('Constats'), {
        target: { value: '  Lieu conforme.  ' },
      });
      fireEvent.click(within(card).getByLabelText(/Je certifie avoir réalisé cette visite/));
      fireEvent.click(within(card).getByRole('button', { name: 'Signer le compte rendu' }));
      expect(await within(card).findByText('Signé par Ibrahima Sow, le 12 novembre 2026 à 16:05'));
      expect(decisions).toEqual([
        {
          url: `${VISIT}/compte-rendu`,
          body: {
            visite: 7,
            realiseeLe: '2026-11-13',
            avis: 'reserve',
            constats: 'Lieu conforme.',
            attestation: true,
          },
        },
      ]);
      expect(status()).toBe('Compte rendu signé : la visite est enregistrée.');
      expect(within(card).getByText('Réalisée, compte rendu signé'));
      expect(within(card).getByRole('button', { name: /^Valider/ }));
    });

    it('refus de l’API : message dans le formulaire, qui reste ouvert', async () => {
      mockApi({ [LIST]: { elements: [withPlanned], suivant: null } }, () =>
        Response.json({ error: 'invalid_date', message: 'Date refusée.' }, { status: 422 }),
      );
      const card = await openReport();
      fireEvent.click(within(card).getByLabelText('Favorable'));
      fireEvent.change(within(card).getByLabelText('Constats'), { target: { value: 'RAS' } });
      fireEvent.click(within(card).getByLabelText(/Je certifie/));
      fireEvent.click(within(card).getByRole('button', { name: 'Signer le compte rendu' }));
      expect((await within(card).findByRole('alert')).textContent).toContain('Date refusée.');
      expect(within(card).getByRole('button', { name: 'Signer le compte rendu' }));
    });
  });

  it('visite réalisée : avis, empreinte abrégée ; photo facultative jointe', async () => {
    mockApi({ [LIST]: { elements: [visited], suivant: null } }, () =>
      Response.json({ ...realized, photo: true }),
    );
    render(<FieldVerificationPage />);
    const first = await item('DS-2001');
    expect(within(first).getByText('Favorable'));
    expect(within(first).getByText('f9190c213cd64269…'));
    expect(
      within(first).queryByRole('button', { name: /^Enregistrer le compte rendu/ }),
    ).toBeNull();
    const photo = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'fiche.jpg', {
      type: 'image/jpeg',
    });
    fireEvent.change(within(first).getByLabelText('Photo de la fiche papier (facultative)'), {
      target: { files: [photo] },
    });
    fireEvent.click(within(first).getByRole('button', { name: /^Joindre la photo/ }));
    expect(await within(first).findByText('Jointe'));
    expect(decisions).toEqual([{ url: '/api/dossiers/DS-2001/visite/7/photo', body: photo }]);
    expect(status()).toBe('Photo de la fiche jointe au compte rendu.');
  });
});
