import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Verdict } from '@sabou/qr';
import VerdictView from './VerdictView';

afterEach(cleanup);

const certificate = {
  number: 'GN-CERT-2026-000123',
  practitioner: 'Mamadou Exemple',
  issuedOn: '2026-11-02',
  expiresOn: '2027-11-01',
  authority: 'Direction générale SABOU',
};
const valid = {
  certificate,
  digest: 'ab'.repeat(32),
  kid: 'test-01234567',
  revocationChecked: false,
} as const;

describe('VerdictView (R-QR-05)', () => {
  it('vert : authentique, avec la fiche du titulaire et l’empreinte SHA-3', () => {
    const { container } = render(
      <VerdictView verdict={{ color: 'vert', status: 'authentique', ...valid }} />,
    );
    expect(container.querySelector('[data-color="vert"]')).not.toBeNull();
    expect(screen.getByText('✓ Vert : certificat authentique')).toBeTruthy();
    expect(screen.getByText('Mamadou Exemple')).toBeTruthy();
    expect(screen.getByText('02/11/2026 au 01/11/2027')).toBeTruthy();
    expect(screen.getByText('ab'.repeat(32))).toBeTruthy();
    expect(screen.getByText(/révocation du certificat ne se vérifie qu’en ligne/)).toBeTruthy();
  });

  it('ambre : expiré, avec la date', () => {
    render(<VerdictView verdict={{ color: 'ambre', status: 'expire', ...valid }} />);
    expect(
      screen.getByText(/Ambre : certificat authentique mais expiré le 01\/11\/2027/),
    ).toBeTruthy();
  });

  it.each<[Extract<Verdict, { color: 'rouge' }>['status'], RegExp]>([
    ['falsifie', /falsifié ou illisible/],
    ['cle_inconnue', /clé inconnue/],
    ['cle_revoquee', /clé .* a été révoquée/],
  ])('rouge « %s » : aucune donnée du QR n’est affichée', (status, message) => {
    const { container } = render(<VerdictView verdict={{ color: 'rouge', status }} />);
    expect(container.querySelector('[data-color="rouge"]')).not.toBeNull();
    expect(screen.getByText('✗ Rouge : non authentique')).toBeTruthy();
    expect(screen.getByText(message)).toBeTruthy();
    expect(container.querySelector('dl')).toBeNull();
  });
});
