import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import HomePage from './page';

afterEach(cleanup);

describe('HomePage', () => {
  it('affiche le nom de la plateforme', () => {
    render(<HomePage />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('SABOU');
  });
});
