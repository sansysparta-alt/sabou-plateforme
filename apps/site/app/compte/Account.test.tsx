// US-068, critère 3 : un compte praticien connecté au site n'y a que les fonctions du citoyen
// (plus de lien vers le Studio) ; il est renvoyé vers l'application mobile. Le refus de
// ses routes par l'API est prouvé par apps/api (dossiers.test.ts, studio.test.ts) et de bout
// en bout (e2e-compte/dossier.spec.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import Account from './Account';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

function signedIn(roles: string[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () =>
      Response.json({
        sub: 's',
        username: '621234567',
        name: 'Mariama Soumah',
        roles,
        secondFactor: false,
      }),
    ),
  );
}

beforeEach(() => vi.unstubAllGlobals());
afterEach(cleanup);

describe('Mon compte', () => {
  it('praticien : aucun Studio, renvoi vers l’application mobile', async () => {
    signedIn(['praticien']);
    render(<Account />);
    await screen.findByText('Bonjour Mariama Soumah.');
    expect(screen.queryByRole('link', { name: /studio/i })).toBeNull();
    expect(screen.getByText(/sont dans l’application mobile SABOU/)).toBeTruthy();
    // Fonctions du citoyen seulement : la déconnexion
    expect(screen.getByRole('button', { name: 'Se déconnecter' })).toBeTruthy();
  });

  it('citoyen : pas de message destiné au praticien', async () => {
    signedIn(['citoyen']);
    render(<Account />);
    await screen.findByText('Bonjour Mariama Soumah.');
    expect(screen.queryByText(/application mobile/)).toBeNull();
  });
});
