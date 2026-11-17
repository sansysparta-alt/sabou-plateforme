// US-063 : liste des contre-indications paramétrable par la DG (onglet des Référentiels). API
// simulée ; les règles (code, libellé unique, jamais supprimée, désactivée gardée par les
// traitements qui l'ont) sont prouvées par la base (packages/db/test/contre-indications.test.ts)
// et l'API (apps/api/src/referentials/referentials.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { Referentials } from '@sabou/types';
import { ReferentialsPage } from './ReferentialsPage';

const DATA: Referentials = {
  languages: [],
  naturalRegions: [],
  regions: [],
  prefectures: [],
  subPrefectures: [],
  specialties: [
    { id: 1, code: 'herboristerie', labelFr: 'Herboristerie', labelEn: null, active: true },
  ],
  contraindications: [
    { id: 1, code: 'grossesse', labelFr: 'Grossesse', labelEn: 'Pregnancy', active: true },
    { id: 2, code: 'allaitement', labelFr: 'Allaitement', labelEn: null, active: false },
  ],
};

let writes: { url: string; method: string; body: unknown }[];

beforeEach(() => {
  writes = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method && init.method !== 'GET') {
        writes.push({ url, method: init.method, body: JSON.parse(String(init.body)) });
        return new Response(null, { status: 204 });
      }
      return Response.json(DATA);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openTab() {
  render(<ReferentialsPage />);
  fireEvent.click(await screen.findByRole('tab', { name: /Contre-indications/ }));
  return screen.getByRole('table', { name: 'Contre-indications' });
}

describe('US-063 : contre-indications, liste paramétrable', () => {
  it('liste les contre-indications et leur statut', async () => {
    const table = await openTab();
    expect(within(table).getByText('Grossesse'));
    expect(within(table).getByText('Pregnancy'));
    expect(within(table).getByText('Inactive'));
  });

  it('ajoute une contre-indication', async () => {
    await openTab();
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une contre-indication' }));
    const form = screen.getByRole('form', { name: 'Ajouter une contre-indication' });
    fireEvent.change(within(form).getByLabelText('Libellé en français'), {
      target: { value: 'Insuffisance rénale' },
    });
    fireEvent.change(within(form).getByLabelText('Code'), {
      target: { value: 'insuffisance_renale' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Ajouter la contre-indication' }));
    expect(await screen.findByText('Contre-indication Insuffisance rénale ajoutée.'));
    expect(writes).toEqual([
      {
        url: '/api/referentiels/contre-indications',
        method: 'POST',
        body: { code: 'insuffisance_renale', labelFr: 'Insuffisance rénale', labelEn: null },
      },
    ]);
  });

  it('désactive une contre-indication (jamais de suppression)', async () => {
    const table = await openTab();
    fireEvent.click(within(table).getByRole('button', { name: /^Désactiver.*Grossesse$/ }));
    expect(await screen.findByText('Grossesse désactivée.'));
    expect(writes).toEqual([
      { url: '/api/referentiels/contre-indications/1', method: 'PATCH', body: { active: false } },
    ]);
    expect(screen.queryByRole('button', { name: /Supprimer/ })).toBeNull();
  });
});
