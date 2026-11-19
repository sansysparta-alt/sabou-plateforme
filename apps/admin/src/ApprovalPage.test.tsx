// US-045 : écran d'approbation de la DG et page du certificat. API simulée ; les règles
// (DG seule, étape 5, 12 mois, renouvellement) sont prouvées par la base
// (packages/db/test/certificat-signe.test.ts), la signature par le coffre et le QR vert de
// bout en bout (e2e/approbation.spec.ts). Le fonctionnement commun de la file (pagination,
// focus, rejet avec motif) est couvert par FieldVerificationPage.test.tsx.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ApprovalItem, CertificateView } from '@sabou/types';
import { ApprovalPage } from './ApprovalPage';
import { CertificatePage } from './CertificatePage';
import { openDossier } from './test-dossier';

const expertised: ApprovalItem = {
  code: 'DS-4001',
  praticien: 'PR-4001',
  praticienNom: 'Mariama Soumah',
  specialite: 'Phytothérapie',
  prefecture: 'Pita',
  region: 'Mamou',
  type: 'initial',
  expertiseLe: '2026-11-12T10:00:00Z',
  visiteRealisee: true,
  certificatActuel: null,
};
const renewal: ApprovalItem = {
  ...expertised,
  code: 'DS-4002',
  praticien: 'PR-1042',
  praticienNom: 'Mamadou Diallo',
  type: 'renouvellement',
  visiteRealisee: false,
  certificatActuel: 'SAB-2026-PR1042-KX7',
};
const CERTIFICATE: CertificateView = {
  numero: 'SAB-2026-PR4001-K7Q',
  statut: 'actif',
  titulaire: 'Mariama Soumah',
  praticien: 'PR-4001',
  specialite: 'Phytothérapie',
  prefecture: 'Pita',
  autorite: 'Direction générale SABOU',
  emisLe: '2026-11-13',
  expireLe: '2027-11-12',
  dossier: 'DS-4001',
  empreinte: 'ab'.repeat(32),
  cle: 'dg-0a1b2c3d',
  qrSvg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
};

let posts: string[];
let approval: Response | (() => Response);
const assign = vi.fn();

function mockApi() {
  posts = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push(url);
        return typeof approval === 'function' ? approval() : approval;
      }
      // Première page à la taille par défaut ; un dossier approuvé n'est plus renvoyé
      if (url === '/api/dossiers/approbation?limite=10') {
        const left = [expertised, renewal].filter(
          (e) => !posts.includes(`/api/dossiers/${e.code}/approbation`),
        );
        return Response.json({ elements: left, suivant: null, total: left.length });
      }
      if (url === `/api/certificats/${CERTIFICATE.numero}`) return Response.json(CERTIFICATE);
      return Response.json({ message: 'Certificat introuvable.' }, { status: 404 });
    }),
  );
  vi.stubGlobal('location', { ...window.location, assign });
}

beforeEach(() => {
  approval = () => Response.json({ code: 'DS-4001', etape: 6, certificat: 'SAB-2026-PR4001-K7Q' });
  assign.mockReset();
  mockApi();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const item = async (code: string) => await openDossier(new RegExp(code));

describe('Approbation des dossiers (étape 5)', () => {
  it('liste les dossiers expertisés ; un renouvellement annonce le certificat qui expirera', async () => {
    render(<ApprovalPage />);
    const first = within(await item('DS-4001'));
    expect(first.getByText('Première certification')).toBeTruthy();
    expect(first.queryByText('Certificat actuel')).toBeNull();
    const second = within(await item('DS-4002'));
    expect(second.getByText('Renouvellement')).toBeTruthy();
    expect(second.getByText(/SAB-2026-PR1042-KX7 \(passera « expiré »/)).toBeTruthy();
  });

  it('approuver émet le certificat puis ouvre sa page à imprimer', async () => {
    render(<ApprovalPage />);
    const dossier = within(await item('DS-4001'));
    fireEvent.click(
      dossier.getByRole('button', {
        name: /Approuver et émettre le certificat du dossier DS-4001/,
      }),
    );
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/certificats/SAB-2026-PR4001-K7Q'));
    expect(posts).toEqual(['/api/dossiers/DS-4001/approbation']);
  });

  it('coffre indisponible : rien n’a été émis, bouton de nouveau actif', async () => {
    approval = () =>
      Response.json(
        { error: 'signer_unavailable', message: 'Texte de l’API, non affiché (5xx).' },
        { status: 503 },
      );
    render(<ApprovalPage />);
    const dossier = within(await item('DS-4001'));
    const button = dossier.getByRole('button', { name: /Approuver et émettre/ });
    fireEvent.click(button);
    expect(await dossier.findByText(/aucun certificat n’a été émis/)).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('pas de bouton « Valider » : à l’étape 5, seul le rejet passe par la décision simple', async () => {
    render(<ApprovalPage />);
    const dossier = within(await item('DS-4001'));
    expect(dossier.queryByRole('button', { name: /^Valider/ })).toBeNull();
    expect(dossier.getByRole('button', { name: /Rejeter le dossier DS-4001/ })).toBeTruthy();
  });
});

describe('Certificat à imprimer', () => {
  it('affiche les données, le QR en image, l’empreinte par blocs et la clé', async () => {
    render(<CertificatePage numero={CERTIFICATE.numero} />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Certificat de tradipraticien' }));
    expect(screen.getByText('SAB-2026-PR4001-K7Q')).toBeTruthy();
    expect(screen.getByText('Actif')).toBeTruthy();
    expect(screen.getByText('13 novembre 2026')).toBeTruthy();
    expect(screen.getByText('12 novembre 2027 inclus')).toBeTruthy();
    const qr = screen.getByRole('img', { name: /QR code signé du certificat SAB-2026-PR4001-K7Q/ });
    // Image, jamais du SVG injecté dans la page
    expect(qr.getAttribute('src')).toMatch(/^data:image\/svg\+xml;charset=utf-8,%3Csvg/);
    expect(screen.getByText(`${'abab '.repeat(15)}abab`)).toBeTruthy();
    expect(screen.getByText('dg-0a1b2c3d')).toBeTruthy();
  });

  it('imprime la page', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    render(<CertificatePage numero={CERTIFICATE.numero} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Imprimer le certificat' }));
    expect(print).toHaveBeenCalled();
  });

  it('certificat inconnu : message de l’API', async () => {
    render(<CertificatePage numero="SAB-2026-PR9999-AAA" />);
    expect(await screen.findByText('Certificat introuvable.')).toBeTruthy();
  });
});
