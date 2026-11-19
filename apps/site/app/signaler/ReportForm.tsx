'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { HealthReportReceipt } from '@sabou/types';
import styles from '../Forms.module.css';
import own from './Report.module.css';

// Formulaire de signalement (US-100). Sans compte ; contact facultatif, visible du seul Comité
// scientifique et effacé 12 mois après la clôture. L'API valide tout de nouveau ; les contrôles
// ici évitent seulement des allers-retours sur un réseau lent. Le champ « site » est un leurre
// pour les robots, caché aux personnes et aux lecteurs d'écran.

type Field = 'type' | 'code' | 'gravite' | 'description';
type Errors = Partial<Record<Field, string>>;

const CODE = /^(REC|PL)-\d{3,10}$/;
const NETWORK_ERROR = 'Connexion impossible. Vérifiez votre réseau, puis réessayez.';

function validate(form: FormData): Errors {
  const errors: Errors = {};
  if (!form.get('type')) errors.type = 'Choisissez le type de signalement.';
  const code = String(form.get('code') ?? '')
    .trim()
    .toUpperCase();
  if (!CODE.test(code)) {
    errors.code = 'Indiquez le code du traitement (REC-…) ou de la plante (PL-…).';
  }
  if (!form.get('gravite')) errors.gravite = 'Choisissez la gravité.';
  if (String(form.get('description') ?? '').trim().length < 10) {
    errors.description = 'Décrivez ce qui s’est passé (10 caractères au moins).';
  }
  return errors;
}

