// US-101 : litiges et recours dans la gestion. API simulée ; les règles (qui écrit, rend un
// avis, décide ; recours de 30 jours ; effets d'un recours accepté) sont prouvées par la base
// (packages/db/test/litiges.test.ts) et l'API (apps/api/src/disputes/disputes.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { DisputeDetail, DisputeSummary } from '@sabou/types';
import { DirectorDisputesPage, RegionalDisputesPage } from './DisputesPage';
import { openDossier } from './test-dossier';

const recourse: DisputeSummary = {
  code: 'LT-00001',
  type: 'recours',
  objet: 'Contestation du rejet',
  statut: 'ouvert',
  issue: null,
  praticien: 'PR-1042',
  praticienNom: 'Mamadou Diallo',
  prefecture: 'Labé',
  ouvertLe: '2026-11-19T08:00:00Z',
  recoursJusquau: '2026-12-14',
};
const ordinary: DisputeSummary = {
  ...recourse,
  code: 'LT-00002',
  type: 'autre',
  objet: 'Photo refusée à l’étape 1',
  recoursJusquau: null,
};
const detailOf = (summary: DisputeSummary, change: Partial<DisputeDetail> = {}): DisputeDetail => ({
  ...summary,
  messages: [
    {
      id: 1,
      auteur: 'praticien',
      auteurNom: 'Mamadou Diallo',
      contenu: 'La pièce est authentique ; voici l’attestation de la mairie.',
      le: '2026-11-19T08:00:00Z',
    },
  ],
  pieces: [
    {
      id: 7,
      mime: 'image/jpeg',
      taille: 2048,
      parPraticien: true,
      deposeLe: '2026-11-19T08:01:00Z',
    },
  ],
  rejetMotif: summary.type === 'recours' ? 'Pièce falsifiée' : null,
  avisSens: null,
  avis: null,
  avisLe: null,
  decision: null,
  decideLe: null,
  certificat: null,
  ...change,
});

let queue: DisputeSummary[];
let details: Record<string, DisputeDetail>;
let posts: { url: string; body: unknown }[];

