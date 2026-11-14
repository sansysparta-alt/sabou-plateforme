// US-050 : écrans des fiches plantes (DG et Comité). API simulée ; les règles (rôle, nom
// scientifique unique, photo principale) sont prouvées par la base
// (packages/db/test/fiche-plante.test.ts) et l'API (apps/api/src/plants/plants.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { PlantDetail, PlantSummary } from '@sabou/types';
import { PlantPage } from './PlantPage';
import { PlantsPage } from './PlantsPage';

const LIST: PlantSummary[] = [
  {
    code: 'PL-001',
    nomScientifique: 'Khaya senegalensis',
    nomFr: 'Caïlcédrat',
    famille: 'Meliaceae',
    statut: 'validee',
    image: 1,
  },
  {
    code: 'PL-005',
    nomScientifique: 'Azadirachta indica',
    nomFr: 'Neem',
    famille: 'Meliaceae',
    statut: 'en_revue',
    image: null,
  },
];

const PLANT: PlantDetail = {
  code: 'PL-001',
  nomScientifique: 'Khaya senegalensis',
  famille: 'Meliaceae',
  nomFr: 'Caïlcédrat',
  nomEn: 'African mahogany',
  statut: 'validee',
  modifieLe: '2026-11-15T10:00:00.123456Z',
  images: [
    { id: 1, alt: 'Écorce et feuilles', altEn: null, type: 'ecorce', principale: true },
    { id: 6, alt: 'Arbre entier', altEn: 'Tree', type: 'plante_entiere', principale: false },
  ],
};

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
let handler: Handler;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  handler = (url) =>
    url.startsWith('/api/plantes/PL-001') ? Response.json(PLANT) : Response.json(LIST);
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  vi.stubGlobal('fetch', fetchMock);
  window.history.replaceState(null, '', '/plantes');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const lastCall = () => fetchMock.mock.calls.at(-1) as [string, RequestInit];

