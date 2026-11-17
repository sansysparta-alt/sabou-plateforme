// US-019 : organisation de la page Comptes (titre et action, chiffres, recherche et filtres,
// tableau). API simulée ; l'invitation, la suspension et la réactivation sont prouvées par l'API
// (apps/api/src/accounts) et de bout en bout (e2e/comptes.spec.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { AccountReferences, AccountSummary } from '@sabou/types';
import { AccountsPage } from './AccountsPage';

const account = (id: number, firstName: string, lastName: string, extra: Partial<AccountSummary>) =>
  ({
    id,
    email: `${firstName.toLowerCase()}@sabou-sante.gn`,
    firstName,
    lastName,
    role: 'prefectoral',
    zone: 'Labé',
    status: 'actif',
    languages: [],
    self: false,
    ...extra,
  }) satisfies AccountSummary;

const ACCOUNTS: AccountSummary[] = [
  account(1, 'Awa', 'Camara', { role: 'dg', zone: 'National', self: true }),
  account(2, 'Ibrahima', 'Sow', {}),
  account(3, 'Fatoumata', 'Bangoura', { role: 'regional', zone: 'Kindia', status: 'invite' }),
  account(4, 'Sékou', 'Kourouma', { status: 'suspendu' }),
];
const REFERENCES: AccountReferences = {
  regions: [{ id: 3, name: 'Kindia' }],
  prefectures: [{ id: 4, name: 'Labé', regionId: 3 }],
  languages: [{ code: 'fr', name: 'Français', text: true, voice: true }],
};

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      Response.json(url === '/api/comptes/referentiels' ? REFERENCES : ACCOUNTS),
    ),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const rows = () => within(screen.getByRole('table')).getAllByRole('row').slice(1);

describe('Page Comptes', () => {
  it('chiffres des comptes, puis un tableau : nom et adresse, rôle, zone, statut, actions', async () => {
    render(<AccountsPage />);
    const figures = await screen.findByRole('group', { name: 'Chiffres des comptes' });
    expect(figures.textContent).toMatch(/Comptes\s*4/);
    expect(figures.textContent).toMatch(/Actifs\s*2/);
    expect(rows()).toHaveLength(4);
    const sow = rows()[1]!;
    expect(sow.textContent).toContain('ibrahima@sabou-sante.gn');
    expect(within(sow).getByRole('button', { name: /^Suspendre.*Ibrahima Sow$/ }));
    // La DG ne peut pas se suspendre elle-même
    expect(within(rows()[0]!).queryByRole('button')).toBeNull();
  });

  it('recherche par nom ou adresse, sans accents', async () => {
    render(<AccountsPage />);
    await screen.findByRole('table');
    fireEvent.change(screen.getByRole('searchbox', { name: 'Rechercher un compte' }), {
      target: { value: 'sekou' },
    });
    expect(rows().map((row) => row.textContent)).toEqual([
      expect.stringContaining('Sékou Kourouma'),
    ]);
  });

  it('filtres par rôle et par statut, avec leur nombre', async () => {
    render(<AccountsPage />);
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Invitations en attente (1)' }));
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.textContent).toContain('Fatoumata Bangoura');
    fireEvent.click(screen.getByRole('button', { name: 'Tous (4)' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Filtrer par rôle' }), {
      target: { value: 'prefectoral' },
    });
    expect(rows()).toHaveLength(2);
  });

  it('le formulaire d’invitation s’ouvre seulement à la demande', async () => {
    render(<AccountsPage />);
    await screen.findByRole('table');
    expect(screen.queryByRole('region', { name: 'Inviter un compte' })).toBeNull();
    const open = screen.getByRole('button', { name: 'Inviter un compte' });
    fireEvent.click(open);
    expect(open.getAttribute('aria-expanded')).toBe('true');
    const form = screen.getByRole('region', { name: 'Inviter un compte' });
    fireEvent.click(within(form).getByRole('button', { name: 'Annuler' }));
    expect(screen.queryByRole('region', { name: 'Inviter un compte' })).toBeNull();
  });
});
