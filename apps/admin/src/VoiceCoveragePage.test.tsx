// US-074 : écran « Couverture vocale » de la DG. API simulée ; les règles (calcul, publication
// des seules voix publiables, réservée à la DG) sont prouvées par la base
// (packages/db/test/couverture-vocale.test.ts) et l'API (apps/api/src/voices/treatment-voices.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { VoiceCoverage } from '@sabou/types';
import { VoiceCoveragePage } from './VoiceCoveragePage';

let coverage: VoiceCoverage;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  coverage = {
    langues: [
      { langue: 'mal', langueNom: 'Malinké', sections: 13, publiees: 4, validees: 2, bloquees: 1 },
      { langue: 'pul', langueNom: 'Pular', sections: 13, publiees: 0, validees: 0, bloquees: 0 },
    ],
    retards: [
      { region: 'Labé', brouillons: 1, envoyees: 2, validees: 0, plusAncienne: '2026-11-01' },
    ],
  };
  fetchMock = vi.fn(async (url: string) =>
    url.endsWith('/publication')
      ? Response.json({ publiees: 1, bloquees: 1 })
      : Response.json(coverage),
  );
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Critère : pourcentage de sections publiées par langue et retards par région', () => {
  it('pourcentage et décompte par langue ; retards par région avec la date la plus ancienne', async () => {
    render(<VoiceCoveragePage />);
    const table = await screen.findByRole('table', { name: /Couverture par langue/ });
    const malinke = within(table).getByRole('row', { name: /Malinké/ });
    expect(within(malinke).getByText('31 %')).toBeTruthy();
    expect(within(malinke).getByText('1 (+ 1 bloquées)')).toBeTruthy();
    const delays = screen.getByRole('table', { name: /Retards par région/ });
    expect(within(delays).getByRole('row', { name: /Labé/ }).textContent).toContain('01/11/2026');
  });
});

describe('Critère : publication groupée des voix validées', () => {
  it('par langue : la langue est envoyée, le résultat dit les voix bloquées', async () => {
    render(<VoiceCoveragePage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Publier les voix en Malinké' }));
    expect(await screen.findByText(/Malinké : 1 voix publiée, 1 voix bloquée/)).toBeTruthy();
    const post = fetchMock.mock.calls.find(([url]) => url.endsWith('/publication'))!;
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({ langue: 'mal' });
  });

  it('toutes les langues d’un geste ; bouton inactif pour une langue sans voix publiable', async () => {
    render(<VoiceCoveragePage />);
    expect(
      (await screen.findByRole('button', { name: 'Publier les voix en Pular' })).hasAttribute(
        'disabled',
      ),
    ).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: /Publier toutes les voix validées \(1\)/ }));
    await screen.findByText(/Toutes les langues : 1 voix publiée/);
    const post = fetchMock.mock.calls.find(([url]) => url.endsWith('/publication'))!;
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({ langue: null });
  });
});
