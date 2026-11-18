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
  naturalRegions: [{ id: 2, code: 'MG', name: 'Moyenne Guinée', defaultLanguage: 'pul' }],
  regions: [
    { id: 4, name: 'Labé', parentId: 2, active: true },
    { id: 5, name: 'Mamou', parentId: 2, active: true },
  ],
  prefectures: [
    { id: 4, name: 'Labé', parentId: 4, active: true },
    { id: 5, name: 'Mamou', parentId: 5, active: true },
    { id: 40, name: 'Ancienne', parentId: 4, active: false },
  ],
  subPrefectures: [{ id: 2, name: 'Hafia', parentId: 4, active: true }],
  specialties: [
    { id: 1, code: 'herboristerie', labelFr: 'Herboristerie', labelEn: null, active: true },
  ],
  contraindications: [
    { id: 1, code: 'grossesse', labelFr: 'Grossesse', labelEn: 'Pregnancy', active: true },
    { id: 2, code: 'allaitement', labelFr: 'Allaitement', labelEn: null, active: false },
  ],
};

const PREVIEW = {
  operation: 'fusionner_prefectures',
  object: 'Labé',
  before: 'Labé',
  target: 'Mamou',
  practitioners: 2,
  dossiers: 2,
  subPrefectures: 1,
  others: 0,
  administrators: [
    { id: 3, name: 'Ibrahima Sow', email: 'p@x.gn', role: 'prefectoral', effect: 'suspendu' },
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
        if (url.includes('/redecoupage')) return Response.json(PREVIEW);
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

// US-022 : redécoupage depuis l'onglet Territoires. Règles et déplacements prouvés par la
// base (packages/db/test/redecoupage.test.ts) et l'API (referentials.test.ts).
describe('US-022 : redécoupage administratif', () => {
  async function openForm() {
    render(<ReferentialsPage />);
    fireEvent.click(await screen.findByRole('tab', { name: /Territoires/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Redécouper' }));
    return screen.getByRole('form', { name: 'Redécouper' });
  }
  const options = (select: HTMLElement) =>
    within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);

  it('montre ce qui bouge avant de confirmer, puis applique la fusion', async () => {
    const form = await openForm();
    fireEvent.change(within(form).getByLabelText('Opération'), {
      target: { value: 'fusionner_prefectures' },
    });
    fireEvent.change(within(form).getByLabelText('Préfecture absorbée (devient inactive)'), {
      target: { value: '4' },
    });
    // La préfecture absorbée n'est pas proposée comme préfecture conservée ; une préfecture
    // remplacée n'est jamais proposée
    const target = within(form).getByLabelText('Préfecture conservée');
    expect(options(target)).toEqual(['Choisir…', 'Mamou']);
    fireEvent.change(target, { target: { value: '5' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Voir ce qui bouge' }));

    const preview = await within(form).findByRole('region');
    expect(within(preview).getByText(/Ibrahima Sow/).textContent).toMatch(
      /compte suspendu jusqu’à sa réaffectation/,
    );
    expect(writes).toEqual([
      {
        url: '/api/referentiels/redecoupage/apercu',
        method: 'POST',
        body: { operation: 'fusionner_prefectures', objectId: 4, targetId: 5 },
      },
    ]);
    fireEvent.click(within(preview).getByRole('button', { name: 'Confirmer le redécoupage' }));
    expect(await screen.findByText('Préfecture Labé fusionnée dans Mamou.'));
    expect(writes.map((w) => w.url)).toEqual([
      '/api/referentiels/redecoupage/apercu',
      '/api/referentiels/redecoupage',
    ]);
  });

  it('un changement de choix efface l’aperçu : on confirme toujours ce qu’on a vu', async () => {
    const form = await openForm();
    fireEvent.change(within(form).getByLabelText('Préfecture'), { target: { value: '4' } });
    fireEvent.change(within(form).getByLabelText('Nouvelle région'), { target: { value: '5' } });
    fireEvent.click(within(form).getByRole('button', { name: 'Voir ce qui bouge' }));
    await within(form).findByRole('region');
    fireEvent.change(within(form).getByLabelText('Nouvelle région'), { target: { value: '4' } });
    expect(within(form).queryByRole('region')).toBeNull();
    expect(within(form).getByRole('button', { name: 'Voir ce qui bouge' }));
  });

  it('sans choix complet, rien n’est envoyé', async () => {
    const form = await openForm();
    fireEvent.click(within(form).getByRole('button', { name: 'Voir ce qui bouge' }));
    expect(await within(form).findByText(/Choisissez le territoire/));
    expect(writes).toEqual([]);
  });

  it('une préfecture remplacée reste affichée, marquée comme telle', async () => {
    render(<ReferentialsPage />);
    fireEvent.click(await screen.findByRole('tab', { name: /Territoires/ }));
    expect(screen.getByRole('table', { name: 'Territoires' }).textContent).toMatch(
      /Ancienne \(remplacée\)/,
    );
  });
});