beforeEach(() => {
  posts = [];
  queue = [recourse, ordinary];
  details = { 'LT-00001': detailOf(recourse), 'LT-00002': detailOf(ordinary) };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        if (url.endsWith('/decision')) {
          return Response.json({
            certificat: url.includes('LT-00001') ? 'SAB-2026-PR1042-ABC' : null,
          });
        }
        return new Response(null, { status: 204 });
      }
      if (url.startsWith('/api/litiges/a-arbitrer')) {
        return Response.json({ elements: queue, suivant: null, total: queue.length });
      }
      const code = /^\/api\/litiges\/(LT-\d{5})$/.exec(url)?.[1];
      if (code && details[code]) return Response.json(details[code]);
      return new Response(null, { status: 404 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Critère 1 : pièces et échanges', () => {
  it('le panneau montre le rejet contesté, les échanges et les pièces à télécharger', async () => {
    render(<RegionalDisputesPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Litiges et recours' }));
    const row = await openDossier(/LT-00001/);
    expect(await within(row).findByText(/voici l’attestation de la mairie/));
    expect(within(row).getByText('Pièce falsifiée'));
    const link = within(row).getByRole('link', { name: /Photo n° 7/ });
    expect(link.getAttribute('href')).toBe('/api/litiges/LT-00001/pieces/7');
  });

  it('message à envoyer : vide, erreur sous le champ ; sinon envoyé puis relu', async () => {
    render(<RegionalDisputesPage />);
    const row = await openDossier(/LT-00002/);
    await within(row).findByText(/voici l’attestation/);
    fireEvent.click(within(row).getByRole('button', { name: 'Envoyer le message' }));
    expect(within(row).getByText('Écrivez votre message.'));
    expect(posts).toEqual([]);
    fireEvent.change(within(row).getByLabelText(/Votre message au praticien/), {
      target: { value: '  Merci de joindre la photo refaite.  ' },
    });
    fireEvent.click(within(row).getByRole('button', { name: 'Envoyer le message' }));
    await waitFor(() =>
      expect(posts).toEqual([
        {
          url: '/api/litiges/LT-00002/messages',
          body: { contenu: 'Merci de joindre la photo refaite.' },
        },
      ]),
    );
  });
});

describe('Critère 2 et décision motivée', () => {
  it('régional, recours : avis motivé (pas de décision), le recours passe à la DG', async () => {
    render(<RegionalDisputesPage />);
    const row = await openDossier(/LT-00001/);
    await within(row).findByText(/voici l’attestation/);
    expect(within(row).queryByRole('heading', { name: /Décision/ })).toBeNull();
    fireEvent.click(within(row).getByRole('button', { name: /Rendre l’avis/ }));
    expect(within(row).getByText('Choisissez le sens de l’avis.'));
    expect(within(row).getByText('Motivez votre avis.'));
    fireEvent.change(within(row).getByLabelText(/Sens de l’avis/), {
      target: { value: 'favorable' },
    });
    fireEvent.change(within(row).getByLabelText(/Motivation/), {
      target: { value: 'Attestation de la mairie vérifiée.' },
    });
    fireEvent.click(within(row).getByRole('button', { name: /Rendre l’avis/ }));
    await waitFor(() =>
      expect(posts).toEqual([
        {
          url: '/api/litiges/LT-00001/avis',
          body: { sens: 'favorable', avis: 'Attestation de la mairie vérifiée.' },
        },
      ]),
    );
    expect(await screen.findByText(/il passe à la décision de la DG/));
  });

  it('régional, litige ordinaire : décision motivée', async () => {
    render(<RegionalDisputesPage />);
    const row = await openDossier(/LT-00002/);
    await within(row).findByText(/voici l’attestation/);
    fireEvent.change(within(row).getByLabelText(/Votre décision/), {
      target: { value: 'accepte' },
    });
    fireEvent.change(within(row).getByLabelText(/^Motif/), {
      target: { value: 'Photo refaite : la pièce est lisible.' },
    });
    fireEvent.click(within(row).getByRole('button', { name: /Enregistrer la décision/ }));
    await waitFor(() =>
      expect(posts).toEqual([
        {
          url: '/api/litiges/LT-00002/decision',
          body: { issue: 'accepte', motif: 'Photo refaite : la pièce est lisible.' },
        },
      ]),
    );
    expect(await screen.findByText(/Litige LT-00002 accepté ; le praticien est prévenu par SMS/));
  });

  it('DG, recours avec avis : l’avis est lu ; accepter dit les effets et annonce le certificat', async () => {
    queue = [{ ...recourse, statut: 'avis_rendu' }];
    details['LT-00001'] = detailOf(queue[0]!, {
      avisSens: 'favorable',
      avis: 'Attestation vérifiée.',
      avisLe: '2026-11-20T08:00:00Z',
    });
    render(<DirectorDisputesPage />);
    expect(await screen.findByRole('heading', { level: 2, name: /Recours en cours/ }));
    const row = await openDossier(/LT-00001/);
    expect(await within(row).findByText(/Favorable au recours : Attestation vérifiée/));
    fireEvent.change(within(row).getByLabelText(/Votre décision/), {
      target: { value: 'accepte' },
    });
    expect(within(row).getByText(/un nouveau certificat signé est émis/));
    fireEvent.change(within(row).getByLabelText(/^Motif/), { target: { value: 'Recours fondé.' } });
    fireEvent.click(within(row).getByRole('button', { name: /Enregistrer la décision/ }));
    expect(await screen.findByText(/Nouveau certificat : SAB-2026-PR1042-ABC/));
  });

  it('DG, recours encore en instruction : pas de décision possible', async () => {
    queue = [recourse];
    render(<DirectorDisputesPage />);
    const row = await openDossier(/LT-00001/);
    await within(row).findByText(/voici l’attestation/);
    expect(within(row).queryByLabelText(/Votre décision/)).toBeNull();
    expect(within(row).queryByRole('button', { name: /Rendre l’avis/ })).toBeNull();
  });
});
