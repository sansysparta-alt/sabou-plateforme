// US-061 : file des traitements à décider. API simulée ; rôles, zones, motif, historique et SMS
// sont prouvés par la base (packages/db/test/circuit-traitement.test.ts) et l'API
// (apps/api/src/treatments/circuit.test.ts). Le fonctionnement commun de la file (pagination,
// focus, refus de l'API, annulation) est couvert par FieldVerificationPage.test.tsx.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { TreatmentQueueItem } from '@sabou/types';
import { TreatmentsPage } from './TreatmentsPage';

const submitted: TreatmentQueueItem = {
  code: 'REC-0007',
  titreFr: 'Décoction du soir',
  statut: 'soumise',
  praticien: 'PR-1041',
  praticienNom: 'Sékou Kourouma',
  prefecture: 'Labé',
  maladie: 'Paludisme',
  cycleDureeJours: 7,
  cyclePrisesParJour: 2,
  cyclePauseJours: 2,
  plantes: [
    { nomFr: 'Néré', nomScientifique: 'Parkia biglobosa', partie: 'gousses', validee: true },
    { nomFr: 'Neem', nomScientifique: 'Azadirachta indica', partie: null, validee: false },
  ],
  sections: [
    {
      type: 'preparation',
      libelleFr: 'Mode de préparation',
      texteFr: 'Faire bouillir.',
      texteEn: null,
    },
  ],
  contreIndications: ['Grossesse', 'Enfant de moins de 5 ans'],
  visibilite: 'restreinte',
  dossier: 'DS-1041',
  depuisLe: '2026-11-16T10:00:00Z',
  dernierMotif: null,
  blocages: [],
};
const expertised: TreatmentQueueItem = {
  ...submitted,
  code: 'REC-0008',
  titreFr: 'Infusion de néré',
  statut: 'expertisee',
  dossier: null,
  dernierMotif: 'Cycle à préciser.',
};

const LIST = '/api/traitements/a-decider';
let decisions: { url: string; body: unknown }[];

function mockApi(elements: TreatmentQueueItem[]) {
  decisions = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        decisions.push({ url, body: JSON.parse(String(init.body)) });
        return Response.json({ code: 'REC-0007', statut: 'transmise' });
      }
      if (url !== `${LIST}?limite=10`) return new Response(null, { status: 404 });
      const left = elements.filter((e) => !decisions.some((d) => d.url.includes(`/${e.code}/`)));
      return Response.json({ elements: left, suivant: null, total: left.length });
    }),
  );
}

beforeEach(() => mockApi([submitted, expertised]));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const item = async (code: string) =>
  (await screen.findByRole('heading', { level: 3, name: new RegExp(code) })).closest('li')!;

