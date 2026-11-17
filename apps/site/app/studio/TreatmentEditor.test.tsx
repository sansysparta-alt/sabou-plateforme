import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { TreatmentDetail } from '@sabou/types';
import StudioList from './StudioList';
import TreatmentEditor from './TreatmentEditor';

// Studio web (US-060) avec l'API simulée ; les règles sont prouvées par l'API
// (apps/api/src/treatments/studio.test.ts) et la base (packages/db/test/studio-traitement.test.ts).
const REFS = {
  maladies: [
    { code: 'MA-003', nomFr: 'Anémie' },
    { code: 'MA-001', nomFr: 'Paludisme' },
  ],
  plantes: [
    { code: 'PL-001', nomFr: 'Caïlcédrat', nomScientifique: 'Khaya senegalensis', validee: true },
    { code: 'PL-005', nomFr: 'Neem', nomScientifique: 'Azadirachta indica', validee: false },
    {
      code: 'PL-002',
      nomFr: 'Vernonie amère',
      nomScientifique: 'Vernonia amygdalina',
      validee: true,
    },
  ],
  sections: [
    { code: 'preparation', libelleFr: 'Mode de préparation', obligatoire: true },
    { code: 'consommation', libelleFr: 'Modes de consommation', obligatoire: true },
    { code: 'cycle', libelleFr: 'Cycle de traitement', obligatoire: true },
    {
      code: 'effets_indesirables',
      libelleFr: 'Effets indésirables et contre-indications',
      obligatoire: true,
    },
    { code: 'conservation', libelleFr: 'Conservation', obligatoire: false },
  ],
  contreIndications: [
    { code: 'grossesse', libelleFr: 'Grossesse' },
    { code: 'enfant_moins_5_ans', libelleFr: 'Enfant de moins de 5 ans' },
  ],
};
const DRAFT: TreatmentDetail = {
  code: 'REC-0007',
  titreFr: 'Décoction du soir',
  titreEn: null,
  maladie: { code: 'MA-001', nomFr: 'Paludisme' },
  statut: 'brouillon',
  attenteRaison: null,
  cycleDureeJours: 7,
  cyclePrisesParJour: 2,
  cyclePauseJours: null,
  plantes: [
    { plante: 'PL-001', nomFr: 'Caïlcédrat', partie: 'écorce', validee: true },
    { plante: 'PL-002', nomFr: 'Vernonie amère', partie: 'feuilles', validee: true },
  ],
  sections: [],
  contreIndications: [],
  visibilite: null,
  consentementLe: null,
  manques: ['consentement', 'sections'],
  dossier: null,
  dernierMotif: null,
  modifieLe: '2026-11-16T10:00:00.000000Z',
};

type Answer = { status: number; body?: unknown };
let answers: Record<string, Answer[]>;
const calls: { method: string; path: string; body: unknown }[] = [];

beforeEach(() => {
  calls.length = 0;
  answers = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit = {}) => {
      const path = url.replace('/api/praticien/', '');
      const method = init.method ?? 'GET';
      calls.push({ method, path, body: init.body ? JSON.parse(String(init.body)) : undefined });
      const answer = answers[`${method} ${path}`]?.shift() ?? { status: 500 };
      return new Response(answer.body === undefined ? '' : JSON.stringify(answer.body), {
        status: answer.status,
      });
    }),
  );
  vi.spyOn(window.history, 'replaceState').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const ok = (body: unknown): Answer => ({ status: 200, body });
