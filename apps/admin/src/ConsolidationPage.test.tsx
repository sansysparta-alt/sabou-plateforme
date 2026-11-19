// US-043 : écran de consolidation régionale. API simulée ; les règles elles-mêmes (régional
// de la région seul, motif, retour à l'étape 2) sont prouvées par la base
// (packages/db/test/decision-etape-3.test.ts) et de bout en bout (e2e/consolidation.spec.ts).
// Le fonctionnement commun de la file (pagination, focus, refus de l'API, annulation) est
// couvert par FieldVerificationPage.test.tsx.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ConsolidationItem } from '@sabou/types';
import { ConsolidationPage } from './ConsolidationPage';
import { openDossier } from './test-dossier';

const verified: ConsolidationItem = {
  code: 'DS-3001',
  praticien: 'PR-3001',
  praticienNom: 'Mariama Soumah',
  specialite: 'Phytothérapie',
  prefecture: 'Pita',
  type: 'initial',
  verifieLe: '2026-11-10T10:00:00Z',
  visiteRealisee: true,
};
const renewal: ConsolidationItem = {
  ...verified,
  code: 'DS-3002',
  praticien: 'PR-3002',
  praticienNom: 'Sékou Kourouma',
  prefecture: 'Labé',
  type: 'renouvellement',
  visiteRealisee: false,
};

const LIST = '/api/dossiers/consolidation';
let decisions: { url: string; body: unknown }[];

function mockApi(elements: ConsolidationItem[], answer = { code: 'DS-3001', etape: 4 }) {
  decisions = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        decisions.push({ url, body: JSON.parse(String(init.body)) });
        return Response.json(answer);
      }
      // Première page à la taille par défaut ; un dossier décidé n'est plus renvoyé
      if (url !== `${LIST}?limite=10`) return new Response(null, { status: 404 });
      const left = elements.filter((e) => !decisions.some((d) => d.url.includes(`/${e.code}/`)));
      return Response.json({ elements: left, suivant: null, total: left.length });
    }),
  );
}

beforeEach(() => mockApi([verified, renewal]));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const item = async (code: string) => await openDossier(new RegExp(code));

describe('Liste des dossiers à l’étape 3', () => {
  it('montre la préfecture de chaque dossier de la région et l’état de la visite', async () => {
    render(<ConsolidationPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Consolidation régionale' }));
    const first = await item('DS-3001');
    expect(within(first).getByText('Pita'));
    expect(within(first).getByText('Réalisée, compte rendu signé'));
    const second = await item('DS-3002');
    expect(within(second).getByText('Renouvellement'));
    expect(within(second).getByText('Aucune visite enregistrée'));
  });

  it('chaque dossier peut être validé ou rejeté', async () => {
    render(<ConsolidationPage />);
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
    render(<ConsolidationPage />);
    expect(await screen.findByText('Aucun dossier en attente de consolidation.'));
  });
});

describe('Critère : validation → étape 4', () => {
  it('envoie l’étape 3, retire le dossier et annonce l’expertise du Comité', async () => {
    render(<ConsolidationPage />);
    fireEvent.click(within(await item('DS-3001')).getByRole('button', { name: /^Valider/ }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: /DS-3001/ })).toBeNull());
    expect(decisions).toEqual([
      { url: '/api/dossiers/DS-3001/decision', body: { etape: 3, decision: 'valide' } },
    ]);
    expect(screen.getByRole('status').textContent).toBe(
      'Dossier DS-3001 validé : il passe à l’expertise du Comité scientifique.',
    );
    expect(document.activeElement).toBe(
      screen.getByRole('heading', { name: 'Dossiers à consolider' }),
    );
  });
});

describe('Critère : rejet avec motif obligatoire → retour à l’étape 2', () => {
  it('sans motif : erreur liée au champ, rien n’est envoyé', async () => {
    render(<ConsolidationPage />);
    const card = await item('DS-3002');
    fireEvent.click(within(card).getByRole('button', { name: /^Rejeter/ }));
    const motif = within(card).getByLabelText('Motif du rejet');
    expect(within(card).getByText(/revient à l’admin préfectoral/));
    fireEvent.click(within(card).getByRole('button', { name: 'Confirmer le rejet' }));
    expect(motif.getAttribute('aria-invalid')).toBe('true');
    expect(decisions).toEqual([]);
  });

  it('avec motif : envoie l’étape 3 et le motif, annonce le retour à la vérification', async () => {
    mockApi([verified, renewal], { code: 'DS-3002', etape: 2 });
    render(<ConsolidationPage />);
    const card = await item('DS-3002');
    fireEvent.click(within(card).getByRole('button', { name: /^Rejeter/ }));
    fireEvent.change(within(card).getByLabelText('Motif du rejet'), {
      target: { value: ' Compte rendu de visite incomplet ' },
    });
    fireEvent.click(within(card).getByRole('button', { name: 'Confirmer le rejet' }));
    await waitFor(() => expect(screen.queryByRole('heading', { name: /DS-3002/ })).toBeNull());
    expect(decisions).toEqual([
      {
        url: '/api/dossiers/DS-3002/decision',
        body: { etape: 3, decision: 'rejete', motif: 'Compte rendu de visite incomplet' },
      },
    ]);
    expect(screen.getByRole('status').textContent).toBe(
      'Dossier DS-3002 rejeté : il revient à la vérification terrain.',
    );
  });
});
