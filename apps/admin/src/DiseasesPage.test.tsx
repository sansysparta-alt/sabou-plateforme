// US-052 : écrans des fiches maladies (DG et Comité). API simulée ; les règles (rôle, nom
// français unique, recherche sans accents des dénominations) sont prouvées par la base
// (packages/db/test/fiches-maladies.test.ts) et l'API (apps/api/src/diseases/diseases.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { DiseaseDetail, DiseaseSummary } from '@sabou/types';
import { DiseasePage, DiseasesPage } from './DiseasesPage';

const LIST: DiseaseSummary[] = [
  {
    code: 'MA-001',
    nomFr: 'Paludisme',
    nomEn: 'Malaria',
    denominations: ['Fièvre palustre', 'Malaria'],
  },
];
const DISEASE: DiseaseDetail = {
  code: 'MA-002',
  nomFr: 'Hypertension',
  nomEn: 'Hypertension',
  symptomesFr: 'Souvent sans symptôme.',
  symptomesEn: null,
  denominations: [{ langue: 'fr', denomination: 'Tension' }],
  modifieLe: '2026-11-15T10:00:00.123456Z',
};

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) =>
    url.startsWith('/api/maladies/') || init?.method === 'POST'
      ? Response.json(DISEASE)
      : Response.json(LIST),
  );
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const lastCall = () => fetchMock.mock.calls.at(-1) as [string, RequestInit];

describe('Fiches maladies', () => {
  it('la liste montre les dénominations ; la recherche part à l’API sans bouton', async () => {
    render(<DiseasesPage />);
    const row = within(await screen.findByRole('table')).getByRole('row', { name: /Paludisme/ });
    expect(row.textContent).toContain('Fièvre palustre, Malaria');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Rechercher une maladie' }), {
      target: { value: 'fievre' },
    });
    expect(await screen.findByRole('table', { name: 'Fiches trouvées pour « fievre »' }));
    await waitFor(() => expect(lastCall()[0]).toBe('/api/maladies?q=fievre'));
  });

  it('critère : nom français obligatoire ; dénominations en français ou en anglais seulement', async () => {
    vi.stubGlobal('location', { ...window.location, assign: vi.fn() });
    render(<DiseasesPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Nouvelle fiche maladie' }));
    expect(
      (screen.getByLabelText('Nom français', { exact: false }) as HTMLInputElement).required,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText('Nom français', { exact: false }), {
      target: { value: 'Fièvre typhoïde' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une dénomination' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une dénomination' }));
    const language = screen.getByLabelText('Langue de la dénomination 1') as HTMLSelectElement;
    expect([...language.options].map((o) => o.value)).toEqual(['fr', 'en']);
    fireEvent.change(screen.getByLabelText('Dénomination 1'), { target: { value: 'Typhoïde' } });
    fireEvent.click(screen.getByRole('button', { name: 'Créer la fiche' }));
    await vi.waitFor(() => expect(lastCall()[1].method).toBe('POST'));
    // La dénomination laissée vide n'est pas envoyée
    expect(JSON.parse(lastCall()[1].body as string).denominations).toEqual([
      { langue: 'fr', denomination: 'Typhoïde' },
    ]);
  });

  it('modifier une fiche : dénominations et date de lecture envoyées', async () => {
    render(<DiseasePage code="MA-002" />);
    fireEvent.change(await screen.findByLabelText('Dénomination 1'), {
      target: { value: 'Haute tension' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer la fiche' }));
    expect(await screen.findByText('Fiche enregistrée.'));
    const [url, init] = lastCall();
    expect([url, init.method]).toEqual(['/api/maladies/MA-002', 'PATCH']);
    expect(JSON.parse(init.body as string)).toMatchObject({
      denominations: [{ langue: 'fr', denomination: 'Haute tension' }],
      vueLe: DISEASE.modifieLe,
    });
  });
});
