// US-071 : écran des voix des noms. API simulée ; les règles (statuts, droits par langue,
// séparation des tâches, consentement) sont prouvées par la base
// (packages/db/test/voix-des-noms.test.ts) et l'API (apps/api/src/voices/name-voices.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { NameVoices, NameVoicesEntry, NameVoiceTarget } from '@sabou/types';
import { NameVoicesPage } from './NameVoicesPage';

const TARGETS: NameVoiceTarget[] = [
  { objet: 'plante', code: 'PL-002', nom: 'Vernonie', publiees: 1, enCours: 2 },
  { objet: 'maladie', code: 'MA-001', nom: 'Paludisme', publiees: 2, enCours: 0 },
];
const entry = (over: Partial<NameVoicesEntry>): NameVoicesEntry => ({
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

let voices: NameVoices;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  voices = {
    objet: 'plante',
    code: 'PL-002',
    nom: 'Vernonie',
    dg: false,
    voix: [
      entry({
        langue: 'mal',
        langueNom: 'Malinké',
        statut: 'traduit',
        enregistrePar: 'Mohamed Condé',
        peutValider: true,
      }),
      entry({
        langue: 'pul',
        langueNom: 'Pular',
        statut: 'traduit',
        enregistrePar: 'Alpha Barry',
        parMoi: true,
        peutValider: true,
        peutEnregistrer: true,
      }),
      entry({
        langue: 'sou',
        langueNom: 'Soussou',
        statut: 'valide',
        enregistrePar: 'Fatoumata Bangoura',
        consentement: false,
      }),
      entry({ langue: 'gue', langueNom: 'Guerzé' }),
    ],
  };
  fetchMock = vi.fn(async (url: string) =>
    url === '/api/voix-des-noms' ? Response.json(TARGETS) : Response.json(voices),
  );
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const posts = () =>
  (fetchMock.mock.calls as [string, RequestInit | undefined][]).filter(
    ([, init]) => init?.method === 'POST',
  );

async function openPlant() {
  render(<NameVoicesPage />);
  const table = await screen.findByRole('table', { name: 'Fiches du Dictionnaire' });
  fireEvent.click(within(table).getByRole('button', { name: /Voix du nom Vernonie/ }));
  const voicesTable = await screen.findByRole('table', { name: 'Voix du nom, par langue' });
  return (name: string) => within(voicesTable).getByRole('row', { name: new RegExp(name) });
}

describe('Critère : statuts Brouillon → Traduit → Validé → Publié par langue', () => {
  it('chaque langue montre son statut ; une langue sans voix le dit', async () => {
    const row = await openPlant();
    expect(row('Malinké').textContent).toContain('Traduit');
    expect(row('Soussou').textContent).toContain('Validé');
    expect(row('Guerzé').textContent).toContain('Aucune voix');
    expect(within(row('Malinké')).getByLabelText('Voix du nom en Malinké').tagName).toBe('AUDIO');
  });

  it('valider : envoyé à l’API, confirmation', async () => {
    const row = await openPlant();
    fireEvent.click(within(row('Malinké')).getByRole('button', { name: 'Valider en Malinké' }));
    expect(await screen.findByText('Voix en Malinké validée.'));
    const [url, init] = posts()[0]!;
    expect(url).toBe('/api/voix-des-noms/plante/PL-002/mal/statut');
    expect(JSON.parse(String(init!.body))).toEqual({ vers: 'valide', motif: null });
  });

  it('renvoyer : motif exigé, puis envoyé', async () => {
    const row = await openPlant();
    fireEvent.click(within(row('Malinké')).getByRole('button', { name: 'Renvoyer en Malinké' }));
    const motif = screen.getByLabelText('Motif du renvoi');
    expect(document.activeElement).toBe(motif);
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer le renvoi' }));
    expect(motif.getAttribute('aria-invalid')).toBe('true');
    expect(posts()).toEqual([]);
    fireEvent.change(motif, { target: { value: 'Nom mal prononcé' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirmer le renvoi' }));
    expect(await screen.findByText('Voix renvoyée en brouillon avec le motif.'));
    expect(JSON.parse(String(posts()[0]![1]!.body))).toEqual({
      vers: 'brouillon',
      motif: 'Nom mal prononcé',
    });
  });
});

describe('Critère : publication sans consentement impossible ; valideur ≠ enregistreur', () => {
  it('sa propre voix : pas de bouton Valider, même avec le droit de valider', async () => {
    const row = await openPlant();
    expect(within(row('Pular')).queryByRole('button', { name: /^Valider/ })).toBeNull();
  });

  it('DG : Publier sur une voix validée ; le refus de l’API (consentement) est montré', async () => {
    voices = { ...voices, dg: true };
    const row = await openPlant();
    expect(row('Soussou').textContent).toContain('sans consentement de publication');
    fetchMock.mockImplementationOnce(async () =>
      Response.json(
        {
          error: 'consent_missing',
          message:
            'Publication impossible : la personne qui parle n’a pas consenti à la publication de sa voix.',
        },
        { status: 409 },
      ),
    );
    fireEvent.click(within(row('Soussou')).getByRole('button', { name: 'Publier en Soussou' }));
    expect(await screen.findByText(/Publication impossible/));
  });

  it('hors DG : jamais de bouton Publier', async () => {
    const row = await openPlant();
    expect(within(row('Soussou')).queryByRole('button', { name: /Publier/ })).toBeNull();
  });
});

describe('Enregistrer', () => {
  it('fichier et consentement exigés avant tout envoi', async () => {
    const row = await openPlant();
    fireEvent.click(within(row('Pular')).getByRole('button', { name: 'Réenregistrer en Pular' }));
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer la voix' }));
    expect(screen.getByLabelText('Enregistrement').getAttribute('aria-invalid')).toBe('true');
    expect(posts()).toEqual([]);
  });
});