export default function ReportForm() {
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const done = useRef<HTMLHeadingElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const codeInput = useRef<HTMLInputElement>(null);

  // Code prérempli par le lien (/signaler?code=REC-2041)
  useEffect(() => {
    const fromLink = new URLSearchParams(window.location.search).get('code');
    // Champ non contrôlé : la valeur du lien y est posée sans nouveau rendu
    if (fromLink && codeInput.current && CODE.test(fromLink.trim().toUpperCase())) {
      codeInput.current.value = fromLink.trim().toUpperCase();
    }
  }, []);

  useEffect(() => {
    if (reference) done.current?.focus();
  }, [reference]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    const found = validate(data);
    setErrors(found);
    setFailure(null);
    const first = (['type', 'code', 'gravite', 'description'] as const).find((f) => found[f]);
    if (first) {
      form.current?.querySelector<HTMLElement>(`[name="${first}"]`)?.focus();
      return;
    }
    setPending(true);
    try {
      const response = await fetch('/api/signalements', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          type: data.get('type'),
          code: String(data.get('code')).trim().toUpperCase(),
          gravite: data.get('gravite'),
          description: String(data.get('description')).trim(),
          contact: String(data.get('contact') ?? '').trim(),
          site: String(data.get('site') ?? ''),
        }),
      });
      const body = (await response.json().catch(() => null)) as
        (HealthReportReceipt & { message?: string }) | null;
      if (response.ok && body?.reference) {
        setReference(body.reference);
        return;
      }
      if (response.status === 429) {
        const minutes = Math.ceil(Number(response.headers.get('retry-after') ?? 3600) / 60);
        setFailure(`Trop de signalements envoyés. Réessayez dans ${minutes} minutes.`);
      } else if (response.status === 400 && body?.message?.includes('code')) {
        setErrors({ code: body.message });
        form.current?.querySelector<HTMLElement>('[name="code"]')?.focus();
      } else {
        setFailure(body?.message ?? NETWORK_ERROR);
      }
    } catch {
      setFailure(NETWORK_ERROR);
    } finally {
      setPending(false);
    }
  }

  if (reference) {
    return (
      <section aria-labelledby="merci">
        <h2 id="merci" ref={done} tabIndex={-1} className={styles.heading}>
          Merci, votre signalement est envoyé
        </h2>
        <p>
          Référence : <strong>{reference}</strong>. Le Comité scientifique l’examine. Si vous avez
          laissé un contact, il pourra vous joindre pour en savoir plus.
        </p>
      </section>
    );
  }

  const describedBy = (field: Field, help?: string) =>
    [help, errors[field] ? `${field}-erreur` : undefined].filter(Boolean).join(' ') || undefined;
  const errorText = (field: Field) =>
    errors[field] ? (
      <p id={`${field}-erreur`} className={styles.error}>
        {errors[field]}
      </p>
    ) : null;

  return (
    <form ref={form} className={styles.form} onSubmit={onSubmit} noValidate>
      {failure ? (
        <p className={styles.error} role="alert">
          {failure}
        </p>
      ) : null}

      <fieldset className={styles.choices} aria-describedby={describedBy('type')}>
        <legend className={styles.label}>Que voulez-vous signaler ?</legend>
        <label className={styles.choice}>
          <input
            type="radio"
            name="type"
            value="danger"
            aria-invalid={!!errors.type || undefined}
          />
          Un danger (plante toxique, erreur dans un traitement…)
        </label>
        <label className={styles.choice}>
          <input type="radio" name="type" value="effet_indesirable" />
          Un effet indésirable après un traitement
        </label>
        {errorText('type')}
      </fieldset>

      <div className={styles.field}>
        <label htmlFor="code" className={styles.label}>
          Code du traitement ou de la plante
        </label>
        <input
          id="code"
          name="code"
          className={styles.input}
          ref={codeInput}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          maxLength={20}
          required
          aria-invalid={!!errors.code || undefined}
          aria-describedby={describedBy('code', 'code-aide')}
        />
        <p id="code-aide" className={styles.help}>
          Il figure sur la page du traitement (REC-2041) ou de la plante (PL-001).
        </p>
        {errorText('code')}
      </div>

      <fieldset className={styles.choices} aria-describedby={describedBy('gravite')}>
        <legend className={styles.label}>Gravité</legend>
        <label className={styles.choice}>
          <input
            type="radio"
            name="gravite"
            value="grave"
            aria-invalid={!!errors.gravite || undefined}
          />
          Grave : hospitalisation, malaise important, danger pour la vie
        </label>
        <label className={styles.choice}>
          <input type="radio" name="gravite" value="moyenne" />
          Moyenne : gêne qui dure ou qui inquiète
        </label>
        <label className={styles.choice}>
          <input type="radio" name="gravite" value="faible" />
          Faible : gêne légère et passagère
        </label>
        {errorText('gravite')}
      </fieldset>

      <div className={styles.field}>
        <label htmlFor="description" className={styles.label}>
          Ce qui s’est passé
        </label>
        <textarea
          id="description"
          name="description"
          className={styles.input}
          rows={5}
          maxLength={2000}
          required
          aria-invalid={!!errors.description || undefined}
          aria-describedby={describedBy('description', 'description-aide')}
        />
        <p id="description-aide" className={styles.help}>
          Quand, après combien de prises, quels effets, pour quel âge. N’indiquez pas de nom.
        </p>
        {errorText('description')}
      </div>

      <div className={styles.field}>
        <label htmlFor="contact" className={styles.label}>
          Votre téléphone ou e-mail (facultatif)
        </label>
        <input
          id="contact"
          name="contact"
          className={styles.input}
          maxLength={120}
          autoComplete="tel"
          aria-describedby="contact-aide"
        />
        <p id="contact-aide" className={styles.help}>
          Visible du seul Comité scientifique, pour vous joindre si besoin. Effacé 12 mois après la
          clôture du signalement.
        </p>
      </div>

      {/* Leurre : invisible et hors du parcours clavier ; seul un robot le remplit */}
      <div className={own.trap} aria-hidden="true">
        <label htmlFor="site">Ne pas remplir</label>
        <input id="site" name="site" tabIndex={-1} autoComplete="off" />
      </div>

      <button type="submit" className={styles.button} aria-disabled={pending}>
        {pending ? 'Envoi…' : 'Envoyer le signalement'}
      </button>
    </form>
  );
}
