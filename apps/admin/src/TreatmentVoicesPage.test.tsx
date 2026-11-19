// US-075 et US-072 : écrans « Résumés et traductions » du préfectoral et « Atelier
// linguistique » du régional ; US-073 : « Contrôle des effets indésirables » du Comité. API simulée ; les règles (zone,
// statut du traitement, droits par langue, historique) sont prouvées par la base
// (packages/db/test/resume-voix-locale.test.ts) et l'API
// (apps/api/src/voices/treatment-voices.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type {
  TreatmentVoiceEntry,
  TreatmentVoices,
  TreatmentVoiceSection,
  TreatmentVoiceTarget,
} from '@sabou/types';
import { openDossier } from './test-dossier';
import { TreatmentVoicesPage } from './TreatmentVoicesPage';

const TARGETS: TreatmentVoiceTarget[] = [
  {
    code: 'REC-0007',
    titre: 'Infusion de Néré',
    maladie: 'Paludisme',
    praticien: 'Mamadou Diallo',
    prefecture: 'Labé',
    statut: 'soumise',
    brouillons: 1,
    traduites: 0,
    validees: 0,
    publiees: 0,
    aValider: 0,
    aControler: 0,
  },
];
const entry = (over: Partial<TreatmentVoiceEntry>): TreatmentVoiceEntry => ({
  langue: 'pul',
  langueNom: 'Pular',
  statut: null,
  enregistrePar: null,
  parMoi: false,
  motif: null,
  consentement: true,
  secours: true,
  controle: false,
  peutEnregistrer: false,
  peutTraduire: false,
  peutValider: false,
  ...over,
});
const section = (over: Partial<TreatmentVoiceSection>): TreatmentVoiceSection => ({
  type: 'preparation',
  libelle: 'Mode de préparation',
  texteFr: 'Faire bouillir les gousses.',
  texteEn: null,
  revisions: [],
  voix: [],
  ...over,
});

let voices: TreatmentVoices;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  voices = {
    code: 'REC-0007',
    titre: 'Infusion de Néré',
    statut: 'soumise',
    praticien: 'Mamadou Diallo',
    peutReviser: true,
    prefectoral: true,
    comite: false,
    sections: [
      section({
        voix: [
          entry({
            statut: 'brouillon',
            enregistrePar: 'Ibrahima Sow',
            parMoi: true,
            peutEnregistrer: true,
          }),
          entry({ langue: 'mal', langueNom: 'Malinké' }),
          entry({ langue: 'fr', langueNom: 'Français', peutEnregistrer: true }),
        ],
        revisions: [
          {
            avant: 'Texte du praticien',
            apres: 'Faire bouillir les gousses.',
            par: 'Ibrahima Sow',
            le: '2026-11-19T08:00:00.000Z',
          },
        ],
      }),
    ],
  };
  fetchMock = vi.fn(async (url: string) =>
    url === '/api/voix-des-traitements' ? Response.json(TARGETS) : Response.json(voices),
  );
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const openTreatment = async () => {
  render(<TreatmentVoicesPage />);
  const row = await openDossier(/REC-0007/);
  await within(row).findByRole('heading', { name: 'Mode de préparation' });
  return row;
};
const bodies = (method: string) =>
  fetchMock.mock.calls
    .filter(([, init]) => (init as RequestInit | undefined)?.method === method)
    .map(([url, init]) => [url, JSON.parse((init as RequestInit).body as string)]);

describe('Liste des traitements de la zone', () => {
  it('une ligne par traitement ; le détail n’est demandé qu’à l’ouverture (3G)', async () => {
    render(<TreatmentVoicesPage />);
    await screen.findByRole('heading', { level: 3, name: /REC-0007 · Infusion de Néré/ });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await openDossier(/REC-0007/);
    expect(fetchMock).toHaveBeenLastCalledWith(
      '/api/voix-des-traitements/REC-0007',
      expect.anything(),
    );
  });
});

