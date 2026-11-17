// US-047 : écran du rejet définitif (DG). API simulée ; le rôle, les effets et les traces sont
// prouvés par la base (packages/db/test/rejet-definitif.test.ts), le parcours complet de bout
// en bout (e2e/rejet-definitif.spec.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { RejectionCandidate } from '@sabou/types';
import { RejectionPage } from './RejectionPage';

const certified: RejectionCandidate = {
  praticien: 'PR-1042',
  nom: 'Mamadou Diallo',
  specialite: 'Phytothérapie',
  prefecture: 'Labé',
  region: 'Labé',
  statut: 'certifie',
  dossier: null,
  certificat: 'SAB-2026-PR1042-KX7',
  traitementsCertifies: 2,
  traitementsEnExamen: 1,
  rejet: null,
};
const inProgress: RejectionCandidate = {
  ...certified,
  praticien: 'PR-1041',
  nom: 'Sékou Kourouma',
  statut: 'en_attente',
  dossier: { code: 'DS-1041', etape: 3 },
  certificat: null,
  traitementsCertifies: 0,
  traitementsEnExamen: 0,
};
const rejected: RejectionCandidate = {
  ...certified,
  praticien: 'PR-1050',
  nom: 'Fanta Kaba',
  statut: 'rejete',
  certificat: null,
  traitementsCertifies: 0,
  rejet: { le: '2026-11-02T10:00:00Z', motif: 'usurpation_identite', recoursJusquau: '2026-12-02' },
};

let bodies: unknown[];
let decision: () => Response;
let searches: string[];

