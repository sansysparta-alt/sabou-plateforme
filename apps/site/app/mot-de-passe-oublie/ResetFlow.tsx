'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { PasswordResetVerifyResult, SignupError } from '@sabou/types';
import { citizenPasswordError, formatNationalMobile, toNationalMobile } from '@sabou/types/phone';
import styles from '../Forms.module.css';
import { loginHref } from '../links';

// Mot de passe oublié du citoyen (US-069, §5.2) : numéro → code reçu par SMS → nouveau mot de
// passe. Le site ne dit jamais si le numéro a un compte : le SMS n'arrive que s'il en a un.
// L'API valide tout de nouveau ; les contrôles ici n'évitent que des allers-retours sur un
// réseau lent.

type Step =
  | { name: 'phone' }
  | { name: 'code'; phone: string }
  | { name: 'password'; phone: string; ticket: string }
  | { name: 'done'; phone: string };

type Reply<T> = { ok: true; data: T } | { ok: false; error: SignupError & { retryAfter?: number } };

const NETWORK_ERROR: SignupError = {
  error: 'invalid',
  message: 'Connexion impossible. Vérifiez votre réseau, puis réessayez.',
};

async function send<T>(path: string, body: unknown): Promise<Reply<T>> {
  try {
    const response = await fetch(`/api/mot-de-passe-oublie/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    const data = text ? (JSON.parse(text) as unknown) : null;
    if (response.ok) return { ok: true, data: data as T };
    if (data && typeof data === 'object' && 'error' in data) {
      const retry = Number(response.headers.get('retry-after'));
      return {
        ok: false,
        error: { ...(data as SignupError), ...(retry > 0 ? { retryAfter: retry } : {}) },
      };
    }
    return { ok: false, error: NETWORK_ERROR };
  } catch {
    return { ok: false, error: NETWORK_ERROR };
  }
}

function errorText(error: SignupError & { retryAfter?: number }): string {
  if (error.error === 'too_many' && error.retryAfter) {
    const minutes = Math.ceil(error.retryAfter / 60);
    return `Trop de demandes. Réessayez dans ${minutes} minute${minutes > 1 ? 's' : ''}.`;
  }
  if (error.error === 'code_invalid' && error.remainingAttempts !== undefined) {
    const n = error.remainingAttempts;
    return `Code incorrect. Il vous reste ${n} essai${n > 1 ? 's' : ''}.`;
  }
  return error.message;
}

export default function ResetFlow() {
  const [step, setStep] = useState<Step>({ name: 'phone' });
  // Erreur de l'étape, affichée sous son unique champ et reliée à lui (WCAG 3.3.1)
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const first = useRef(true);

  // À chaque étape, le focus va sur son titre : le lecteur d'écran annonce la suite
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    heading.current?.focus();
  }, [step.name]);

  function go(next: Step, message: string | null = null) {
    setError(null);
    setNotice(message);
    setStep(next);
  }

  async function run(work: () => Promise<void>) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await work();
    } finally {
      setPending(false);
    }
  }

  async function requestCode(phone: string, message: string | null = null) {
    const reply = await send<null>('code', { phone });
    if (reply.ok) go({ name: 'code', phone }, message);
    else setError(errorText(reply.error));
  }

  function onPhone(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const phone = toNationalMobile(String(new FormData(event.currentTarget).get('phone') ?? ''));
    if (!phone) {
      setError('Saisissez un numéro de mobile guinéen : 9 chiffres commençant par 6.');
      return;
    }
    void run(() => requestCode(phone));
  }

  function onCode(event: FormEvent<HTMLFormElement>, phone: string) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get('code') ?? '').trim();
    if (!/^\d{6}$/.test(code)) {
      setError('Le code reçu par SMS compte 6 chiffres.');
      return;
    }
    void run(async () => {
      const reply = await send<PasswordResetVerifyResult>('verification', { phone, code });
      if (reply.ok) go({ name: 'password', phone, ticket: reply.data.ticket });
      else setError(errorText(reply.error));
    });
  }

  function onPassword(event: FormEvent<HTMLFormElement>, phone: string, ticket: string) {
    event.preventDefault();
    const password = String(new FormData(event.currentTarget).get('password') ?? '');
    const refused = citizenPasswordError(password, phone);
    if (refused) {
      setError(refused);
      return;
    }
    void run(async () => {
      const reply = await send<null>('nouveau', { ticket, password });
      if (reply.ok) go({ name: 'done', phone });
      else if (reply.error.error === 'ticket_invalid') go({ name: 'phone' }, reply.error.message);
      else setError(errorText(reply.error));
    });
  }

  const errorId = 'reinitialisation-erreur';
  const fieldProps = (help: string) => ({
    'aria-invalid': error ? true : undefined,
    'aria-describedby': error ? `${help} ${errorId}` : help,
    onChange: () => setError(null),
  });
  const errorBlock = error ? (
    <p id={errorId} className={styles.error} role="alert">
      {error}
    </p>
  ) : null;
  const submit = (label: string) => (
    <button type="submit" className={styles.button} aria-disabled={pending}>
      {pending ? 'Envoi…' : label}
    </button>
  );
  const title = (text: string) => (
    <h2 id="etape" ref={heading} tabIndex={-1} className={styles.heading}>
      {text}
    </h2>
  );

  switch (step.name) {
    case 'phone':
      return (
        <section aria-labelledby="etape">
          {title('Votre numéro de téléphone')}
          {notice ? <p className={styles.notice}>{notice}</p> : null}
          <form className={styles.form} onSubmit={onPhone} noValidate>
            <div className={styles.field}>
              <label htmlFor="phone" className={styles.label}>
                Numéro de téléphone
              </label>
              <input
                id="phone"
                name="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel-national"
                required
                className={styles.input}
                {...fieldProps('phone-aide')}
              />
              <p id="phone-aide" className={styles.help}>
                Le numéro de votre compte, par exemple 621 23 45 67. S’il a un compte SABOU, vous
                recevrez un code par SMS.
              </p>
              {errorBlock}
            </div>
            {submit('Recevoir le code')}
          </form>
        </section>
      );

    case 'code':
      return (
        <section aria-labelledby="etape">
          {title('Le code reçu par SMS')}
          <p>
            Si le {formatNationalMobile(step.phone)} a un compte SABOU, un code de 6 chiffres vient
            de lui être envoyé.
          </p>
          <form className={styles.form} onSubmit={(event) => onCode(event, step.phone)} noValidate>
            <div className={styles.field}>
              <label htmlFor="code" className={styles.label}>
                Code
              </label>
              <input
                id="code"
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
                className={styles.input}
                {...fieldProps('code-aide')}
              />
              <p id="code-aide" className={styles.help}>
                Le code expire au bout de 10 minutes.
              </p>
              {errorBlock}
            </div>
            {submit('Valider le code')}
          </form>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondary}
              aria-disabled={pending}
              onClick={() =>
                void run(() => requestCode(step.phone, 'Un nouveau code vous a été envoyé.'))
              }
            >
              Recevoir un nouveau code
            </button>
            <button
              type="button"
              className={styles.secondary}
              onClick={() => go({ name: 'phone' })}
            >
              Changer de numéro
            </button>
          </div>
          {notice ? (
            <p className={styles.notice} role="status">
              {notice}
            </p>
          ) : null}
        </section>
      );

    case 'password':
      return (
        <section aria-labelledby="etape">
          {title('Votre nouveau mot de passe')}
          <form
            className={styles.form}
            onSubmit={(event) => onPassword(event, step.phone, step.ticket)}
            noValidate
          >
            <div className={styles.field}>
              <label htmlFor="password" className={styles.label}>
                Nouveau mot de passe
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                className={styles.input}
                {...fieldProps('motdepasse-aide')}
              />
              <p id="motdepasse-aide" className={styles.help}>
                8 caractères au moins ; des chiffres seuls suffisent. Évitez votre numéro et les
                suites comme 12345678.
              </p>
              {errorBlock}
            </div>
            {submit('Changer le mot de passe')}
          </form>
        </section>
      );

    case 'done':
      return (
        <section aria-labelledby="etape">
          {title('Votre mot de passe est changé')}
          <p>
            Vous êtes déconnecté de tous vos appareils. Connectez-vous avec votre nouveau mot de
            passe ; si vous avez activé la double vérification, elle vous sera demandée.
          </p>
          <div className={styles.actions}>
            <a className={styles.link} href={loginHref(step.phone)}>
              Se connecter
            </a>
          </div>
        </section>
      );
  }
}
