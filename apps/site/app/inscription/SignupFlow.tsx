'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { SignupError, SignupVerifyResult } from '@sabou/types';
import { citizenPasswordError, formatNationalMobile, toNationalMobile } from '@sabou/types/phone';
import styles from '../Forms.module.css';
import { loginHref } from '../links';

// Inscription d'un citoyen (lot D : US-014) : numéro → code reçu par SMS → prénom et mot de
// passe. Le praticien s'inscrit dans l'application mobile (US-066) : le site ne sert que le
// grand public (US-068). Que le numéro ait déjà un compte n'est dit qu'après le bon code. L'API valide tout
// de nouveau ; les contrôles ici n'évitent que des allers-retours sur un réseau lent.

type Step =
  | { name: 'phone' }
  | { name: 'code'; phone: string }
  | { name: 'profile'; phone: string; ticket: string }
  | { name: 'existing'; phone: string }
  | { name: 'created'; phone: string };

type Reply<T> = { ok: true; data: T } | { ok: false; error: SignupError & { retryAfter?: number } };

const NETWORK_ERROR: SignupError = {
  error: 'invalid',
  message: 'Connexion impossible. Vérifiez votre réseau, puis réessayez.',
};

async function send<T>(path: string, body: unknown): Promise<Reply<T>> {
  try {
    const response = await fetch(`/api/inscription/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    const data = text ? (JSON.parse(text) as unknown) : null;
    if (response.ok) return { ok: true, data: data as T };
    if (data && typeof data === 'object' && 'error' in data) {
      return { ok: false, error: data as SignupError };
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

interface FieldErrors {
  firstName?: string;
  password?: string;
}
const FIELD_ORDER: (keyof FieldErrors)[] = ['firstName', 'password'];

export default function SignupFlow() {
  const [step, setStep] = useState<Step>({ name: 'phone' });
  const [error, setError] = useState<string | null>(null);
  // Erreurs de saisie de l'étape « profil », chacune sous son champ (WCAG 3.3.1) ; le message
  // commun reste aux refus du serveur
  const [fields, setFields] = useState<FieldErrors>({});
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
    setFields({});
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
    const raw = String(new FormData(event.currentTarget).get('phone') ?? '');
    const phone = toNationalMobile(raw);
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
      const reply = await send<SignupVerifyResult>('verification', { phone, code });
      if (!reply.ok) {
        setError(errorText(reply.error));
        return;
      }
      if (reply.data.status === 'existing') go({ name: 'existing', phone });
      else {
        go({ name: 'profile', phone, ticket: reply.data.ticket });
      }
    });
  }

  function onProfile(event: FormEvent<HTMLFormElement>, phone: string, ticket: string) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const firstName = String(form.get('firstName') ?? '').trim();
    const password = String(form.get('password') ?? '');
    const found: FieldErrors = {};
    if (!firstName) found.firstName = 'Indiquez votre prénom.';
    const refused = citizenPasswordError(password, phone);
    if (refused) found.password = refused;
    setFields(found);
    const invalid = FIELD_ORDER.find((key) => found[key]);
    if (invalid) {
      setError(null);
      document.getElementById(invalid)?.focus();
      return;
    }
    void run(async () => {
      const reply = await send<{ status: 'created' | 'existing' }>('compte', {
        ticket,
        profile: 'citoyen',
        firstName,
        password,
      });
      if (reply.ok) {
        go(
          reply.data.status === 'created'
            ? { name: 'created', phone }
            : { name: 'existing', phone },
        );
      } else if (reply.error.error === 'ticket_invalid') {
        go({ name: 'phone' }, reply.error.message);
      } else {
        setError(errorText(reply.error));
      }
    });
  }

  // Message sous un champ de l'étape « profil » : relié au champ, effacé dès la saisie
  const fieldError = (key: keyof FieldErrors) =>
    fields[key] ? (
      <p id={`${key}-erreur`} className={styles.error}>
        {fields[key]}
      </p>
    ) : null;
  const fieldProps = (key: keyof FieldErrors, help?: string) => ({
    'aria-invalid': fields[key] ? true : undefined,
    'aria-describedby':
      [help, fields[key] ? `${key}-erreur` : undefined, error ? errorId : undefined]
        .filter(Boolean)
        .join(' ') || undefined,
    onChange: () =>
      setFields((current) => {
        if (!current[key]) return current;
        const rest = { ...current };
        delete rest[key];
        return rest;
      }),
  });
  const errorId = 'inscription-erreur';
  const described = (help: string) => (error ? `${help} ${errorId}` : help);
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

  switch (step.name) {
    case 'phone':
      return (
        <section aria-labelledby="etape">
          <h2 id="etape" ref={heading} tabIndex={-1} className={styles.heading}>
            Votre numéro de téléphone
          </h2>
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
                aria-invalid={error ? true : undefined}
                aria-describedby={described('phone-aide')}
              />
              <p id="phone-aide" className={styles.help}>
                Un mobile guinéen, par exemple 621 23 45 67. Vous recevrez un code par SMS.
              </p>
            </div>
            {errorBlock}
            {submit('Recevoir le code')}
          </form>
        </section>
      );

    case 'code':
      return (
        <section aria-labelledby="etape">
          <h2 id="etape" ref={heading} tabIndex={-1} className={styles.heading}>
            Le code reçu par SMS
          </h2>
          <p>Nous avons envoyé un code de 6 chiffres au {formatNationalMobile(step.phone)}.</p>
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
                aria-invalid={error ? true : undefined}
                aria-describedby={described('code-aide')}
              />
              <p id="code-aide" className={styles.help}>
                Le code expire au bout de 10 minutes.
              </p>
            </div>
            {errorBlock}
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

    case 'profile':
      return (
        <section aria-labelledby="etape">
          <h2 id="etape" ref={heading} tabIndex={-1} className={styles.heading}>
            Votre prénom et votre mot de passe
          </h2>
          <form
            className={styles.form}
            onSubmit={(event) => onProfile(event, step.phone, step.ticket)}
            noValidate
          >
            <div className={styles.field}>
              <label htmlFor="firstName" className={styles.label}>
                Prénom
              </label>
              <input
                id="firstName"
                name="firstName"
                type="text"
                autoComplete="given-name"
                maxLength={50}
                required
                className={styles.input}
                {...fieldProps('firstName', 'prenom-aide')}
              />
              <p id="prenom-aide" className={styles.help}>
                Affiché avec vos témoignages.
              </p>
              {fieldError('firstName')}
            </div>
            <div className={styles.field}>
              <label htmlFor="password" className={styles.label}>
                Mot de passe
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                className={styles.input}
                {...fieldProps('password', 'motdepasse-aide')}
              />
              <p id="motdepasse-aide" className={styles.help}>
                8 caractères au moins ; des chiffres seuls suffisent. Évitez votre numéro et les
                suites comme 12345678.
              </p>
              {fieldError('password')}
            </div>
            {errorBlock}
            {submit('Créer mon compte')}
          </form>
        </section>
      );

    case 'existing':
      return (
        <section aria-labelledby="etape">
          <h2 id="etape" ref={heading} tabIndex={-1} className={styles.heading}>
            Vous avez déjà un compte
          </h2>
          <p>Le numéro {formatNationalMobile(step.phone)} a déjà un compte SABOU.</p>
          <div className={styles.actions}>
            <a className={styles.link} href={loginHref(step.phone)}>
              Se connecter
            </a>
          </div>
        </section>
      );

    case 'created':
      return (
        <section aria-labelledby="etape">
          <h2 id="etape" ref={heading} tabIndex={-1} className={styles.heading}>
            Votre compte est créé
          </h2>
          <p>Connectez-vous avec votre numéro et votre mot de passe.</p>
          <div className={styles.actions}>
            <a className={styles.link} href={loginHref(step.phone)}>
              Se connecter
            </a>
          </div>
        </section>
      );
  }
}
