// Graphiques des tableaux de bord (US-090) : chaque valeur est lisible sans la couleur
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BarList, StatusRing } from './Chart';

afterEach(cleanup);

// Intl écrit « 75 % » avec une espace insécable fine : comparée ici comme une espace
const text = (el: Element) => el.textContent!.replace(/\s/g, ' ');

describe('BarList', () => {
  const rows = [
    { label: 'Labé', value: 12 },
    { label: 'Kindia', value: 3 },
    { label: 'Faranah', value: 0 },
  ];

  it('est un tableau lisible : libellé et valeur en clair pour chaque ligne', () => {
    render(
      <BarList
        caption="Praticiens certifiés par région"
        labelHeader="Région"
        valueHeader="Certifiés"
        rows={rows}
        empty="Aucune région"
      />,
    );
    const table = screen.getByRole('table', { name: 'Praticiens certifiés par région' });
    expect(within(table).getByRole('columnheader', { name: 'Région' })).toBeTruthy();
    const labe = within(table).getByRole('row', { name: /Labé/ });
    expect(labe.textContent).toContain('12');
  });

  it('longueur proportionnelle à la plus grande valeur ; une valeur nulle garde une marque', () => {
    const { container } = render(
      <BarList caption="c" labelHeader="l" valueHeader="v" rows={rows} empty="" />,
    );
    const widths = [...container.querySelectorAll<HTMLElement>('.ui-bars__bar')].map(
      (b) => b.style.width,
    );
    expect(widths).toEqual(['100%', '25%', '1px']);
  });

  it('liste vide : message, pas de tableau', () => {
    render(<BarList caption="c" labelHeader="l" valueHeader="v" rows={[]} empty="Rien" />);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText('Rien')).toBeTruthy();
  });
});

describe('StatusRing', () => {
  const segments = [
    { label: 'Certifiés', value: 3, tone: 'success' as const },
    { label: 'En attente', value: 1, tone: 'pending' as const },
    { label: 'Rejetés', value: 0, tone: 'error' as const },
  ];

  it('légende : nom, nombre et part de chaque état ; dessin caché aux lecteurs d’écran', () => {
    const { container } = render(<StatusRing noun="praticiens" segments={segments} />);
    const items = screen.getAllByRole('listitem').map(text);
    expect(items).toEqual(['Certifiés3 (75 %)', 'En attente1 (25 %)', 'Rejetés0 (0 %)']);
    expect(container.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('dessine un segment par état non nul et le total au centre', () => {
    const { container } = render(<StatusRing noun="praticiens" segments={segments} />);
    expect(container.querySelectorAll('.ui-ring__segment')).toHaveLength(2);
    expect(container.querySelector('.ui-ring__total')!.textContent).toBe('4');
  });

  it('total nul : aucune division par zéro', () => {
    render(<StatusRing noun="praticiens" segments={segments.map((s) => ({ ...s, value: 0 }))} />);
    expect(text(screen.getAllByRole('listitem')[0]!)).toBe('Certifiés0 (0 %)');
  });
});
