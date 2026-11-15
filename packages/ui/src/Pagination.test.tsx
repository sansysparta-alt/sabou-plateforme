import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { Pagination, pageNumbers, usePagination, type PaginationProps } from './Pagination';

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

const props = (change: Partial<PaginationProps> = {}): PaginationProps => ({
  total: 36,
  page: 0,
  pageSize: 10,
  onPage: () => undefined,
  onPageSize: () => undefined,
  noun: ['compte', 'comptes'],
  label: 'Pages des comptes',
  ...change,
});

describe('Pagination (US-019)', () => {
  it('numéros : tous jusqu’à 7 pages, puis la première, la dernière et les voisines', () => {
    expect(pageNumbers(0, 4)).toEqual([0, 1, 2, 3]);
    expect(pageNumbers(9, 20)).toEqual([0, null, 8, 9, 10, null, 19]);
    expect(pageNumbers(0, 20)).toEqual([0, 1, 2, 3, null, 19]);
    expect(pageNumbers(19, 20)).toEqual([0, null, 16, 17, 18, 19]);
  });

  it('étendue et total avec le nom des éléments, page courante annoncée', () => {
    render(<Pagination {...props({ page: 1 })} />);
    const nav = screen.getByRole('navigation', { name: 'Pages des comptes' });
    expect(nav.textContent).toContain('11–20 sur 36 comptes');
    expect(screen.getByRole('button', { name: 'Page 2' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.getByRole('button', { name: 'Page 1' }).hasAttribute('aria-current')).toBe(false);
  });

  it('Préc. inactif sur la première page, Suiv. sur la dernière', () => {
    const { rerender } = render(<Pagination {...props()} />);
    expect(screen.getByRole('button', { name: /Préc/ }).hasAttribute('disabled')).toBe(true);
    rerender(<Pagination {...props({ page: 3 })} />);
    expect(screen.getByRole('button', { name: /Suiv/ }).hasAttribute('disabled')).toBe(true);
  });

  it('dix éléments ou moins : pas de pagination', () => {
    const { container } = render(<Pagination {...props({ total: 10 })} />);
    expect(container.textContent).toBe('');
  });

  it('une page, mais plus de dix éléments : taille de page proposée, pas de numéros', () => {
    render(<Pagination {...props({ total: 30, pageSize: 50 })} />);
    expect(screen.getByLabelText('Afficher')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Suiv/ })).toBeNull();
  });
});

describe('usePagination', () => {
  const items = Array.from({ length: 36 }, (_, i) => i);

  it('découpe la liste ; taille de page mémorisée pour la liste', () => {
    const { result } = renderHook(() => usePagination(items, 'essai'));
    expect(result.current.pageItems).toEqual(items.slice(0, 10));
    act(() => result.current.paginationProps.onPage(3));
    expect(result.current.pageItems).toEqual(items.slice(30, 36));
    act(() => result.current.paginationProps.onPageSize(25));
    expect(result.current.pageItems).toHaveLength(25);
    const again = renderHook(() => usePagination(items, 'essai'));
    expect(again.result.current.paginationProps.pageSize).toBe(25);
  });

  it('revient à la première page quand un filtre change', () => {
    let filter = 'a';
    const { result, rerender } = renderHook(() => usePagination(items, 'filtre', [filter]));
    act(() => result.current.paginationProps.onPage(2));
    expect(result.current.paginationProps.page).toBe(2);
    filter = 'b';
    rerender();
    expect(result.current.paginationProps.page).toBe(0);
  });

  it('changer de page par les boutons', () => {
    let page = 0;
    render(<Pagination {...props({ onPage: (p) => (page = p) })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Page 3' }));
    expect(page).toBe(2);
  });
});