const select = (label: RegExp | string, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
const type = select;
const writes = () => calls.filter((c) => c.method !== 'GET');

async function openNew() {
  answers['GET studio/referentiels'] = [ok(REFS)];
  render(<TreatmentEditor code={null} />);
  await screen.findByRole('heading', { name: 'Nouveau traitement' });
}

describe('Critère : maladie, 1 à n plantes ordonnées avec partie utilisée, cycle', () => {
  it('crée le brouillon : plantes dans l’ordre choisi, cycle en nombres, sections vides omises', async () => {
    await openNew();
    select('Maladie soignée', 'MA-001');
    type('Titre du traitement', 'Décoction du soir');
    select('Plante 1', 'PL-001');
    type('Partie utilisée', 'écorce');
    fireEvent.click(screen.getByRole('button', { name: '+ Ajouter une plante' }));
    select('Plante 2', 'PL-002');
    // La 2e plante passe en premier
    fireEvent.click(screen.getByRole('button', { name: 'Monter Vernonie amère' }));
    type('Durée (jours)', '7');
    type('Prises par jour', '2x');
    type('Texte en français — Mode de préparation', 'Faire bouillir.');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Enfant de moins de 5 ans' }));
    answers['POST traitements'] = [{ status: 201, body: DRAFT }];
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le brouillon' }));
    await screen.findByText('Brouillon REC-0007 enregistré.');
    expect(writes()).toEqual([
      {
        method: 'POST',
        path: 'traitements',
        body: {
          maladie: 'MA-001',
          titreFr: 'Décoction du soir',
          titreEn: '',
          cycleDureeJours: 7,
          cyclePrisesParJour: 2,
          cyclePauseJours: null,
          plantes: [
            { plante: 'PL-002', partie: '' },
            { plante: 'PL-001', partie: 'écorce' },
          ],
          sections: [{ type: 'preparation', texteFr: 'Faire bouillir.', texteEn: '' }],
          contreIndications: ['enfant_moins_5_ans'],
          consentement: false,
          visibilite: null,
        },
      },
    ]);
    expect(window.history.replaceState).toHaveBeenCalledWith(null, '', '?code=REC-0007');
  });

  it('une plante déjà choisie n’est plus proposée ; une plante en revue est signalée', async () => {
    await openNew();
    select('Plante 1', 'PL-005');
    expect(screen.getByText(/En revue par le Comité/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '+ Ajouter une plante' }));
    const second = screen.getByLabelText('Plante 2');
    expect(within(second).queryByRole('option', { name: /Neem/ })).toBeNull();
  });

  it('sans maladie ni titre : message, aucun appel', async () => {
    await openNew();
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le brouillon' }));
    expect((await screen.findByRole('alert')).textContent).toContain('Choisissez la maladie');
    expect(writes()).toEqual([]);
  });
});

describe('Critère : 4 sections obligatoires + conservation facultative, français et anglais', () => {
  it('affiche les 5 sections, la conservation marquée facultative, l’anglais repliable', async () => {
    await openNew();
    expect(screen.getAllByLabelText(/^Texte en français — /)).toHaveLength(5);
    expect(screen.getByText('Conservation (facultatif)')).toBeTruthy();
    expect(screen.getAllByText('Texte en anglais (facultatif)')).toHaveLength(5);
  });
});

