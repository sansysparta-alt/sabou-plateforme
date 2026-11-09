import { createRef } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  Alert,
  AppShell,
  DataTable,
  SelectField,
  StatCard,
  TextAreaField,
  TextField,
} from './index';

afterEach(cleanup);

describe('Alert', () => {
  it('une erreur est annoncée aussitôt (role alert), une information sans interrompre (role status)', () => {
    render(
      <>
        <Alert tone="error" title="Échec" />
        <Alert tone="success" title="Enregistré" />
      </>,
    );
    expect(screen.getByRole('alert')).toHaveProperty('textContent', 'Échec');
    expect(screen.getByRole('status')).toHaveProperty('textContent', 'Enregistré');
  });

  it("l'icône est décorative : le sens est porté par le texte", () => {
    const { container } = render(<Alert tone="warning" title="Attention" />);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it("l'erreur d'un formulaire peut recevoir le focus ; les autres messages non", () => {
    const ref = createRef<HTMLDivElement>();
    render(
      <>
        <Alert tone="error" ref={ref}>
          Champ manquant
        </Alert>
        <Alert tone="info">Information</Alert>
      </>,
    );
    ref.current!.focus();
    expect(document.activeElement).toBe(screen.getByRole('alert'));
    expect(screen.getByRole('status').hasAttribute('tabindex')).toBe(false);
  });
});

describe('champs de formulaire', () => {
  it("le libellé, l'aide et l'erreur sont reliés au champ", () => {
    render(
      <TextField label="Adresse e-mail" hint="Identifiant de connexion" error="Adresse invalide" />,
    );
    const input = screen.getByLabelText('Adresse e-mail');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const described = (input.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent);
    expect(described).toEqual(['Identifiant de connexion', 'Adresse invalide']);
  });

  it("sans erreur, le champ n'est pas marqué invalide", () => {
    render(
      <SelectField label="Rôle">
        <option>DG</option>
      </SelectField>,
    );
    const select = screen.getByLabelText('Rôle');
    expect(select.hasAttribute('aria-invalid')).toBe(false);
    expect(select.hasAttribute('aria-describedby')).toBe(false);
  });

  it('relie aussi libellé, aide et erreur à un champ multiligne', () => {
    render(
      <TextAreaField label="Motif du rejet" hint="Lu par le praticien" error="Motif obligatoire" />,
    );
    const area = screen.getByLabelText('Motif du rejet');
    expect(area.tagName).toBe('TEXTAREA');
    expect(area.getAttribute('aria-invalid')).toBe('true');
    const described = (area.getAttribute('aria-describedby') ?? '')
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent);
    expect(described).toEqual(['Lu par le praticien', 'Motif obligatoire']);
  });
});

describe('StatCard', () => {
  it('formate le chiffre à la française', () => {
    render(<StatCard label="Comptes" value={15000} />);
    expect(screen.getByText(/^15\s000$/)).toBeTruthy();
  });

  it('annonce une fonction à venir', () => {
    render(<StatCard label="Certificats" value={null} upcoming="Sprint 3" />);
    expect(screen.getByText('Sprint 3')).toBeTruthy();
  });
});

describe('DataTable', () => {
  it('a une légende, des en-têtes de colonne et un message si vide', () => {
    render(
      <DataTable
        caption="Comptes"
        columns={[{ key: 'nom', header: 'Nom', render: (row: { nom: string }) => row.nom }]}
        rows={[]}
        rowKey={(row) => row.nom}
        empty="Aucun compte."
      />,
    );
    expect(screen.getByRole('table', { name: 'Comptes' })).toBeTruthy();
    expect(screen.getByRole('columnheader', { name: 'Nom' })).toBeTruthy();
    expect(screen.getByText('Aucun compte.')).toBeTruthy();
  });
});

describe('AppShell', () => {
  const nav = [
    {
      heading: 'Pilotage',
      items: [
        { href: '/', label: 'Tableau de bord', icon: 'dashboard' as const },
        { href: '/comptes', label: 'Comptes', icon: 'users' as const },
      ],
    },
  ];

  it('marque la page courante et propose un lien d’évitement', () => {
    render(
      <AppShell user={{ name: 'Essai DG', zone: 'National' }} nav={nav} currentPath="/comptes">
        <p>Contenu</p>
      </AppShell>,
    );
    expect(screen.getByRole('link', { name: 'Comptes' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Tableau de bord' }).hasAttribute('aria-current')).toBe(
      false,
    );
    expect(screen.getByRole('link', { name: 'Aller au contenu' }).getAttribute('href')).toBe(
      '#contenu',
    );
    expect(screen.getByRole('navigation', { name: 'Navigation principale' })).toBeTruthy();
  });

  it('le bouton Menu ouvre et ferme la navigation sur téléphone', () => {
    render(
      <AppShell user={{ name: 'Essai DG' }} nav={nav} currentPath="/">
        <p>Contenu</p>
      </AppShell>,
    );
    const button = screen.getByRole('button', { name: 'Menu' });
    const navigation = screen.getByRole('navigation', { name: 'Navigation principale' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(navigation.getAttribute('data-open')).toBe('false');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(navigation.getAttribute('data-open')).toBe('true');
  });
});
