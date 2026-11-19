// US-069 : mot de passe oublié du citoyen sur le site, avec l'API simulée (règles de l'API :
// apps/api/src/signup/password-reset.test.ts ; parcours réel avec Keycloak :
// e2e-compte/mot-de-passe-oublie.spec.ts).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ResetFlow from './ResetFlow';
import LoginPage from '../connexion/page';

type Answer = { status: number; body?: unknown; headers?: Record<string, string> };
let answers: Record<string, Answer[]>;
const calls: { path: string; body: unknown }[] = [];

beforeEach(() => {
  calls.length = 0;
  answers = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const path = url.replace('/api/mot-de-passe-oublie/', '');
      calls.push({ path, body: JSON.parse(String(init.body)) });
      const answer = answers[path]?.shift() ?? { status: 500 };
      return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
        status: answer.status,
        headers: answer.headers,
      });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function fill(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function submit(name: RegExp) {
  fireEvent.click(screen.getByRole('button', { name }));
}

// Message d'erreur relié au champ (aria-invalid, aria-describedby), ou null
function errorOf(label: RegExp): string | null {
  const field = screen.getByLabelText(label);
  if (field.getAttribute('aria-invalid') !== 'true') return null;
  const ids = field.getAttribute('aria-describedby')?.split(' ') ?? [];
  return (
    ids.map((id) => document.getElementById(id)).find((node) => node?.id.endsWith('-erreur'))
      ?.textContent ?? null
  );
}

async function reachCode() {
  answers.code = [{ status: 202 }];
  render(<ResetFlow />);
  fill(/^numéro de téléphone$/i, '+224 621 23 45 67');
  submit(/recevoir le code/i);
  await screen.findByRole('heading', { name: /code reçu par sms/i });
}

async function reachPassword() {
  await reachCode();
  answers.verification = [{ status: 200, body: { ticket: 't'.repeat(43) } }];
  fill(/^code$/i, '042917');
  submit(/valider le code/i);
  await screen.findByRole('heading', { name: /nouveau mot de passe/i });
}

describe('Critère 1 : numéro, code reçu par SMS, nouveau mot de passe', () => {
  it('enchaîne les trois étapes puis propose de se connecter avec le numéro', async () => {
    await reachPassword();
    answers.nouveau = [{ status: 204 }];
    fill(/^nouveau mot de passe$/i, '40718293');
    submit(/changer le mot de passe/i);
    await screen.findByRole('heading', { name: /mot de passe est changé/i });
    expect(calls).toEqual([
      { path: 'code', body: { phone: '621234567' } },
      { path: 'verification', body: { phone: '621234567', code: '042917' } },
      { path: 'nouveau', body: { ticket: 't'.repeat(43), password: '40718293' } },
    ]);
    expect(screen.getByText(/déconnecté de tous vos appareils/)).toBeTruthy();
    expect(screen.getByRole('link', { name: /se connecter/i }).getAttribute('href')).toBe(
      '/auth/citoyen/login?returnTo=%2Fcompte&identifiant=621234567',
    );
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2 })),
    );
  });

  it('ne dit jamais si le numéro a un compte', async () => {
    await reachCode();
    expect(screen.getByText(/Si le 621 23 45 67 a un compte SABOU/)).toBeTruthy();
  });

  it('numéro non guinéen : erreur sous le champ, aucun appel', () => {
    render(<ResetFlow />);
    fill(/^numéro de téléphone$/i, '301 23 45 67');
    submit(/recevoir le code/i);
    expect(errorOf(/^numéro de téléphone$/i)).toMatch(/mobile guinéen/);
    expect(calls).toHaveLength(0);
  });

  it('mot de passe trop facile : erreur sous le champ, aucun appel', async () => {
    await reachPassword();
    fill(/^nouveau mot de passe$/i, '12345678');
    submit(/changer le mot de passe/i);
    expect(errorOf(/^nouveau mot de passe$/i)).toBe('Ce mot de passe est trop facile à deviner.');
    expect(calls.map((c) => c.path)).toEqual(['code', 'verification']);
  });
});

describe('Critère 2 : code limité', () => {
  it('mauvais code : essais restants sous le champ', async () => {
    await reachCode();
    answers.verification = [
      {
        status: 400,
        body: { error: 'code_invalid', message: 'Code incorrect.', remainingAttempts: 2 },
      },
    ];
    fill(/^code$/i, '000000');
    submit(/valider le code/i);
    await waitFor(() => expect(errorOf(/^code$/i)).toBe('Code incorrect. Il vous reste 2 essais.'));
  });

  it('trop de demandes : délai lu dans Retry-After', async () => {
    answers.code = [
      {
        status: 429,
        body: { error: 'too_many', message: 'Trop de demandes. Réessayez plus tard.' },
        headers: { 'retry-after': '600' },
      },
    ];
    render(<ResetFlow />);
    fill(/^numéro de téléphone$/i, '621234567');
    submit(/recevoir le code/i);
    await waitFor(() =>
      expect(errorOf(/^numéro de téléphone$/i)).toBe(
        'Trop de demandes. Réessayez dans 10 minutes.',
      ),
    );
  });

  it('demande expirée : retour au numéro avec le message', async () => {
    await reachPassword();
    answers.nouveau = [
      {
        status: 400,
        body: {
          error: 'ticket_invalid',
          message: 'Cette demande a expiré. Recommencez avec votre numéro.',
        },
      },
    ];
    fill(/^nouveau mot de passe$/i, '40718293');
    submit(/changer le mot de passe/i);
    await screen.findByText('Cette demande a expiré. Recommencez avec votre numéro.');
    expect(screen.getByLabelText(/^numéro de téléphone$/i)).toBeTruthy();
  });
});

describe('Accès à la page', () => {
  it('la page « Se connecter » mène au mot de passe oublié', async () => {
    render(await LoginPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByRole('link', { name: 'Mot de passe oublié ?' }).getAttribute('href')).toBe(
      '/mot-de-passe-oublie',
    );
  });
});