describe('Liste des fiches plantes', () => {
  it('montre chaque fiche : nom, nom scientifique en italique, famille, statut, photo', async () => {
    render(<PlantsPage />);
    const table = await screen.findByRole('table', { name: 'Toutes les fiches' });
    const neem = within(table).getByRole('row', { name: /Neem/ });
    expect(within(neem).getByRole('link').getAttribute('href')).toBe('/plantes/PL-005');
    expect(neem.textContent).toContain('En revue');
    expect(neem.textContent).toContain('Non');
    expect(within(table).getByText('Khaya senegalensis').tagName).toBe('I');
  });

  it('recherche : la saisie part à l’API, la légende du tableau la reprend', async () => {
    render(<PlantsPage />);
    await screen.findByRole('table');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Rechercher une plante' }), {
      target: { value: ' néré ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Rechercher' }));
    expect(await screen.findByRole('table', { name: 'Fiches trouvées pour « néré »' }));
    expect(lastCall()[0]).toBe('/api/plantes?q=n%C3%A9r%C3%A9');
  });

  it('critère : nom scientifique, famille et nom français obligatoires, anglais facultatif', async () => {
    render(<PlantsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Nouvelle fiche plante' }));
    for (const label of ['Nom scientifique', 'Famille', 'Nom français']) {
      expect((screen.getByLabelText(label, { exact: false }) as HTMLInputElement).required).toBe(
        true,
      );
    }
    expect((screen.getByLabelText('Nom anglais (facultatif)') as HTMLInputElement).required).toBe(
      false,
    );
  });

  it('nom scientifique déjà pris : le refus de l’API est montré tel quel', async () => {
    handler = (url, init) =>
      init?.method === 'POST'
        ? Response.json(
            { message: 'Ce nom scientifique est déjà celui de la fiche PL-001.' },
            { status: 409 },
          )
        : Response.json(LIST);
    render(<PlantsPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Nouvelle fiche plante' }));
    fireEvent.change(screen.getByLabelText('Nom scientifique', { exact: false }), {
      target: { value: 'Khaya senegalensis' },
    });
    fireEvent.change(screen.getByLabelText('Famille', { exact: false }), {
      target: { value: 'Meliaceae' },
    });
    fireEvent.change(screen.getByLabelText('Nom français', { exact: false }), {
      target: { value: 'Caïl' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Créer la fiche' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'déjà celui de la fiche PL-001',
    );
    expect(JSON.parse(lastCall()[1].body as string)).toEqual({
      nomScientifique: 'Khaya senegalensis',
      famille: 'Meliaceae',
      nomFr: 'Caïl',
      nomEn: '',
    });
  });
});

describe('Fiche plante', () => {
  it('modifier : la date de dernière lecture part avec la fiche', async () => {
    render(<PlantPage code="PL-001" />);
    const name = await screen.findByLabelText('Nom français', { exact: false });
    fireEvent.change(name, { target: { value: 'Caïlcédrat du Sénégal' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer la fiche' }));
    expect(await screen.findByText('Fiche enregistrée.'));
    const [url, init] = lastCall();
    expect([url, init.method]).toEqual(['/api/plantes/PL-001', 'PATCH']);
    expect(JSON.parse(init.body as string)).toMatchObject({
      nomFr: 'Caïlcédrat du Sénégal',
      vueLe: '2026-11-15T10:00:00.123456Z',
    });
  });

  it('critère : une seule photo principale, signalée ; chaque photo a son texte alternatif', async () => {
    render(<PlantPage code="PL-001" />);
    const photos = await screen.findAllByRole('img');
    expect(photos.map((img) => img.getAttribute('alt'))).toEqual([
      'Écorce et feuilles',
      'Arbre entier',
    ]);
    expect(photos[0]!.getAttribute('src')).toBe('/api/plantes/PL-001/images/1');
    expect(
      screen.getAllByText('Photo principale', { selector: '.ui-badge, .ui-badge *' }),
    ).toHaveLength(1);
    // La principale ne propose pas de devenir principale ; l'autre, si
    expect(screen.getAllByRole('button', { name: /Choisir comme photo principale/ })).toHaveLength(
      1,
    );
  });

  it('choisir une autre photo principale : elle part marquée principale', async () => {
    render(<PlantPage code="PL-001" />);
    fireEvent.click(
      await screen.findByRole('button', { name: 'Choisir comme photo principale : Arbre entier' }),
    );
    expect(await screen.findByText('Photo principale changée.'));
    const [url, init] = lastCall();
    expect([url, init.method]).toEqual(['/api/plantes/PL-001/images/6', 'PATCH']);
    expect(JSON.parse(init.body as string)).toEqual({
      alt: 'Arbre entier',
      altEn: 'Tree',
      type: 'plante_entiere',
      principale: true,
    });
  });

  it('ajouter une photo : texte alternatif obligatoire ; le fichier part avec sa description', async () => {
    render(<PlantPage code="PL-001" />);
    const form = (await screen.findByRole('heading', { name: 'Ajouter une photo' })).closest(
      'form',
    )!;
    const alt = within(form).getByLabelText('Texte alternatif', {
      exact: false,
    }) as HTMLInputElement;
    expect(alt.required).toBe(true);
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'p.jpg', { type: 'image/jpeg' });
    fireEvent.change(within(form).getByLabelText('Photo', { exact: false }), {
      target: { files: [file] },
    });
    fireEvent.change(alt, { target: { value: 'Feuilles' } });
    fireEvent.change(within(form).getByLabelText('Ce que montre la photo'), {
      target: { value: 'feuille' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Ajouter la photo' }));
    expect(await screen.findByText('Photo ajoutée.'));
    const [url, init] = lastCall();
    expect(url).toBe('/api/plantes/PL-001/images?alt=Feuilles&type=feuille&principale=false');
    expect(init.body).toBe(file);
  });

  it('fiche introuvable : message, et lien de retour', async () => {
    handler = () => Response.json({ message: 'Fiche plante introuvable.' }, { status: 404 });
    render(<PlantPage code="PL-999" />);
    expect((await screen.findByRole('alert')).textContent).toContain('Fiche plante introuvable.');
    expect(screen.getByRole('link', { name: 'Retour aux fiches plantes' }));
  });
});
