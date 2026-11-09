import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SignupFlow from './SignupFlow';

// Parcours d'inscription (lot D : US-014) avec l'API simulée ; le parcours réel (API,
// Keycloak, base) est couvert par e2e/inscription.spec.ts.
type Answer = { status: number; body?: unknown };
let answers: Record<string, Answer[]>;
const calls: { path: string; body: unknown }[] = [];

beforeEach(() => {
  calls.length = 0;
  answers = {};
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const path = url.replace('/api/inscription/', '');
      calls.push({ path, body: JSON.parse(String(init.body)) });
      const answer = answers[path]?.shift() ?? { status: 500 };
      return new Response(answer.body === undefined ? '' : JSON.stringify(answer.body), {
        status: answer.status,
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

async function reachCodeStep() {
  answers.code = [{ status: 202 }];
  render(<SignupFlow />);
  fill(/^numéro de téléphone$/i, '+224 621 23 45 67');
  submit(/recevoir le code/i);
  await screen.findByRole('heading', { name: /code reçu par sms/i });
}

describe('Inscription du citoyen', () => {
  it('envoie le numéro sous sa forme nationale et annonce l’étape du code', async () => {
    await reachCodeStep();
    expect(calls).toEqual([{ path: 'code', body: { phone: '621234567' } }]);
    expect(screen.getByText(/au 621 23 45 67/)).toBeTruthy();
    // Le focus passe sur le titre de l'étape (lecteurs d'écran). Il est donné par un effet,
    // après l'affichage du titre : on l'attend, sinon le test échoue sur une machine lente
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 2 })),
    );
  });

  it('refuse un numéro non guinéen sans appeler l’API', () => {
    render(<SignupFlow />);
    fill(/^numéro de téléphone$/i, '301 23 45 67');
    submit(/recevoir le code/i);
    expect(screen.getByRole('alert').textContent).toMatch(/mobile guinéen/);
    expect(screen.getByLabelText(/^numéro de téléphone$/i).getAttribute('aria-invalid')).toBe(
      'true',
    );
    expect(calls).toHaveLength(0);
  });

  it('crée le compte après le code, le prénom et le mot de passe, puis propose de se connecter', async () => {
    await reachCodeStep();
    answers.verification = [{ status: 200, body: { status: 'new', ticket: 't'.repeat(43) } }];
    fill(/^code$/i, '042917');
    submit(/valider le code/i);
    await screen.findByRole('heading', { name: /profil et votre mot de passe/i });

    answers.compte = [{ status: 200, body: { status: 'created' } }];
    fill(/^prénom$/i, 'Aïssatou');
    fill(/^mot de passe$/i, '40718293');
    submit(/créer mon compte/i);
    await screen.findByRole('heading', { name: /compte est créé/i });
    expect(calls.at(-1)).toEqual({
      path: 'compte',
      body: {
        ticket: 't'.repeat(43),
        profile: 'citoyen',
        firstName: 'Aïssatou',
        password: '40718293',
      },
    });
    expect(screen.getByRole('link', { name: /se connecter/i }).getAttribute('href')).toBe(
      '/auth/citoyen/login?returnTo=%2Fcompte&identifiant=621234567',
    );
  });

  it('inscrit un praticien avec son nom (US-040a), puis le renvoie vers l’application', async () => {
    await reachCodeStep();
    answers.verification = [{ status: 200, body: { status: 'new', ticket: 't'.repeat(43) } }];
    fill(/^code$/i, '042917');
    submit(/valider le code/i);
    await screen.findByRole('heading', { name: /profil et votre mot de passe/i });

    expect(screen.queryByLabelText(/^nom$/i)).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: /praticien/i }));
    fill(/^prénom$/i, 'Fanta');
    fill(/^mot de passe$/i, '40718293');
    submit(/créer mon compte/i);
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Indiquez votre nom.');

    answers.compte = [{ status: 200, body: { status: 'created' } }];
    fill(/^nom$/i, 'Camara');
    submit(/créer mon compte/i);
    await screen.findByRole('heading', { name: /compte est créé/i });
    expect(calls.at(-1)).toEqual({
      path: 'compte',
      body: {
        ticket: 't'.repeat(43),
        profile: 'praticien',
        firstName: 'Fanta',
        lastName: 'Camara',
        password: '40718293',
      },
    });
    expect(screen.getByText(/revenez dans l’application mobile sabou/i)).toBeTruthy();
  });

  it('coche « Praticien » d’office quand l’application ouvre ?profil=praticien', async () => {
    window.history.replaceState(null, '', '/inscription?profil=praticien');
    try {
      await reachCodeStep();
      answers.verification = [{ status: 200, body: { status: 'new', ticket: 't'.repeat(43) } }];
      fill(/^code$/i, '042917');
      submit(/valider le code/i);
      await screen.findByRole('heading', { name: /profil et votre mot de passe/i });
      expect(screen.getByRole('radio', { name: /praticien/i })).toHaveProperty('checked', true);
      expect(screen.getByLabelText(/^nom$/i)).toBeTruthy();
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });

  it('propose de se connecter quand le numéro est déjà inscrit (critère 2)', async () => {
    await reachCodeStep();
    answers.verification = [{ status: 200, body: { status: 'existing' } }];
    fill(/^code$/i, '042917');
    submit(/valider le code/i);
    await screen.findByRole('heading', { name: /déjà un compte/i });
    expect(screen.getByRole('link', { name: /se connecter/i }).getAttribute('href')).toContain(
      'identifiant=621234567',
    );
  });

  it('affiche les essais restants après un mauvais code', async () => {
    await reachCodeStep();
    answers.verification = [
      {
        status: 400,
        body: { error: 'code_invalid', message: 'Code incorrect.', remainingAttempts: 4 },
      },
    ];
    fill(/^code$/i, '000000');
    submit(/valider le code/i);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Code incorrect. Il vous reste 4 essais.',
    );
  });

  it('dit combien de temps attendre quand la limite d’envoi est atteinte', async () => {
    answers.code = [
      { status: 429, body: { error: 'too_many', message: 'Trop de demandes.', retryAfter: 1800 } },
    ];
    render(<SignupFlow />);
    fill(/^numéro de téléphone$/i, '621234567');
    submit(/recevoir le code/i);
    expect((await screen.findByRole('alert')).textContent).toBe(
      'Trop de demandes. Réessayez dans 30 minutes.',
    );
  });

  it('refuse un mot de passe trop faible avant l’envoi', async () => {
    await reachCodeStep();
    answers.verification = [{ status: 200, body: { status: 'new', ticket: 't'.repeat(43) } }];
    fill(/^code$/i, '042917');
    submit(/valider le code/i);
    await screen.findByRole('heading', { name: /mot de passe/i });
    fill(/^prénom$/i, 'Awa');
    fill(/^mot de passe$/i, '12345678');
    submit(/créer mon compte/i);
    expect(screen.getByRole('alert').textContent).toMatch(/trop facile/);
    expect(calls.map((c) => c.path)).toEqual(['code', 'verification']);
  });

  it('signale un réseau indisponible sans perdre la saisie', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    render(<SignupFlow />);
    fill(/^numéro de téléphone$/i, '621234567');
    submit(/recevoir le code/i);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/réseau/));
    expect((screen.getByLabelText(/^numéro de téléphone$/i) as HTMLInputElement).value).toBe(
      '621234567',
    );
  });
});
