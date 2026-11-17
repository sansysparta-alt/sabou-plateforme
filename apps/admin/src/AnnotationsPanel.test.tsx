// US-064 : annotations du Comité dans l'application de gestion. API simulée ; les règles sont
// prouvées par la base (packages/db/test/annotations-comite.test.ts) et l'API
// (apps/api/src/annotations/annotations.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Annotation } from '@sabou/types';
import { AnnotationsPanel } from './AnnotationsPanel';

const HISTORY: Annotation[] = [
  {
    id: 2,
    avis: 'reserve',
    contenu: 'Amertume forte.',
    auteur: 'Aboubacar Diakité',
    le: '2026-11-16T10:00:00Z',
  },
  {
    id: 1,
    avis: 'favorable',
    contenu: 'Posologie compatible.',
    auteur: 'Aboubacar Diakité',
    le: '2026-11-10T09:00:00Z',
  },
];

let requests: { url: string; method: string; body?: unknown }[];

beforeEach(() => {
  requests = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      requests.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (method === 'POST') {
        return Response.json([
          {
            id: 3,
            avis: 'defavorable',
            contenu: 'Toxicité.',
            auteur: 'Aboubacar Diakité',
            le: '2026-11-16T11:00:00Z',
          },
          ...HISTORY,
        ]);
      }
      return Response.json(HISTORY);
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function open() {
  const summary = screen.getByText('Annotations du Comité scientifique').closest('details')!;
  summary.open = true;
  fireEvent(summary, new Event('toggle'));
}

describe('Critère : historique consultable par la DG', () => {
  it('replié et non chargé tant qu’il n’est pas ouvert (3G)', () => {
    render(<AnnotationsPanel type="recette" code="REC-0007" canAnnotate={false} />);
    expect(requests).toEqual([]);
  });

  it('ouvert : avis datés, du plus récent au plus ancien ; pas de formulaire pour la DG', async () => {
    render(<AnnotationsPanel type="recette" code="REC-0007" canAnnotate={false} />);
    open();
    expect(await screen.findByText('Amertume forte.'));
    expect(requests).toEqual([
      { url: '/api/annotations?type=recette&code=REC-0007', method: 'GET', body: undefined },
    ]);
    const badges = screen
      .getAllByText(/^(Favorable|Réserve|Défavorable)$/)
      .map((b) => b.textContent);
    expect(badges).toEqual(['Réserve', 'Favorable']);
    expect(screen.getAllByText(/Aboubacar Diakité, le /)).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Enregistrer l’annotation' })).toBeNull();
  });
});

describe('Critère : annotation datée avec avis (Comité)', () => {
  it('avis et texte obligatoires ; enregistrée, elle s’ajoute en tête de l’historique', async () => {
    render(<AnnotationsPanel type="plante" code="PL-005" canAnnotate />);
    open();
    await screen.findByText('Amertume forte.');
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer l’annotation' }));
    expect(await screen.findByText('Choisissez un avis et rédigez l’annotation.'));
    fireEvent.click(screen.getByRole('radio', { name: 'Défavorable' }));
    fireEvent.change(screen.getByLabelText(/^Annotation/), { target: { value: ' Toxicité. ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer l’annotation' }));
    expect(await screen.findByText('Annotation enregistrée.'));
    expect(requests.at(-1)).toEqual({
      url: '/api/annotations',
      method: 'POST',
      body: { type: 'plante', code: 'PL-005', avis: 'defavorable', contenu: 'Toxicité.' },
    });
    expect(screen.getByText('Toxicité.'));
  });
});
