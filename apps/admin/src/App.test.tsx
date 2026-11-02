import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { App } from './App';

afterEach(cleanup);

describe('App', () => {
  it('affiche le titre de l’application de gestion', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('SABOU — Administration');
  });
});
