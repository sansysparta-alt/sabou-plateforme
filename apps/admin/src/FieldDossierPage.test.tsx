// US-040c : écran « Dossiers terrain » de l'admin préfectoral. API simulée ; les règles sont
// prouvées par la base (packages/db/test/dossier-terrain.test.ts) et par l'API
// (apps/api/src/field-dossiers/field-dossiers.test.ts), le parcours complet de bout en bout
// (e2e/dossier-terrain.spec.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { FieldDossier, FieldDossierReferentials } from '@sabou/types';
import { FieldDossierPage } from './FieldDossierPage';

const REFERENTIALS: FieldDossierReferentials = {
  prefecture: 'Labé',
  specialites: [{ id: 1, libelle: 'Phytothérapie' }],
  sousPrefectures: [{ id: 12, nom: 'Popodara' }],
  langues: [{ code: 'pul', nom: 'Pular' }],
};
const DRAFT: FieldDossier = {
  code: 'DS-000042',
  praticien: 'Mamadou Barry',
  telephone: '661234567',
  specialite: 'Phytothérapie',
  creeLe: '2026-11-18T10:00:00.000Z',
  pieces: [
    {
      id: 7,
      type: 'identite',
      typeMime: 'image/jpeg',
      tailleOctets: 1000,
      deposeLe: '2026-11-18T10:05:00.000Z',
    },
  ],
  piecesManquantes: ['photo'],
};

type Answer = { status: number; body?: unknown };
let answers: Record<string, Answer[]>;
const calls: { method: string; path: string; body: unknown }[] = [];

