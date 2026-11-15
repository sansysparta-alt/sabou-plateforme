// US-053 : écran des noms locaux. API simulée ; les règles (référent de la langue, un seul
// principal, voix d'un dépôt traité du même compte, journal) sont prouvées par la base
// (packages/db/test/noms-locaux.test.ts) et l'API (apps/api/src/plants/local-names.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { LocalNamesPlant, LocalNamesPlantSummary } from '@sabou/types';
import { LocalNamesPage } from './LocalNamesPage';

const PLANTS: LocalNamesPlantSummary[] = [
  { code: 'PL-006', nomScientifique: 'Combretum micranthum', nomFr: 'Kinkéliba', noms: 2 },
];
const PLANT: LocalNamesPlant = {
  code: 'PL-006',
  nomScientifique: 'Combretum micranthum',
  nomFr: 'Kinkéliba',
  noms: [
    {
      id: 7,
      langue: 'mal',
      langueNom: 'Malinké',
      transcription: 'Kinkiliba',
      principal: true,
      voix: true,
      modifiable: true,
    },
    {
      id: 8,
      langue: 'mal',
      langueNom: 'Malinké',
      transcription: 'Kenkeliba',
      principal: false,
      voix: false,
      modifiable: true,
    },
    {
      id: 9,
      langue: 'sus',
      langueNom: 'Soussou',
      transcription: 'Kinkeli',
      principal: true,
      voix: true,
      modifiable: false,
    },
  ],
};

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
let handler: Handler;
let languages = [{ code: 'mal', nom: 'Malinké' }];
let fetchMock: ReturnType<typeof vi.fn>;

const base: Handler = (url) => {
  if (url === '/api/noms-locaux/langues') return Response.json(languages);
  if (url.startsWith('/api/noms-locaux/plantes/')) return Response.json(PLANT);
  if (url.startsWith('/api/noms-locaux/plantes')) return Response.json(PLANTS);
  return Response.json(PLANT);
};

beforeEach(() => {
  languages = [{ code: 'mal', nom: 'Malinké' }];
  handler = base;
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const posts = () =>
  (fetchMock.mock.calls as [string, RequestInit | undefined][]).filter(
    ([, init]) => init?.method && init.method !== 'GET',
  );

async function openPlant() {
  render(<LocalNamesPage />);
  const table = await screen.findByRole('table', { name: 'Plantes' });
  fireEvent.click(within(table).getByRole('button', { name: /Noms locaux de Kinkéliba/ }));
  return screen.findByRole('table', { name: 'Noms locaux, par langue' });
}

describe('Critère : plusieurs noms par langue, un seul principal', () => {
  it('montre les noms de chaque langue, le principal marqué ; actions sur ses langues seules', async () => {
    const names = await openPlant();
    const rows = within(names).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain('Principal');
    expect(within(rows[0]!).queryByRole('button', { name: /Rendre principal/ })).toBeNull();
    expect(within(rows[1]!).getByRole('button', { name: 'Rendre principal : Kenkeliba' }));
    // Soussou : le compte n'en est pas référent
    expect(within(rows[2]!).queryByRole('button')).toBeNull();
    expect(document.activeElement?.textContent).toContain('Kinkéliba');
  });

  it('rendre principal : appel de l’API, message de confirmation', async () => {
    const names = await openPlant();
    fireEvent.click(within(names).getByRole('button', { name: 'Rendre principal : Kenkeliba' }));
    expect(await screen.findByText(/« Kenkeliba » est le nom principal en Malinké/));
    expect(posts().map(([url, init]) => [url, init!.method])).toEqual([
      ['/api/noms-locaux/8/principal', 'POST'],
    ]);
  });

  it('ajout sans voix : langue, transcription sans espaces, principal demandé', async () => {
    await openPlant();
    fireEvent.change(screen.getByLabelText('Transcription de recherche'), {
      target: { value: '  Kinkeliba-ba  ' },
    });
    fireEvent.click(screen.getByLabelText(/Nom principal dans cette langue/));
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter le nom' }));
    expect(await screen.findByText('« Kinkeliba-ba » est ajouté.'));
    const [url, init] = posts()[0]!;
    expect(url).toBe('/api/noms-locaux');
    expect(JSON.parse(String(init!.body))).toEqual({
      plante: 'PL-006',
      langue: 'mal',
      transcription: 'Kinkeliba-ba',
      principal: true,
      depot: null,
    });
  });

  it('transcription vide : erreur liée au champ, focus, rien n’est envoyé', async () => {
    await openPlant();
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter le nom' }));
    const field = screen.getByLabelText('Transcription de recherche');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(field);
    expect(posts()).toEqual([]);
  });
});

describe('Critère : la transcription sert à la recherche, jamais à l’affichage public', () => {
  it('le champ le dit au référent', async () => {
    await openPlant();
    expect(screen.getByText(/jamais affichée sur le site public/));
  });
});

describe('Voix du nom', () => {
  it('voix jointe : consentement exigé avant tout envoi', async () => {
    await openPlant();
    fireEvent.change(screen.getByLabelText('Transcription de recherche'), {
      target: { value: 'Kinkeliba' },
    });
    const file = new File([new Uint8Array([1, 2, 3])], 'nom.ogg', { type: 'audio/ogg' });
    fireEvent.change(screen.getByLabelText('Voix du nom (facultatif)'), {
      target: { files: [file] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter le nom' }));
    const consent = screen.getByLabelText('Consentement de la personne qui parle');
    expect(consent.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(consent);
    expect(posts()).toEqual([]);
  });

  it('voix déposée puis traitée : le nom est ajouté avec le dépôt', async () => {
    let polls = 0;
    handler = (url, init) => {
      if (url === '/api/voix?consentement=true') {
        return Response.json({ depot: 42, statut: 'en_attente', erreur: null }, { status: 202 });
      }
      if (url === '/api/voix/depots/42') {
        polls += 1;
        return Response.json({ depot: 42, statut: 'traitee', erreur: null });
      }
      return base(url, init);
    };
    await openPlant();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fireEvent.change(screen.getByLabelText('Transcription de recherche'), {
      target: { value: 'Kinkeliba' },
    });
    const file = new File([new Uint8Array([1, 2, 3])], 'nom.ogg', { type: 'audio/ogg' });
    fireEvent.change(screen.getByLabelText('Voix du nom (facultatif)'), {
      target: { files: [file] },
    });
    fireEvent.change(screen.getByLabelText('Consentement de la personne qui parle'), {
      target: { value: 'oui' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter le nom' }));
    await vi.advanceTimersByTimeAsync(2500);
    expect(await screen.findByText('« Kinkeliba » est ajouté.'));
    expect(polls).toBe(1);
    const add = posts().find(([url]) => url === '/api/noms-locaux')!;
    expect(JSON.parse(String(add[1]!.body))).toMatchObject({ depot: 42 });
  });
});

describe('Compte sans langue', () => {
  it('consultation seule : message, pas de formulaire', async () => {
    languages = [];
    await openPlant();
    expect(screen.getByText(/Vous n’êtes référent d’aucune langue/));
    expect(screen.queryByRole('button', { name: 'Ajouter le nom' })).toBeNull();
  });
});