beforeEach(() => {
  bodies = [];
  searches = [];
  decision = () =>
    Response.json({
      praticien: 'PR-1042',
      dossier: null,
      certificat: 'SAB-2026-PR1042-KX7',
      traitementsSuspendus: 2,
      recoursJusquau: '2026-12-14',
    });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        bodies.push({ url, body: JSON.parse(init.body as string) });
        return decision();
      }
      searches.push(url);
      return Response.json([certified, inProgress, rejected]);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function searchFor(q: string) {
  render(<RejectionPage />);
  fireEvent.change(screen.getByLabelText('Praticien'), { target: { value: q } });
  fireEvent.click(screen.getByRole('button', { name: 'Rechercher' }));
  await screen.findByRole('heading', { level: 2, name: `Résultats pour « ${q.trim()} »` });
}

const item = (name: RegExp) =>
  within(screen.getByRole('heading', { level: 3, name }).closest('li')!);

const open = (name: RegExp) => {
  fireEvent.click(item(name).getByRole('button', { name: /Prononcer le rejet définitif/ }));
  return item(name);
};

describe('Recherche', () => {
  it('exige 2 caractères avant d’appeler l’API', () => {
    render(<RejectionPage />);
    fireEvent.change(screen.getByLabelText('Praticien'), { target: { value: ' a ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rechercher' }));
    expect(screen.getByText('Saisissez au moins 2 caractères.')).toBeTruthy();
    expect(searches).toEqual([]);
  });

  it('montre la situation de chaque praticien et annonce le nombre trouvé', async () => {
    await searchFor(' Diallo ');
    expect(searches).toEqual(['/api/praticiens/recherche?q=Diallo']);
    expect(screen.getByRole('status').textContent).toBe('3 praticiens trouvés.');
    const first = item(/PR-1042/);
    expect(first.getByText('Certifié')).toBeTruthy();
    expect(first.getByText('SAB-2026-PR1042-KX7')).toBeTruthy();
    expect(first.getByText('2 certifiés, 1 en cours d’examen')).toBeTruthy();
    expect(item(/PR-1041/).getByText('DS-1041, étape 3 sur 6')).toBeTruthy();
  });

  it('un praticien déjà rejeté : la décision est rappelée, sans bouton', async () => {
    await searchFor('Kaba');
    const done = item(/PR-1050/);
    expect(done.getByText('Rejeté définitivement')).toBeTruthy();
    expect(
      done.getByText(/pour usurpation d’identité ;\s+recours possible jusqu’au 2 décembre 2026/),
    ).toBeTruthy();
    expect(done.queryByRole('button')).toBeNull();
  });
});

describe('Prononcer le rejet', () => {
  it('annonce les conséquences avant la confirmation', async () => {
    await searchFor('Diallo');
    const form = open(/PR-1042/);
    const effects = form.getByRole('heading', { name: 'Ce que le rejet entraîne' }).parentElement!;
    expect(effects.textContent).toContain('Le certificat SAB-2026-PR1042-KX7 est révoqué.');
    expect(effects.textContent).toContain(
      '2 traitements certifiés passent « suspendu » (réversible si le recours aboutit).',
    );
    expect(effects.textContent).toContain('1 traitement en cours d’examen est arrêté');
    expect(effects.textContent).toContain('auprès de l’administration de sa préfecture');
    const dossierCase = open(/PR-1041/);
    expect(
      dossierCase.getByRole('heading', { name: 'Ce que le rejet entraîne' }).parentElement!
        .textContent,
    ).toContain('Le dossier DS-1041 est clos à l’étape 3.');
  });

  it('refuse un formulaire incomplet, focus sur le premier champ en erreur', async () => {
    await searchFor('Diallo');
    const form = open(/PR-1042/);
    fireEvent.click(form.getByRole('button', { name: 'Prononcer le rejet définitif' }));
    expect(form.getByText('Choisissez le motif du rejet.')).toBeTruthy();
    expect(form.getByText('Précisez les faits qui fondent le rejet.')).toBeTruthy();
    expect(form.getByText('Cochez la confirmation pour prononcer le rejet.')).toBeTruthy();
    expect(document.activeElement).toBe(form.getByLabelText('Fraude documentaire'));
    expect(bodies).toEqual([]);
  });

  it('pratique dangereuse : la date et la référence de l’avis du Comité sont exigées puis envoyées', async () => {
    await searchFor('Diallo');
    const form = open(/PR-1042/);
    fireEvent.click(form.getByLabelText(/Pratique dangereuse avérée/));
    fireEvent.change(form.getByLabelText('Faits qui fondent le rejet'), {
      target: { value: ' Décoction toxique, deux hospitalisations. ' },
    });
    fireEvent.click(form.getByRole('checkbox'));
    fireEvent.click(form.getByRole('button', { name: 'Prononcer le rejet définitif' }));
    expect(form.getByText('Indiquez la date de l’avis du Comité.')).toBeTruthy();
    expect(form.getByText('Indiquez la référence de l’avis du Comité.')).toBeTruthy();
    expect(bodies).toEqual([]);

    fireEvent.change(form.getByLabelText('Date de l’avis du Comité scientifique'), {
      target: { value: '2026-11-10' },
    });
    fireEvent.change(form.getByLabelText('Référence de l’avis du Comité'), {
      target: { value: ' AV-2026-014 ' },
    });
    fireEvent.click(form.getByRole('button', { name: 'Prononcer le rejet définitif' }));
    await waitFor(() => expect(bodies).toHaveLength(1));
    expect(bodies[0]).toEqual({
      url: '/api/praticiens/PR-1042/rejet-definitif',
      body: {
        dossier: null,
        motif: 'pratique_dangereuse',
        detail: 'Décoction toxique, deux hospitalisations.',
        avisComite: { date: '2026-11-10', reference: 'AV-2026-014' },
        confirmation: true,
      },
    });
  });

  it('envoie le dossier vu à l’écran, puis annonce la date limite du recours', async () => {
    await searchFor('Kourouma');
    const form = open(/PR-1041/);
    fireEvent.click(form.getByLabelText('Usurpation d’identité'));
    fireEvent.change(form.getByLabelText('Faits qui fondent le rejet'), {
      target: { value: 'Pièce d’identité d’un tiers.' },
    });
    fireEvent.click(form.getByRole('checkbox'));
    fireEvent.click(form.getByRole('button', { name: 'Prononcer le rejet définitif' }));
    const done = await screen.findByText('Rejet définitif prononcé');
    expect(bodies[0]).toMatchObject({ body: { dossier: 'DS-1041', motif: 'usurpation_identite' } });
    const card = item(/PR-1041/);
    expect(card.getByText(/contester la décision jusqu’au 14 décembre 2026/)).toBeTruthy();
    expect(card.getByText('Rejeté définitivement')).toBeTruthy();
    expect(card.queryByRole('button', { name: /Prononcer/ })).toBeNull();
    // Le focus va au message de réussite (le formulaire a disparu)
    await waitFor(() => expect(document.activeElement).toBe(done.closest('.ui-alert')));
  });

  it('situation changée entre-temps : le message de l’API est affiché, rien n’est perdu', async () => {
    decision = () =>
      Response.json(
        { error: 'stale', message: 'La situation de ce praticien a changé entre-temps.' },
        { status: 409 },
      );
    await searchFor('Diallo');
    const form = open(/PR-1042/);
    fireEvent.click(form.getByLabelText('Fraude documentaire'));
    fireEvent.change(form.getByLabelText('Faits qui fondent le rejet'), {
      target: { value: 'Diplôme falsifié.' },
    });
    fireEvent.click(form.getByRole('checkbox'));
    fireEvent.click(form.getByRole('button', { name: 'Prononcer le rejet définitif' }));
    expect(
      await form.findByText('La situation de ce praticien a changé entre-temps.'),
    ).toBeTruthy();
    expect((form.getByLabelText('Faits qui fondent le rejet') as HTMLTextAreaElement).value).toBe(
      'Diplôme falsifié.',
    );
  });

  it('annuler referme le formulaire et rend le focus au bouton', async () => {
    await searchFor('Diallo');
    const form = open(/PR-1042/);
    fireEvent.click(form.getByRole('button', { name: 'Annuler' }));
    const button = await waitFor(() =>
      item(/PR-1042/).getByRole('button', { name: /Prononcer le rejet définitif/ }),
    );
    await waitFor(() => expect(document.activeElement).toBe(button));
  });
});
