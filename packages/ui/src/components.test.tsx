import { createRef } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Alert,
  AppShell,
  DataTable,
  Icon,
  iconNames,
  PageHeader,
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

  it('réduire le menu : icônes seules, libellés toujours lus, choix mémorisé (US-019)', () => {
    window.localStorage.clear();
    const { container, unmount } = render(
      <AppShell user={{ name: 'Essai DG', zone: 'National' }} nav={nav} currentPath="/">
        <p>Contenu</p>
      </AppShell>,
    );
    const shell = container.querySelector('.ui-shell')!;
    const button = screen.getByRole('button', { name: 'Réduire le menu' });
    expect(shell.getAttribute('data-collapsed')).toBe('false');
    fireEvent.click(button);
    expect(shell.getAttribute('data-collapsed')).toBe('true');
    expect(button.getAttribute('aria-pressed')).toBe('true');
    // Le libellé reste le nom accessible du lien
    expect(screen.getByRole('link', { name: 'Comptes' })).toBeTruthy();
    unmount();
    const again = render(
      <AppShell user={{ name: 'Essai DG' }} nav={nav} currentPath="/">
        <p>Contenu</p>
      </AppShell>,
    );
    expect(again.container.querySelector('.ui-shell')!.getAttribute('data-collapsed')).toBe('true');
    window.localStorage.clear();
  });

  it('compte connecté en haut : initiales, nom, zone et déconnexion, hors de la navigation', () => {
    render(
      <AppShell
        user={{ name: 'Awa Camara', zone: 'National' }}
        nav={nav}
        currentPath="/"
        userActions={<button>Se déconnecter</button>}
      >
        <p>Contenu</p>
      </AppShell>,
    );
    const account = screen.getByRole('region', { name: 'Compte connecté' });
    expect(account.textContent).toContain('AC');
    expect(account.textContent).toContain('Awa Camara');
    expect(account.textContent).toContain('National');
    expect(screen.getAllByRole('button', { name: 'Se déconnecter' })).toHaveLength(1);
    // Placé avant le contenu principal (lu en premier), plus dans la colonne de navigation
    const navigation = screen.getByRole('navigation', { name: 'Navigation principale' });
    expect(navigation.textContent).not.toContain('Awa Camara');
    expect(
      account.compareDocumentPosition(screen.getByRole('main')) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
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

describe('Icon', () => {
  it('chaque icône a son propre tracé : deux rubriques ne partagent jamais le même dessin', () => {
    render(
      <>
        {iconNames.map((name) => (
          <Icon key={name} name={name} />
        ))}
      </>,
    );
    const drawings = Array.from(document.querySelectorAll('svg path'), (path) =>
      path.getAttribute('d'),
    );
    expect(drawings).toHaveLength(iconNames.length);
    expect(new Set(drawings).size).toBe(iconNames.length);
  });
});

describe('PageHeader', () => {
  // Hauteur de la page simulée (jsdom ne calcule pas la mise en page)
  const pageHeight = (height: number) =>
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: height,
    });
  afterEach(() => pageHeight(0));

  it('page qui ne défile que de peu : pas de resserrement (sinon clignotement sans fin)', () => {
    let notify: (entries: Partial<IntersectionObserverEntry>[]) => void = () => {};
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: (entries: Partial<IntersectionObserverEntry>[]) => void) {
          notify = callback;
        }
        observe() {}
        disconnect() {}
      },
    );
    pageHeight(window.innerHeight + 30);
    render(<PageHeader title="Vérification terrain" lead="Dossiers soumis." />);
    const header = screen
      .getByRole('heading', { level: 1, name: 'Vérification terrain' })
      .closest('.ui-page-header')!;
    act(() => notify([{ intersectionRatio: 0.98, boundingClientRect: { top: -1 } as DOMRect }]));
    expect(header.hasAttribute('data-stuck')).toBe(false);
  });

  it('signale quand il est accroché en haut de l’écran, puis quand il reprend sa place', () => {
    pageHeight(window.innerHeight * 3);
    let notify: (entries: Partial<IntersectionObserverEntry>[]) => void = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: (entries: Partial<IntersectionObserverEntry>[]) => void) {
          notify = callback;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const { unmount } = render(
      <PageHeader
        title="Comptes"
        lead="Comptes d’administration."
        actions={<button>Inviter</button>}
      />,
    );
    const header = screen
      .getByRole('heading', { level: 1, name: 'Comptes' })
      .closest('.ui-page-header')!;
    expect(header.hasAttribute('data-stuck')).toBe(false);

    act(() => notify([{ intersectionRatio: 0.98, boundingClientRect: { top: -1 } as DOMRect }]));
    expect(header.getAttribute('data-stuck')).toBe('true');
    // Titre et action restent accessibles une fois accroché
    expect(screen.getByRole('button', { name: 'Inviter' })).toBeTruthy();

    act(() => notify([{ intersectionRatio: 1, boundingClientRect: { top: 24 } as DOMRect }]));
    expect(header.hasAttribute('data-stuck')).toBe(false);

    // Partiellement caché en bas de l'écran (pas en haut) : pas accroché
    act(() => notify([{ intersectionRatio: 0.5, boundingClientRect: { top: 600 } as DOMRect }]));
    expect(header.hasAttribute('data-stuck')).toBe(false);

    unmount();
    expect(disconnect).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
