// US-100 : page publique /signaler, avec l'API simulée (règles de l'API :
// apps/api/src/health-reports/health-reports.test.ts ; base : packages/db/test/signalements.test.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ReportForm from './ReportForm';
import ReportPage from './page';

let answer: { status: number; body?: unknown; headers?: Record<string, string> };
const calls: unknown[] = [];

beforeEach(() => {
  calls.length = 0;
  answer = { status: 201, body: { reference: 'SIG-00042' } };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
        status: answer.status,
        headers: answer.headers,
      });
    }),
  );
  window.history.replaceState(null, '', '/signaler');
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fillValid() {
  fireEvent.click(screen.getByLabelText(/Un effet indésirable/));
  fireEvent.change(screen.getByLabelText('Code du traitement ou de la plante'), {
    target: { value: 'rec-2041' },
  });
  fireEvent.click(screen.getByLabelText(/^Grave/));
  fireEvent.change(screen.getByLabelText('Ce qui s’est passé'), {
    target: { value: '  Vomissements après la deuxième prise.  ' },
  });
}
const send = () => fireEvent.click(screen.getByRole('button', { name: 'Envoyer le signalement' }));

describe('Signaler un danger, sans compte', () => {
  it('page : titre, rappel de l’urgence, contact facultatif expliqué', () => {
    render(<ReportPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Signaler un danger' }));
    expect(screen.getByText(/centre de santé le plus proche/));
    expect(screen.getByText(/Visible du seul Comité scientifique/));
  });

  it('envoi : saisie nettoyée, référence remise, focus sur le message', async () => {
    render(<ReportForm />);
    fillValid();
    fireEvent.change(screen.getByLabelText(/téléphone ou e-mail/), {
      target: { value: '622 00 00 00' },
    });
    send();
    const done = await screen.findByRole('heading', { name: /signalement est envoyé/ });
    await waitFor(() => expect(document.activeElement).toBe(done));
    expect(screen.getByText('SIG-00042'));
    expect(calls).toEqual([
      {
        url: '/api/signalements',
        body: {
          type: 'effet_indesirable',
          code: 'REC-2041',
          gravite: 'grave',
          description: 'Vomissements après la deuxième prise.',
          contact: '622 00 00 00',
          site: '',
        },
      },
    ]);
  });

  it('code prérempli par le lien', async () => {
    window.history.replaceState(null, '', '/signaler?code=rec-2041');
    render(<ReportForm />);
    await waitFor(() =>
      expect(
        (screen.getByLabelText('Code du traitement ou de la plante') as HTMLInputElement).value,
      ).toBe('REC-2041'),
    );
  });

  it('champs manquants : erreurs reliées aux champs, focus sur le premier, rien n’est envoyé', () => {
    render(<ReportForm />);
    send();
    expect(screen.getByText('Choisissez le type de signalement.'));
    expect(screen.getByText(/Indiquez le code du traitement/));
    expect(screen.getByText('Choisissez la gravité.'));
    const description = screen.getByLabelText('Ce qui s’est passé');
    expect(description.getAttribute('aria-invalid')).toBe('true');
    expect(description.getAttribute('aria-describedby')).toContain('description-erreur');
    expect(document.activeElement?.getAttribute('name')).toBe('type');
    expect(calls).toEqual([]);
  });

  it('code inconnu : message de l’API sous le champ ; limite atteinte : délai dit', async () => {
    render(<ReportForm />);
    fillValid();
    answer = {
      status: 400,
      body: {
        error: 'invalid',
        message: 'Aucun traitement ni aucune plante publiés ne portent ce code. Vérifiez-le.',
      },
    };
    send();
    expect(await screen.findByText(/ne portent ce code/));
    expect(
      screen.getByLabelText('Code du traitement ou de la plante').getAttribute('aria-invalid'),
    ).toBe('true');
    answer = { status: 429, body: { error: 'too_many' }, headers: { 'retry-after': '1800' } };
    send();
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Trop de signalements envoyés. Réessayez dans 30 minutes.',
    );
  });

  it('le leurre est hors du parcours clavier et caché aux lecteurs d’écran', () => {
    render(<ReportForm />);
    const trap = document.querySelector<HTMLInputElement>('input[name="site"]')!;
    expect(trap.tabIndex).toBe(-1);
    expect(trap.closest('[aria-hidden="true"]')).not.toBeNull();
  });
});