beforeEach(() => {
  calls.length = 0;
  answers = {
    'GET /api/dossiers-terrain/referentiels': [{ status: 200, body: REFERENTIALS }],
    'GET /api/dossiers-terrain': [{ status: 200, body: [DRAFT] }],
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (path: string, init: RequestInit = {}) => {
      const method = init.method ?? 'GET';
      const body =
        typeof init.body === 'string' ? (JSON.parse(init.body) as unknown) : (init.body ?? null);
      calls.push({ method, path, body });
      const answer = answers[`${method} ${path}`]?.shift() ?? { status: 200, body: [DRAFT] };
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

// Message d'erreur relié au champ (aria-describedby), ou null
function errorOf(label: string): string | null {
  const field = screen.getByLabelText(label);
  if (field.getAttribute('aria-invalid') !== 'true') return null;
  const ids = field.getAttribute('aria-describedby')?.split(' ') ?? [];
  return (
    ids.map((id) => document.getElementById(id)).find((n) => n?.id.endsWith('-erreur'))
      ?.textContent ?? null
  );
}

async function openForm() {
  render(<FieldDossierPage />);
  const button = await screen.findByRole('button', { name: 'Nouveau dossier terrain' });
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  fireEvent.click(button);
  return screen.getByRole('region', { name: 'Nouveau dossier terrain' });
}

function fill(form: HTMLElement, label: string, value: string) {
  fireEvent.change(within(form).getByLabelText(label), { target: { value } });
}

describe('Critère 1 : identité, téléphone, spécialité ; préfecture de l’agent', () => {
  it('crée le dossier avec les champs du praticien, sans préfecture envoyée', async () => {
    const form = await openForm();
    expect(within(form).getByText(/préfecture de Labé/)).toBeTruthy();
    fill(form, 'Prénom', 'Mamadou');
    fill(form, 'Nom', 'Barry');
    fill(form, 'Téléphone du praticien', '+224 661 23 45 67');
    fill(form, 'Spécialité', '1');
    fill(form, 'Années d’expérience', '20');
    fill(form, 'Sous-préfecture (facultative)', '12');
    fill(form, 'Langue principale', 'pul');
    answers['POST /api/dossiers-terrain'] = [{ status: 201, body: { code: 'DS-000043' } }];
    fireEvent.click(within(form).getByRole('button', { name: 'Créer le dossier' }));
    await screen.findByText(/Dossier DS-000043 créé pour Mamadou Barry/);
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({
      prenom: 'Mamadou',
      nom: 'Barry',
      telephone: '661234567',
      specialiteId: 1,
      sousPrefectureId: 12,
      languePrincipale: 'pul',
      anneesExperience: 20,
    });
  });

  it('chaque erreur de saisie sous son champ, sans appel', async () => {
    const form = await openForm();
    fill(form, 'Nom', 'Barry2');
    fill(form, 'Téléphone du praticien', '721234567');
    fireEvent.click(within(form).getByRole('button', { name: 'Créer le dossier' }));
    expect(errorOf('Prénom')).toBe('Indiquez votre prénom.');
    expect(errorOf('Nom')).toBe('Le nom ne contient que des lettres.');
    expect(errorOf('Téléphone du praticien')).toMatch(/mobile guinéen/);
    expect(errorOf('Spécialité')).toBe('Choisissez la spécialité.');
    expect(document.activeElement).toBe(screen.getByLabelText('Prénom'));
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
  });

  it('numéro déjà inscrit : le refus de l’API sous le champ du téléphone', async () => {
    const form = await openForm();
    fill(form, 'Prénom', 'Mamadou');
    fill(form, 'Nom', 'Barry');
    fill(form, 'Téléphone du praticien', '661234567');
    fill(form, 'Spécialité', '1');
    fill(form, 'Années d’expérience', '20');
    fill(form, 'Langue principale', 'pul');
    answers['POST /api/dossiers-terrain'] = [
      {
        status: 409,
        body: { error: 'phone_taken', message: 'Ce numéro a déjà un compte SABOU.' },
      },
    ];
    fireEvent.click(within(form).getByRole('button', { name: 'Créer le dossier' }));
    await waitFor(() =>
      expect(errorOf('Téléphone du praticien')).toBe('Ce numéro a déjà un compte SABOU.'),
    );
  });

  it('pièces : liste, pièces manquantes, soumission impossible tant qu’il en manque', async () => {
    render(<FieldDossierPage />);
    const card = (await screen.findByRole('heading', { level: 3, name: /Mamadou Barry/ })).closest(
      'li',
    )!;
    // Ligne repliable des files de dossiers : repères (badge des pièces) et origine du dossier
    expect(within(card).getByText('1 pièce manquante')).toBeTruthy();
    expect(within(card).getByText('Dossier terrain, créé par vous')).toBeTruthy();
    expect(
      within(card).getByText(/Pièces obligatoires manquantes : photo du praticien/),
    ).toBeTruthy();
    const submit = within(card).getByRole('button', { name: /Soumettre le dossier/ });
    expect(submit.hasAttribute('disabled')).toBe(true);
  });

  it('dépose une pièce : le fichier part tel quel vers le dossier', async () => {
    render(<FieldDossierPage />);
    const card = (await screen.findByRole('heading', { level: 3, name: /Mamadou Barry/ })).closest(
      'li',
    )!;
    const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'photo.jpg', {
      type: 'image/jpeg',
    });
    fireEvent.change(within(card).getByLabelText('Type de pièce'), { target: { value: 'photo' } });
    fireEvent.change(within(card).getByLabelText('Fichier'), { target: { files: [file] } });
    answers['POST /api/dossiers-terrain/DS-000042/pieces/photo'] = [
      { status: 201, body: { id: 8 } },
    ];
    fireEvent.click(within(card).getByRole('button', { name: /Ajouter la pièce/ }));
    await screen.findByText('Photo du praticien ajoutée au dossier DS-000042.');
    expect(calls.find((c) => c.path.endsWith('/pieces/photo'))?.body).toBe(file);
  });

  it('dossier complet : soumis, il quitte la liste et l’agent est prévenu', async () => {
    answers['GET /api/dossiers-terrain'] = [
      { status: 200, body: [{ ...DRAFT, piecesManquantes: [] }] },
      { status: 200, body: [] },
    ];
    render(<FieldDossierPage />);
    const card = (await screen.findByRole('heading', { level: 3, name: /Mamadou Barry/ })).closest(
      'li',
    )!;
    answers['POST /api/dossiers-terrain/DS-000042/soumission'] = [
      { status: 200, body: { code: 'DS-000042', etape: 2, soumisLe: '2026-11-18T11:00:00.000Z' } },
    ];
    fireEvent.click(within(card).getByRole('button', { name: /Soumettre le dossier/ }));
    await screen.findByText(/Dossier DS-000042 soumis : il passe à la vérification terrain/);
    await screen.findByText(/Aucun dossier terrain en cours/);
  });
});
