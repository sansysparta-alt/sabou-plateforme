import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { Verdict } from '@sabou/qr';
import VerdictView, { groupDigest } from './VerdictView';

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
  digest: '161b8c580ca7a313286550fb9707c228ac35c0d32954ecb13f881d1ca439806a',
  kid: 'test-01234567',
  revocationChecked: false,
} as const;

describe('VerdictView (R-QR-05)', () => {
  it('empreinte SHA-3 repliée sous « Détails techniques », complète, en blocs de 4', () => {
    const { container } = render(
      <VerdictView verdict={{ color: 'vert', status: 'authentique', ...valid }} />,
    );
    const details = container.querySelector('details');
    expect(details?.open).toBe(false);
    expect(details?.querySelector('summary')?.textContent).toBe('Détails techniques');
    const grouped =
      '161b 8c58 0ca7 a313 2865 50fb 9707 c228 ac35 c0d3 2954 ecb1 3f88 1d1c a439 806a';
    expect(details?.textContent).toContain(grouped);
    expect(groupDigest(valid.digest).replace(/ /g, '')).toBe(valid.digest);
  });

  it('vert : authentique, avec la fiche du titulaire et l’empreinte SHA-3', () => {
    const { container } = render(
      <VerdictView verdict={{ color: 'vert', status: 'authentique', ...valid }} />,
    );
    expect(container.querySelector('[data-color="vert"]')).not.toBeNull();
    expect(screen.getByText('✓ Vert : certificat authentique')).toBeTruthy();
    expect(screen.getByText('Mamadou Exemple')).toBeTruthy();
    expect(screen.getByText('02/11/2026 au 01/11/2027')).toBeTruthy();
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