describe('Critère : consentement et niveau de visibilité obligatoires avant soumission', () => {
  it('visibilité inactive sans consentement ; consentement sans niveau : message, aucun appel', async () => {
    await openNew();
    expect(screen.getByRole('radio', { name: /Publique/ }).matches(':disabled')).toBe(true);
    select('Maladie soignée', 'MA-001');
    type('Titre du traitement', 'Essai');
    fireEvent.click(screen.getByRole('checkbox', { name: /J’accepte/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le brouillon' }));
    expect((await screen.findByRole('alert')).textContent).toContain('niveau de visibilité');
    expect(writes()).toEqual([]);
  });

  it('soumettre un brouillon incomplet : enregistre, puis dit ce qui manque, sans soumettre', async () => {
    answers['GET studio/referentiels'] = [ok(REFS)];
    answers['GET traitements/REC-0007'] = [ok(DRAFT)];
    render(<TreatmentEditor code="REC-0007" />);
    await screen.findByRole('heading', { name: 'Décoction du soir' });
    answers['PUT traitements/REC-0007'] = [ok(DRAFT)];
    fireEvent.click(screen.getByRole('button', { name: 'Soumettre pour certification' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('votre consentement et le niveau de visibilité');
    expect(alert.textContent).toContain('les 4 sections obligatoires');
    expect(writes().map((c) => `${c.method} ${c.path}`)).toEqual(['PUT traitements/REC-0007']);
    expect(writes()[0]!.body).toMatchObject({ vueLe: DRAFT.modifieLe });
  });

  it('soumission complète : traitement soumis, joint au dossier, plus modifiable', async () => {
    const complete = {
      ...DRAFT,
      manques: [],
      consentementLe: DRAFT.modifieLe,
      visibilite: 'publique',
    };
    answers['GET studio/referentiels'] = [ok(REFS)];
    answers['GET traitements/REC-0007'] = [ok(complete)];
    answers['PUT traitements/REC-0007'] = [ok(complete)];
    answers['POST traitements/REC-0007/soumission'] = [
      ok({ ...complete, statut: 'soumise', dossier: 'DS-1041' }),
    ];
    render(<TreatmentEditor code="REC-0007" />);
    await screen.findByRole('heading', { name: 'Décoction du soir' });
    fireEvent.click(screen.getByRole('button', { name: 'Soumettre pour certification' }));
    await screen.findByText(/joint à votre dossier de certification DS-1041/);
    expect(screen.queryByRole('button', { name: /Enregistrer/ })).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1 })),
    );
  });

  it('refus de l’API (dossier à ouvrir) : message de l’API affiché', async () => {
    const complete = { ...DRAFT, manques: [] };
    answers['GET studio/referentiels'] = [ok(REFS)];
    answers['GET traitements/REC-0007'] = [ok(complete)];
    answers['PUT traitements/REC-0007'] = [ok(complete)];
    answers['POST traitements/REC-0007/soumission'] = [
      {
        status: 409,
        body: { error: 'no_dossier', message: 'Ouvrez votre dossier de certification.' },
      },
    ];
    render(<TreatmentEditor code="REC-0007" />);
    await screen.findByRole('heading', { name: 'Décoction du soir' });
    fireEvent.click(screen.getByRole('button', { name: 'Soumettre pour certification' }));
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Ouvrez votre dossier de certification.',
    );
  });
});

describe('Critère : la raison de l’attente est lue sur le traitement (US-046)', () => {
  it('liste : état de chaque traitement et raison d’un traitement resté « expertisé »', async () => {
    answers['GET traitements'] = [
      ok([
        {
          code: 'REC-0004',
          titreFr: 'Poudre de moringa',
          maladie: { code: 'MA-003', nomFr: 'Anémie' },
          statut: 'expertisee',
          attenteRaison: 'quota',
          modifieLe: '2026-11-16T10:00:00.000000Z',
        },
      ]),
    ];
    render(<StudioList />);
    await screen.findByRole('link', { name: 'Poudre de moringa' });
    expect(screen.getByText('Expertisé, en attente de certification')).toBeTruthy();
    expect(screen.getByText(/limitée à 3 traitements certifiés/)).toBeTruthy();
  });

  it('détail d’un traitement en attente pour contenu : lecture seule et raison', async () => {
    answers['GET studio/referentiels'] = [ok(REFS)];
    answers['GET traitements/REC-0007'] = [
      ok({ ...DRAFT, statut: 'expertisee', attenteRaison: 'contenu', manques: [] }),
    ];
    render(<TreatmentEditor code="REC-0007" />);
    await screen.findByText(/n’est pas encore validée par le Comité scientifique/);
    expect(screen.queryByRole('button', { name: /Soumettre/ })).toBeNull();
  });
});

describe('Accès', () => {
  it('non connecté : lien de connexion qui revient au Studio', async () => {
    answers['GET traitements'] = [{ status: 401 }];
    render(<StudioList />);
    const link = await screen.findByRole('link', { name: 'Se connecter' });
    expect(link.getAttribute('href')).toBe('/auth/citoyen/login?returnTo=%2Fstudio');
  });

  it('citoyen : Studio réservé aux praticiens', async () => {
    answers['GET traitements'] = [{ status: 403 }];
    render(<StudioList />);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Le Studio est réservé aux praticiens.',
    );
  });
});

describe('US-063 : contre-indications structurées', () => {
  it('traitement soumis : contre-indications affichées en alerte', async () => {
    answers['GET studio/referentiels'] = [ok(REFS)];
    answers['GET traitements/REC-0007'] = [
      ok({
        ...DRAFT,
        statut: 'soumise',
        manques: [],
        contreIndications: [
          { code: 'grossesse', libelleFr: 'Grossesse' },
          { code: 'enfant_moins_5_ans', libelleFr: 'Enfant de moins de 5 ans' },
        ],
      }),
    ];
    render(<TreatmentEditor code="REC-0007" />);
    const alert = await screen.findByRole('note', { name: 'Contre-indications' });
    expect(alert.textContent).toBe('Déconseillé : Grossesse, Enfant de moins de 5 ans.');
  });

  it('une contre-indication désactivée depuis reste cochée sur le traitement qui l’a', async () => {
    answers['GET studio/referentiels'] = [ok(REFS)];
    answers['GET traitements/REC-0007'] = [
      ok({ ...DRAFT, contreIndications: [{ code: 'allaitement', libelleFr: 'Allaitement' }] }),
    ];
    render(<TreatmentEditor code="REC-0007" />);
    const kept = await screen.findByRole('checkbox', { name: 'Allaitement' });
    expect(kept).toHaveProperty('checked', true);
  });
});
