// US-050 : écrans des fiches plantes (DG et Comité). API simulée ; les règles (rôle, nom
// scientifique unique, photo principale) sont prouvées par la base
// (packages/db/test/fiche-plante.test.ts) et l'API (apps/api/src/plants/plants.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  validation: { par: 'Aboubacar Diakité', le: '2026-11-15T09:00:00Z' },
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

  it('recherche : la saisie part à l’API une fois la frappe arrêtée, sans bouton', async () => {
    render(<PlantsPage />);
    await screen.findByRole('table');
    const box = screen.getByRole('searchbox', { name: 'Rechercher une plante' });
    fireEvent.change(box, { target: { value: ' né' } });
    fireEvent.change(box, { target: { value: ' néré ' } });
    expect(await screen.findByRole('table', { name: 'Fiches trouvées pour « néré »' }));
    // Une seule recherche envoyée : la frappe intermédiaire n'est pas partie
    await waitFor(() =>
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        '/api/plantes',
        '/api/plantes?q=n%C3%A9r%C3%A9',
      ]),
    );
  });

  it('gabarit de liste : chiffres clés, filtre de statut avec son nombre (US-019b)', async () => {
    render(<PlantsPage />);
    const stats = await screen.findByRole('group', { name: 'Chiffres des fiches' });
    expect(stats.textContent).toMatch(/Fiches\s*2/);
    expect(stats.textContent).toMatch(/En revue\s*1/);
    expect(stats.textContent).toMatch(/Sans photo principale\s*1/);
    fireEvent.click(screen.getByRole('button', { name: 'En revue (1)' }));
    const table = screen.getByRole('table');
    expect(within(table).queryByRole('row', { name: /Caïlcédrat/ })).toBeNull();
    expect(within(table).getByRole('row', { name: /Neem/ }));
  });

  it('formulaire de création ouvert à la demande depuis l’en-tête, refermé par Annuler', async () => {
    render(<PlantsPage />);
    const open = await screen.findByRole('button', { name: 'Nouvelle fiche plante' });
    expect(screen.queryByLabelText('Famille', { exact: false })).toBeNull();
    fireEvent.click(open);
    expect(open.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(
      screen.getByLabelText('Nom scientifique', { exact: false }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByLabelText('Famille', { exact: false })).toBeNull();
  });

  it('au-delà de 10 fiches : pagination commune, retour à la page 1 au changement de filtre', async () => {
    const many: PlantSummary[] = Array.from({ length: 12 }, (_, i) => ({
      ...LIST[1]!,
      code: `PL-${String(100 + i)}`,
      nomFr: `Plante ${100 + i}`,
    }));
    handler = () => Response.json(many);
    render(<PlantsPage />);
    const pages = await screen.findByRole('navigation', { name: 'Pages : Toutes les fiches' });
    expect(pages.textContent).toContain('1–10 sur 12 fiches');
    fireEvent.click(within(pages).getByRole('button', { name: 'Page 2' }));
    expect(screen.getByRole('row', { name: /Plante 111/ }));
    fireEvent.click(screen.getByRole('button', { name: 'En revue (12)' }));
    expect(screen.getByRole('row', { name: /Plante 100/ }));
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
    const alt = within(form).getByLabelText(/^Texte alternatif(?! en anglais)/) as HTMLInputElement;
    expect(alt.required).toBe(true);
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'p.jpg', { type: 'image/jpeg' });
    fireEvent.change(within(form).getByLabelText(/^Photo(?! principale)/), {
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

  it('ajouter une photo sans fichier : message sous le champ Photo, focus dessus, rien envoyé', async () => {
    render(<PlantPage code="PL-001" />);
    const form = (await screen.findByRole('heading', { name: 'Ajouter une photo' })).closest(
      'form',
    )!;
    const calls = fetchMock.mock.calls.length;
    fireEvent.change(within(form).getByLabelText(/^Texte alternatif(?! en anglais)/), {
      target: { value: 'Feuilles' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Ajouter la photo' }));
    const photo = within(form).getByLabelText(/^Photo(?! principale)/);
    expect(photo.getAttribute('aria-invalid')).toBe('true');
    const described = photo.getAttribute('aria-describedby')!.split(' ');
    expect(described.map((id) => document.getElementById(id)?.textContent)).toContain(
      'Choisissez la photo à ajouter.',
    );
    expect(document.activeElement).toBe(photo);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it('fiche introuvable : message, et lien de retour', async () => {
    handler = () => Response.json({ message: 'Fiche plante introuvable.' }, { status: 404 });
    render(<PlantPage code="PL-999" />);
    expect((await screen.findByRole('alert')).textContent).toContain('Fiche plante introuvable.');
    expect(screen.getByRole('link', { name: 'Retour aux fiches plantes' }));
  });
});

describe('US-051 : validation par le Comité', () => {
  const inReview: PlantDetail = { ...PLANT, statut: 'en_revue', validation: null };

  it('fiche validée : valideur et date', async () => {
    render(<PlantPage code="PL-001" />);
    expect(await screen.findByText(/par Aboubacar Diakité, le 15 novembre 2026/));
  });

  it('le Comité valide une fiche en revue ; la date de lecture part avec la validation', async () => {
    vi.stubGlobal('confirm', () => true);
    handler = (url) => Response.json(url.endsWith('/validation') ? PLANT : inReview);
    render(<PlantPage code="PL-001" canValidate />);
    fireEvent.click(await screen.findByRole('button', { name: 'Valider la fiche' }));
    expect(await screen.findByText('Fiche validée.'));
    const [url, init] = lastCall();
    expect([url, init.method]).toEqual(['/api/plantes/PL-001/validation', 'POST']);
    expect(JSON.parse(init.body as string)).toEqual({ vueLe: PLANT.modifieLe });
  });

  it('hors Comité : pas de bouton, la règle est rappelée', async () => {
    handler = () => Response.json(inReview);
    render(<PlantPage code="PL-001" />);
    expect(await screen.findByText(/attend la validation du Comité scientifique/));
    expect(screen.queryByRole('button', { name: 'Valider la fiche' })).toBeNull();
  });
});
