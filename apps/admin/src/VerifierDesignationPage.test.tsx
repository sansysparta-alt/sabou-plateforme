// US-040d : écran « Agents de vérification » de l'admin régional. API simulée ; les règles
// (rôle, région, auteur exclu, étapes, visibilité, étape 2) sont prouvées par la base
// (packages/db/test/verificateur-designe.test.ts) et par l'API
// (apps/api/src/field-dossiers/field-dossiers.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { FieldDossierDesignations } from '@sabou/types';
import { VerifierDesignationPage } from './VerifierDesignationPage';

const DATA: FieldDossierDesignations = {
  dossiers: [
    {
      code: 'DS-000042',
      praticien: 'Saliou Diallo',
      prefecture: 'Labé',
      etape: 2,
      auteur: 'Ibrahima Sow',
      auteurId: 3,
      verificateur: null,
    },
  ],
  agents: [
    { id: 3, nom: 'Ibrahima Sow', prefecture: 'Labé' },
    { id: 9, nom: 'Oumar Baldé', prefecture: 'Mali' },
  ],
};
const DESIGNATED: FieldDossierDesignations = {
  ...DATA,
  dossiers: [
    { ...DATA.dossiers[0]!, verificateur: { id: 9, nom: 'Oumar Baldé', prefecture: 'Mali' } },
  ],
};

type Answer = { status: number; body?: unknown };
let answers: Record<string, Answer[]>;
const calls: { method: string; path: string; body: unknown }[] = [];

beforeEach(() => {
  calls.length = 0;
  answers = {
    'GET /api/dossiers-terrain/designations': [
      { status: 200, body: DATA },
      { status: 200, body: DESIGNATED },
    ],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body = typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : null;
      calls.push({ method, path, body });
      const answer = answers[`${method} ${path}`]?.shift() ?? { status: 204 };
      return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
        status: answer.status,
      });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const card = async () =>
  within((await screen.findByRole('heading', { level: 3, name: /Saliou Diallo/ })).closest('li')!);

describe('Agents de vérification (admin régional)', () => {
  it('liste le dossier, son auteur et l’absence de désignation', async () => {
    render(<VerifierDesignationPage />);
    const dossier = await card();
    expect(dossier.getByText('Ibrahima Sow')).toBeTruthy();
    expect(dossier.getByText('2 · vérification terrain')).toBeTruthy();
    expect(dossier.getByText('Un agent de la préfecture, autre que l’auteur')).toBeTruthy();
  });

  it('l’auteur ne figure pas parmi les agents proposés', async () => {
    render(<VerifierDesignationPage />);
    const select = (await card()).getByLabelText('Désigner un agent');
    const options = within(select)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).toEqual(['Choisir…', 'Oumar Baldé · Mali']);
  });

  it('sans choix, message sous le champ et aucun appel', async () => {
    render(<VerifierDesignationPage />);
    const dossier = await card();
    fireEvent.click(dossier.getByRole('button', { name: 'Désigner' }));
    expect(await dossier.findByText('Choisissez un agent.')).toBeTruthy();
    expect(calls.filter((c) => c.method === 'POST')).toEqual([]);
  });

  it('désigne l’agent, annonce le résultat et affiche la désignation', async () => {
    render(<VerifierDesignationPage />);
    const dossier = await card();
    fireEvent.change(dossier.getByLabelText('Désigner un agent'), { target: { value: '9' } });
    fireEvent.click(dossier.getByRole('button', { name: 'Désigner' }));
    expect(await screen.findByText(/Oumar Baldé est désigné pour la vérification/)).toBeTruthy();
    expect(calls).toContainEqual({
      method: 'POST',
      path: '/api/dossiers-terrain/DS-000042/verificateur',
      body: { agentId: 9 },
    });
    expect(await (await card()).findByText('Agent désigné')).toBeTruthy();
  });

  it('refus de l’API affiché sous le champ', async () => {
    answers['POST /api/dossiers-terrain/DS-000042/verificateur'] = [
      { status: 409, body: { error: 'not_designable', message: 'Désignation impossible : test.' } },
    ];
    render(<VerifierDesignationPage />);
    const dossier = await card();
    fireEvent.change(dossier.getByLabelText('Désigner un agent'), { target: { value: '9' } });
    fireEvent.click(dossier.getByRole('button', { name: 'Désigner' }));
    expect(await dossier.findByText('Désignation impossible : test.')).toBeTruthy();
  });
});
