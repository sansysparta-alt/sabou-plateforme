// US-019 : organisation de la page Comptes (titre et action, chiffres, recherche et filtres,
// tableau). API simulée ; l'invitation, la suspension et la réactivation sont prouvées par l'API
// (apps/api/src/accounts) et de bout en bout (e2e/comptes.spec.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { AccountReferences, AccountSummary } from '@sabou/types';
import { MATRIX_ROLE_LABELS, MATRIX_ROLES, PERMISSIONS } from '@sabou/types/permissions';
import { PHONE_ERROR } from '@sabou/types/phone';
import { AccountsPage } from './AccountsPage';

const account = (id: number, firstName: string, lastName: string, extra: Partial<AccountSummary>) =>
  ({
    id,
    email: `${firstName.toLowerCase()}@sabou-sante.gn`,
    firstName,
    lastName,
    phone: null,
    role: 'prefectoral',
    zone: 'Labé',
    status: 'actif',
    languages: [],
    self: false,
    ...extra,
  }) satisfies AccountSummary;

const ACCOUNTS: AccountSummary[] = [
  account(1, 'Awa', 'Camara', { role: 'dg', zone: 'National', self: true }),
  account(2, 'Ibrahima', 'Sow', { phone: '+224621234567' }),
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

// Libellés à parenthèses : « Valider un praticien (terrain) »
const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
    // Téléphone facultatif, sous l'adresse, sous sa forme lisible (US-012b)
    expect(sow.textContent).toContain('621 23 45 67');
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

  it('formulaire : le rôle choisi est décrit, un téléphone invalide est refusé avant l’envoi', async () => {
    render(<AccountsPage />);
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('button', { name: 'Inviter un compte' }));
    const form = screen.getByRole('region', { name: 'Inviter un compte' });
    const role = within(form).getByRole('combobox', { name: 'Rôle' });
    fireEvent.change(role, { target: { value: 'regional' } });
    expect(role.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(role.getAttribute('aria-describedby')!)?.textContent).toMatch(
      /^Région · Consolide les dossiers/,
    );
    fireEvent.change(within(form).getByLabelText('Prénom'), { target: { value: 'Fanta' } });
    fireEvent.change(within(form).getByLabelText('Nom'), { target: { value: 'Condé' } });
    fireEvent.change(within(form).getByLabelText('Adresse e-mail'), {
      target: { value: 'fanta@sabou-sante.gn' },
    });
    fireEvent.change(within(form).getByLabelText('Téléphone (facultatif)'), {
      target: { value: '0123' },
    });
    fireEvent.click(within(form).getByRole('button', { name: 'Créer l’invitation' }));
    expect((await within(form).findByRole('alert')).textContent).toBe(PHONE_ERROR);
    // Rien n'est envoyé : seuls les deux chargements de la page ont eu lieu
    expect(vi.mocked(fetch).mock.calls.map(([url]) => url)).not.toContain(
      expect.stringMatching(/^\/api\/comptes$/),
    );
  });
});

describe('Onglet Rôles et droits (US-012b)', () => {
  it('matrice du cahier des charges en consultation : un droit par ligne, un profil par colonne', async () => {
    render(<AccountsPage />);
    await screen.findByRole('table');
    fireEvent.click(screen.getByRole('tab', { name: 'Rôles et droits' }));
    const matrix = screen.getByRole('table', { name: 'Droits de chaque profil' });
    // Première ligne seulement : les intertitres de groupe sont aussi des en-têtes
    const headers = within(within(matrix).getAllByRole('row')[0]!)
      .getAllByRole('columnheader')
      .map((cell) => cell.textContent);
    expect(headers).toEqual(['Droit', ...MATRIX_ROLES.map((role) => MATRIX_ROLE_LABELS[role])]);
    // Chaque droit du catalogue : « Oui », le périmètre écrit (« Local »…) ou « Non »
    for (const entry of PERMISSIONS) {
      const header = within(matrix).getByRole('rowheader', {
        name: new RegExp(`^${escapeRegExp(entry.label)}`),
      });
      expect(header.textContent?.includes('À venir')).toBe(!entry.available);
      const cells = within(header.closest('tr')!)
        .getAllByRole('cell')
        .map((cell) => cell.textContent);
      expect(cells).toEqual(
        MATRIX_ROLES.map((role) => {
          const grant = entry.grants[role];
          return grant === undefined ? '—Non' : grant === true ? 'Oui' : grant;
        }),
      );
    }
    // Rien à modifier : ni case à cocher ni bouton dans la matrice
    expect(within(matrix).queryAllByRole('checkbox')).toEqual([]);
    expect(within(matrix).queryAllByRole('button')).toEqual([]);
  });
});
