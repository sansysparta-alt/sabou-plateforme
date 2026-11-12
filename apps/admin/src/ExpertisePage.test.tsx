// US-044 : écran d'expertise du Comité scientifique. API simulée ; les règles elles-mêmes
// (Comité seul, motif, retour à l'étape 3) sont prouvées par la base
// (packages/db/test/decision-etape-4.test.ts) et de bout en bout (e2e/expertise.spec.ts).
// Le fonctionnement commun de la file (pagination, focus, refus de l'API, annulation) est
// couvert par FieldVerificationPage.test.tsx.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ExpertiseItem } from '@sabou/types';
import { ExpertisePage } from './ExpertisePage';

const verified: ExpertiseItem = {
  code: 'DS-3001',
  praticien: 'PR-3001',
  praticienNom: 'Mariama Soumah',
  specialite: 'Phytothérapie',
  prefecture: 'Pita',
  region: 'Mamou',
  type: 'initial',
  consolideLe: '2026-11-11T10:00:00Z',
  visiteRealisee: true,
};
const renewal: ExpertiseItem = {
  ...verified,
  code: 'DS-3002',
  praticien: 'PR-3002',
  praticienNom: 'Sékou Kourouma',
  prefecture: 'Kankan',
  region: 'Kankan',
  type: 'renouvellement',
  visiteRealisee: false,
};

const LIST = '/api/dossiers/expertise';
let decisions: { url: string; body: unknown }[];

function mockApi(elements: ExpertiseItem[], answer = { code: 'DS-3001', etape: 5 }) {
  decisions = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        decisions.push({ url, body: JSON.parse(String(init.body)) });
        return Response.json(answer);
      }
      return url === LIST
        ? Response.json({ elements, suivant: null })
        : new Response(null, { status: 404 });
    }),
  );
}

beforeEach(() => mockApi([verified, renewal]));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const item = async (code: string) =>
  (await screen.findByRole('heading', { level: 3, name: new RegExp(code) })).closest('li')!;

describe('Liste des dossiers à l’étape 4', () => {
  it('montre la zone de chaque dossier, toutes régions, et l’état de la visite', async () => {
    render(<ExpertisePage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Expertise des dossiers' }));
    const first = await item('DS-3001');
    expect(within(first).getByText('Pita, région de Mamou'));
    expect(within(first).getByText('Réalisée, compte rendu signé'));
    const second = await item('DS-3002');
    expect(within(second).getByText('Kankan, région de Kankan'));
    expect(within(second).getByText('Renouvellement'));
    expect(within(second).getByText('Aucune visite enregistrée'));
  });

  it('chaque dossier peut être validé ou rejeté', async () => {
    render(<ExpertisePage />);
    for (const [code, name] of [
      ['DS-3001', 'Mariama Soumah'],
      ['DS-3002', 'Sékou Kourouma'],
    ]) {
      const card = await item(code!);
      expect(within(card).getByRole('button', { name: `Valider le dossier ${code}, ${name}` }));
      expect(within(card).getByRole('button', { name: `Rejeter le dossier ${code}, ${name}` }));
    }
  });

  it('liste vide : message explicite', async () => {
    mockApi([]);
    render(<ExpertisePage />);
    expect(await screen.findByText('Aucun dossier en attente d’expertise.'));
  });
});

describe('Critère : validation → étape 5', () => {
  it('envoie l’étape 4, retire le dossier et annonce l’approbation de la DG', async () => {
    render(<ExpertisePage />);
    fireEvent.click(within(await item('DS-3001')).getByRole('button', { name: /^Valider/ }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: /DS-3001/ })).toBeNull());
    expect(decisions).toEqual([
      { url: '/api/dossiers/DS-3001/decision', body: { etape: 4, decision: 'valide' } },
    ]);
    expect(screen.getByRole('status').textContent).toBe(
      'Dossier DS-3001 validé : il passe à l’approbation de la Direction Générale.',
    );
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: 'Dossiers à expertiser' }),
    );
  });
});

describe('Critère : rejet avec motif obligatoire → retour à l’étape 3', () => {
  it('sans motif : erreur liée au champ, rien n’est envoyé', async () => {
    render(<ExpertisePage />);
    const card = await item('DS-3002');
    fireEvent.click(within(card).getByRole('button', { name: /^Rejeter/ }));
    const motif = within(card).getByLabelText('Motif du rejet');
    expect(within(card).getByText(/revient à l’admin régional/));
    fireEvent.click(within(card).getByRole('button', { name: 'Confirmer le rejet' }));
    expect(motif.getAttribute('aria-invalid')).toBe('true');
    expect(decisions).toEqual([]);
  });

  it('avec motif : envoie l’étape 4 et le motif, annonce le retour à la consolidation', async () => {
    mockApi([verified, renewal], { code: 'DS-3002', etape: 3 });
    render(<ExpertisePage />);
    const card = await item('DS-3002');
    fireEvent.click(within(card).getByRole('button', { name: /^Rejeter/ }));
    fireEvent.change(within(card).getByLabelText('Motif du rejet'), {
      target: { value: ' Dosage des décoctions à préciser ' },
    });
    fireEvent.click(within(card).getByRole('button', { name: 'Confirmer le rejet' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: /DS-3002/ })).toBeNull());
    expect(decisions).toEqual([
      {
        url: '/api/dossiers/DS-3002/decision',
        body: { etape: 4, decision: 'rejete', motif: 'Dosage des décoctions à préciser' },
      },
    ]);
    expect(screen.getByRole('status').textContent).toBe(
      'Dossier DS-3002 rejeté : il revient à la consolidation régionale.',
    );
  });
});
