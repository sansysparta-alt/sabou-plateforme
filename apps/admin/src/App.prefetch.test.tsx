import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { SessionUser } from '@sabou/types';
import { App } from './App';
import { clearPrefetched } from './prefetch';

// Adresses demandées à l'API, et ce que la page voyait à son premier affichage
const seen = vi.hoisted(() => ({ urls: [] as string[], atFirstRender: null as string[] | null }));

// Page remplacée par un témoin : il note les requêtes déjà parties quand il s'affiche,
// avant tout effet de la page elle-même
vi.mock('./ExpertisePage', () => ({
  ExpertisePage: () => {
    seen.atFirstRender ??= [...seen.urls];
    return <h1>Expertise des dossiers</h1>;
  },
}));

const committee: SessionUser = {
  username: 'aboubacar.diakite',
  name: 'Aboubacar Diakité',
  roles: ['comite', 'administrateur'],
  administrator: true,
  secondFactor: true,
};

afterEach(() => {
  cleanup();
  clearPrefetched();
  vi.unstubAllGlobals();
});

describe('Données demandées en avance (US-017)', () => {
  it('les données de la page sont déjà demandées quand son morceau s’affiche', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        seen.urls.push(url);
        return url === '/auth/session'
          ? Response.json(committee)
          : Response.json({ elements: [], suivant: null });
      }),
    );
    window.history.replaceState(null, '', '/expertise');
    render(<App />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Expertise des dossiers' }));
    expect(seen.atFirstRender).toContain('/api/dossiers/expertise');
  });
});