describe('Liste des traitements qui attendent ma décision', () => {
  it('montre le contenu du traitement : praticien, plantes ordonnées, cycle, sections', async () => {
    render(<TreatmentsPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Traitements à décider' }));
    const first = await item('REC-0007');
    expect(within(first).getByText('Sékou Kourouma (PR-1041)'));
    expect(within(first).getByText('7 jours, 2 prise(s) par jour, pause de 2 jours'));
    expect(within(first).getByText('DS-1041'));
    expect(within(first).getByText('En revue par le Comité'));
    expect(within(first).getByRole('region', { name: 'Mode de préparation' }));
    const second = await item('REC-0008');
    expect(within(second).getByText('Praticien déjà certifié'));
    expect(within(second).getByText('Cycle à préciser.'));
  });

  it('l’action dépend de l’étape : transmettre un soumis, certifier un expertisé', async () => {
    render(<TreatmentsPage />);
    expect(
      within(await item('REC-0007')).getByRole('button', {
        name: 'Transmettre au Comité le traitement REC-0007, Décoction du soir',
      }),
    );
    expect(
      within(await item('REC-0008')).getByRole('button', {
        name: 'Certifier le traitement REC-0008, Infusion de néré',
      }),
    );
  });
});

describe('Critère : chaque transition envoie le statut vu ; un rejet exige un motif', () => {
  it('transmettre : décision « avance » contre le statut vu, puis le traitement quitte la file', async () => {
    render(<TreatmentsPage />);
    fireEvent.click(
      within(await item('REC-0007')).getByRole('button', { name: /^Transmettre au Comité/ }),
    );
    await screen.findByText('Traitement REC-0007 transmis au Comité scientifique.');
    expect(decisions).toEqual([
      {
        url: '/api/traitements/REC-0007/decision',
        body: { statut: 'soumise', decision: 'avance' },
      },
    ]);
    await waitFor(() =>
      expect(screen.queryByRole('heading', { level: 3, name: /REC-0007/ })).toBeNull(),
    );
  });

  it('rejeter sans motif : refusé à l’écran ; avec motif : renvoi envoyé', async () => {
    render(<TreatmentsPage />);
    const row = await item('REC-0007');
    fireEvent.click(within(row).getByRole('button', { name: /^Rejeter/ }));
    fireEvent.click(within(row).getByRole('button', { name: 'Confirmer le rejet' }));
    expect(await within(row).findByText('Indiquez le motif du rejet.'));
    expect(decisions).toEqual([]);
    fireEvent.change(within(row).getByLabelText(/Motif du rejet/), {
      target: { value: 'Partie utilisée du neem à préciser.' },
    });
    fireEvent.click(within(row).getByRole('button', { name: 'Confirmer le rejet' }));
    await screen.findByText('Traitement REC-0007 renvoyé au praticien pour correction.');
    expect(decisions[0]!.body).toEqual({
      statut: 'soumise',
      decision: 'renvoi',
      motif: 'Partie utilisée du neem à préciser.',
    });
  });
});

describe('US-062 : la DG voit pourquoi un traitement ne peut pas encore être certifié', () => {
  it('motifs affichés, bouton « Certifier » absent ; le renvoi reste possible', async () => {
    mockApi([{ ...expertised, blocages: ['plante_en_revue', 'quota'] }]);
    render(<TreatmentsPage />);
    const row = await item('REC-0008');
    expect(
      within(row).getByText(
        'Certification impossible pour l’instant : une plante n’est pas encore validée par le Comité scientifique ; la formule gratuite du praticien est limitée à 3 traitements certifiés.',
      ),
    );
    expect(within(row).queryByRole('button', { name: /^Certifier/ })).toBeNull();
    expect(within(row).getByRole('button', { name: /^Rejeter/ }));
  });

  it('praticien pas encore certifié : certifié avec la publication de son dossier', async () => {
    mockApi([{ ...expertised, dossier: 'DS-1041', blocages: ['certificat'] }]);
    render(<TreatmentsPage />);
    expect(
      within(await item('REC-0008')).getByText(
        /n’a pas de certificat actif\. Il sera certifié à la publication du dossier DS-1041\./,
      ),
    );
  });

  it('refus de l’API au moment de certifier : son motif est affiché', async () => {
    mockApi([expertised]);
    const answer = vi.fn(async (url: string, init?: RequestInit) =>
      init?.method === 'POST'
        ? Response.json(
            {
              error: 'blocked',
              message:
                'Certification impossible : la formule gratuite du praticien est limitée à 3 traitements certifiés.',
            },
            { status: 409 },
          )
        : Response.json({ elements: [expertised], suivant: null, total: 1 }),
    );
    vi.stubGlobal('fetch', answer);
    render(<TreatmentsPage />);
    fireEvent.click(within(await item('REC-0008')).getByRole('button', { name: /^Certifier/ }));
    expect(await screen.findByText(/limitée à 3 traitements certifiés/));
  });
});

describe('US-063 : contre-indications affichées en alerte', () => {
  it('l’administrateur voit les contre-indications du traitement en alerte', async () => {
    render(<TreatmentsPage />);
    const row = await item('REC-0007');
    expect(within(row).getByText('Déconseillé : Grossesse, Enfant de moins de 5 ans.'));
  });
});
