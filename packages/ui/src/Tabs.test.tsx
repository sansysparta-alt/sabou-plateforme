import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Tabs } from './Tabs';

const tabs = [
  { id: 'langues', label: 'Langues', count: 13, content: <p>Contenu langues</p> },
  { id: 'territoires', label: 'Territoires', count: 8, content: <p>Contenu territoires</p> },
  { id: 'specialites', label: 'Spécialités', content: <p>Contenu spécialités</p> },
];

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

describe('Tabs (US-019)', () => {
  it('premier onglet par défaut, seul dans l’ordre de tabulation, son panneau seul affiché', () => {
    render(<Tabs label="Référentiels" tabs={tabs} />);
    const [first, second] = screen.getAllByRole('tab');
    expect(first!.getAttribute('aria-selected')).toBe('true');
    expect(first!.getAttribute('tabindex')).toBe('0');
    expect(second!.getAttribute('tabindex')).toBe('-1');
    expect(screen.getByText('Contenu langues')).toBeTruthy();
    expect(screen.queryByText('Contenu territoires')).toBeNull();
    expect(first!.textContent).toContain('13');
  });

  it('flèches, Début et Fin : changent d’onglet et gardent le choix dans l’adresse', () => {
    render(<Tabs label="Référentiels" tabs={tabs} />);
    const [first] = screen.getAllByRole('tab');
    fireEvent.keyDown(first!, { key: 'ArrowRight' });
    expect(screen.getByRole('tab', { name: /Territoires/ }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(window.location.hash).toBe('#territoires');
    fireEvent.keyDown(screen.getByRole('tab', { name: /Territoires/ }), { key: 'End' });
    expect(screen.getByText('Contenu spécialités')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('tab', { name: /Spécialités/ }), { key: 'ArrowRight' });
    expect(screen.getByText('Contenu langues')).toBeTruthy();
  });

  it('s’ouvre sur l’onglet de l’adresse', () => {
    window.history.replaceState(null, '', '/#specialites');
    render(<Tabs label="Référentiels" tabs={tabs} />);
    expect(screen.getByRole('tabpanel').textContent).toBe('Contenu spécialités');
  });
});
