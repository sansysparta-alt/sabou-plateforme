// US-075 : écran « Résumés et traductions » du préfectoral. API simulée ; les règles (zone,
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
