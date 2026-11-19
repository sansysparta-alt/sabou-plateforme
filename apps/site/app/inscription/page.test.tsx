// US-068, critère 1 : un praticien qui arrive sur l'inscription du site est invité à installer
// l'application mobile ; le formulaire ne propose plus son profil (SignupFlow.test.tsx).
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import SignupPage from './page';

afterEach(cleanup);

describe('Page d’inscription', () => {
  it('invite le praticien à installer l’application mobile', () => {
    render(<SignupPage />);
    const invitation = screen.getByRole('complementary', {
      name: 'Vous êtes praticien de la médecine traditionnelle ?',
    });
    expect(invitation.textContent).toContain('Installez l’application mobile SABOU');
  });
});