describe('Critère : texte français par section', () => {
  it('le texte et l’historique des révisions sont affichés', async () => {
    const row = await openTreatment();
    expect(within(row).getByText('Faire bouillir les gousses.')).toBeTruthy();
    expect(within(row).getByText(/Texte précédent : « Texte du praticien »/)).toBeTruthy();
  });

  it('réviser : texte français obligatoire, puis envoi à l’API', async () => {
    const row = await openTreatment();
    fireEvent.click(within(row).getByRole('button', { name: /Réviser le texte français/ }));
    const fr = within(row).getByLabelText(/Texte français/);
    fireEvent.change(fr, { target: { value: '   ' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Enregistrer la révision' }));
    expect(await within(row).findByText('Saisissez le texte français de la section.')).toBeTruthy();
    expect(bodies('PATCH')).toEqual([]);
    fireEvent.change(fr, { target: { value: ' Résumé du préfectoral ' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Enregistrer la révision' }));
    expect(await within(row).findByText(/Texte révisé/)).toBeTruthy();
    expect(bodies('PATCH')).toEqual([
      [
        '/api/voix-des-traitements/REC-0007/preparation',
        { texteFr: 'Résumé du préfectoral', texteEn: null },
      ],
    ]);
  });

  it('traitement plus soumis : pas de révision, la raison est dite', async () => {
    voices = { ...voices, statut: 'transmise', peutReviser: false };
    const row = await openTreatment();
    expect(within(row).queryByRole('button', { name: /Réviser le texte français/ })).toBeNull();
    expect(
      within(row).getByText(/se révise seulement quand le traitement est soumis/),
    ).toBeTruthy();
  });
});

describe('Critère : voix locale par section, envoi au régional', () => {
  it('langues montrées : voix existantes et langues où j’enregistre ; pas le malinké', async () => {
    const row = await openTreatment();
    const list = within(row).getByRole('list', { name: 'Voix : Mode de préparation' });
    expect(within(list).getByText('Pular')).toBeTruthy();
    expect(within(list).getByText('Français')).toBeTruthy();
    expect(within(list).queryByText('Malinké')).toBeNull();
    expect(within(list).getByRole('button', { name: 'Réenregistrer en Pular' })).toBeTruthy();
    expect(within(list).getByRole('button', { name: 'Enregistrer en Français' })).toBeTruthy();
  });

  it('envoyer au régional : statut « traduit » demandé à l’API, message dit', async () => {
    const row = await openTreatment();
    fireEvent.click(
      within(row).getByRole('button', { name: 'Envoyer au régional la voix en Pular' }),
    );
    expect(await within(row).findByText(/envoyée à l’administrateur régional/)).toBeTruthy();
    expect(bodies('POST')).toEqual([
      [
        '/api/voix-des-traitements/REC-0007/preparation/pul/statut',
        { vers: 'traduit', motif: null },
      ],
    ]);
  });

  it('enregistrer : fichier et consentement obligatoires', async () => {
    const row = await openTreatment();
    fireEvent.click(within(row).getByRole('button', { name: 'Enregistrer en Français' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Enregistrer la voix' }));
    expect(await within(row).findByText('Choisissez l’enregistrement.')).toBeTruthy();
    expect(bodies('POST')).toEqual([]);
  });

  it('un autre profil (sans droit dans la préfecture) ne voit aucun geste', async () => {
    voices = { ...voices, prefectoral: false, peutReviser: false };
    const row = await openTreatment();
    expect(within(row).queryByRole('button', { name: /Enregistrer|Envoyer|Réviser/ })).toBeNull();
  });
});

describe('Atelier linguistique (US-072)', () => {
  const workshop = () => {
    voices = {
      ...voices,
      prefectoral: false,
      peutReviser: false,
      sections: [
        section({
          voix: [
            entry({ statut: 'traduit', enregistrePar: 'Ibrahima Sow', peutValider: true }),
            entry({
              langue: 'fr',
              langueNom: 'Français',
              statut: 'traduit',
              enregistrePar: 'Ibrahima Sow',
            }),
            entry({ langue: 'mal', langueNom: 'Malinké', peutValider: true }),
          ],
        }),
      ],
    };
  };
  const openWorkshop = async () => {
    render(<TreatmentVoicesPage mode="atelier" />);
    const row = await openDossier(/REC-0007/);
    await within(row).findByRole('heading', { name: 'Mode de préparation' });
    return row;
  };

  it('critère : écoute de la voix et texte français côte à côte', async () => {
    workshop();
    const row = await openWorkshop();
    const split = row.querySelector('.ui-split')!;
    expect(within(split as HTMLElement).getByText('Faire bouillir les gousses.')).toBeTruthy();
    expect(within(split as HTMLElement).getByLabelText(/voix en Pular/)).toBeTruthy();
  });

  it('critère : seules les voix de mes langues apparaissent (pas le français non validable)', async () => {
    workshop();
    const row = await openWorkshop();
    const list = within(row).getByRole('list', { name: 'Voix : Mode de préparation' });
    expect(within(list).getByText('Pular')).toBeTruthy();
    expect(within(list).queryByText('Français')).toBeNull();
    expect(within(list).queryByText('Malinké')).toBeNull();
    expect(within(row).queryByRole('button', { name: /Enregistrer|Envoyer|Réviser/ })).toBeNull();
  });

  it('critère : validation, ou renvoi avec motif obligatoire', async () => {
    workshop();
    const row = await openWorkshop();
    fireEvent.click(within(row).getByRole('button', { name: 'Valider la voix en Pular' }));
    expect(await within(row).findByText('Voix en Pular validée.')).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Renvoyer la voix en Pular' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Confirmer le renvoi' }));
    expect(await within(row).findByText('Saisissez le motif du renvoi.')).toBeTruthy();
    fireEvent.change(within(row).getByLabelText(/Motif du renvoi/), {
      target: { value: 'Mot mal prononcé' },
    });
    fireEvent.click(within(row).getByRole('button', { name: 'Confirmer le renvoi' }));
    expect(await within(row).findByText(/renvoyée en brouillon/)).toBeTruthy();
    expect(bodies('POST')).toEqual([
      [
        '/api/voix-des-traitements/REC-0007/preparation/pul/statut',
        { vers: 'valide', motif: null },
      ],
      [
        '/api/voix-des-traitements/REC-0007/preparation/pul/statut',
        { vers: 'brouillon', motif: 'Mot mal prononcé' },
      ],
    ]);
  });

  it('une voix que j’ai enregistrée : pas de bouton Valider (séparation des tâches)', async () => {
    workshop();
    voices.sections[0]!.voix[0] = { ...voices.sections[0]!.voix[0]!, parMoi: true };
    const row = await openWorkshop();
    expect(within(row).queryByRole('button', { name: /Valider/ })).toBeNull();
  });
});

describe('Contrôle des effets indésirables (US-073)', () => {
  const committee = (controle = false) => {
    voices = {
      ...voices,
      prefectoral: false,
      peutReviser: false,
      comite: true,
      sections: [
        section({ voix: [entry({ statut: 'valide', enregistrePar: 'Ibrahima Sow' })] }),
        section({
          type: 'effets_indesirables',
          libelle: 'Effets indésirables et contre-indications',
          texteFr: 'Pas pendant la grossesse.',
          voix: [
            entry({ statut: 'valide', enregistrePar: 'Ibrahima Sow', controle }),
            entry({ langue: 'mal', langueNom: 'Malinké', statut: 'traduit', enregistrePar: 'X' }),
          ],
        }),
      ],
    };
  };
  const openControl = async () => {
    render(<TreatmentVoicesPage mode="controle" />);
    const row = await openDossier(/REC-0007/);
    await within(row).findByRole('heading', { name: 'Effets indésirables et contre-indications' });
    return row;
  };

  it('seule la section des effets indésirables, chaque langue à part', async () => {
    committee();
    const row = await openControl();
    expect(within(row).queryByRole('heading', { name: 'Mode de préparation' })).toBeNull();
    expect(within(row).getByText(/contrôle du Comité attendu/)).toBeTruthy();
    // Voix seulement envoyée (pas validée) : rien à contrôler
    expect(within(row).getAllByRole('button', { name: /Contrôler/ })).toHaveLength(1);
  });

  it('critère : contrôler la voix, ou la renvoyer avec un motif', async () => {
    committee();
    const row = await openControl();
    fireEvent.click(within(row).getByRole('button', { name: 'Contrôler la voix en Pular' }));
    expect(await within(row).findByText(/contrôlée : elle peut être publiée/)).toBeTruthy();
    fireEvent.click(within(row).getByRole('button', { name: 'Renvoyer la voix en Pular' }));
    fireEvent.change(within(row).getByLabelText(/Motif du renvoi/), {
      target: { value: 'Contre-indication omise' },
    });
    fireEvent.click(within(row).getByRole('button', { name: 'Confirmer le renvoi' }));
    expect(await within(row).findByText(/motif du Comité/)).toBeTruthy();
    expect(bodies('POST')).toEqual([
      [
        '/api/voix-des-traitements/REC-0007/effets_indesirables/pul/statut',
        { vers: 'controle', motif: null },
      ],
      [
        '/api/voix-des-traitements/REC-0007/effets_indesirables/pul/statut',
        { vers: 'controle_refuse', motif: 'Contre-indication omise' },
      ],
    ]);
  });

  it('voix déjà contrôlée : plus de geste, l’état est dit', async () => {
    committee(true);
    const row = await openControl();
    expect(within(row).getByText(/contrôlée par le Comité/)).toBeTruthy();
    expect(within(row).queryByRole('button', { name: /Contrôler/ })).toBeNull();
  });
});
