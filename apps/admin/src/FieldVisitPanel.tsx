import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Alert, Badge, Button, TextAreaField, TextField } from '@sabou/ui';
import type { FieldVisit, FieldVisitReport, VisitOpinion } from '@sabou/types';
import { ApiError } from './accounts-api';
import { attachVisitPhoto, planVisit, reportVisit } from './certification-api';

// Visite sur place d'un dossier à l'étape 2 (US-041, UC-30) : planifier ou replanifier,
// enregistrer la visite avec son compte rendu signé, joindre la photo de la fiche papier.
// Heures de Conakry (UTC, sans heure d'été) : l'API les reçoit et les rend telles quelles.

// Définis ici plutôt qu'importés de @sabou/types : l'application n'en importe que des
// types, pour ne pas embarquer zod dans le paquet téléchargé (réseau 3G)
const NOTES_MAX_LENGTH = 5000;
const PLAN_HORIZON_DAYS = 90;
const OPINIONS: [VisitOpinion, string][] = [
  ['favorable', 'Favorable'],
  ['reserve', 'Favorable avec réserves'],
  ['defavorable', 'Défavorable'],
];
const OPINION_LABEL = Object.fromEntries(OPINIONS) as Record<VisitOpinion, string>;

const TZ = 'Africa/Conakry';
const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : 'Une erreur est survenue.';
// « 2026-11-20T09:30 » (heure de Conakry, soit UTC) → « 20 novembre 2026 à 09:30 »
const plannedDate = (value: string) =>
  new Date(`${value}:00Z`).toLocaleString('fr-FR', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: TZ,
  });
const dayDate = (value: string) =>
  new Date(`${value}T00:00:00Z`).toLocaleDateString('fr-FR', { dateStyle: 'long', timeZone: TZ });
const signedAt = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short', timeZone: TZ });
// Bornes des champs de date, en heure de Conakry (UTC)
const nowMinute = () => new Date().toISOString().slice(0, 16);
const today = () => new Date().toISOString().slice(0, 10);
const horizon = () =>
  new Date(Date.now() + PLAN_HORIZON_DAYS * 86_400_000).toISOString().slice(0, 16);

type Mode = 'view' | 'plan' | 'report';

export function FieldVisitPanel({
  code,
  visit: initial,
  announce,
  onChange,
}: {
  code: string;
  visit: FieldVisit | null;
  // Annonce dans la zone d'état de la page (une seule pour les lecteurs d'écran)
  announce: (notice: string) => void;
  // Visite enregistrée : la page réévalue la validation du dossier
  onChange: (visit: FieldVisit) => void;
}) {
  const id = useId();
  const [visit, setVisit] = useState(initial);
  const [mode, setMode] = useState<Mode>('view');
  const heading = useRef<HTMLHeadingElement>(null);

  function saved(next: FieldVisit, text: string) {
    setVisit(next);
    onChange(next);
    setMode('view');
    announce(text);
    // Le formulaire disparaît : le focus revient au titre de la visite
    setTimeout(() => heading.current?.focus());
  }

  function cancel() {
    setMode('view');
    setTimeout(() => heading.current?.focus());
  }

  return (
    <section className="ui-stack" aria-labelledby={`${id}-visite`}>
      <h4 id={`${id}-visite`} ref={heading} tabIndex={-1}>
        Visite sur place <span className="ui-visually-hidden">du dossier {code}</span>
      </h4>
      {mode === 'view' && (
        <VisitSummary
          code={code}
          visit={visit}
          onPlan={() => setMode('plan')}
          onReport={() => setMode('report')}
          onPhoto={(next) => saved(next, 'Photo de la fiche jointe au compte rendu.')}
        />
      )}
      {mode === 'plan' && (
        <PlanForm
          code={code}
          visit={visit}
          onSaved={(next) =>
            saved(
              next,
              `Visite planifiée le ${plannedDate(next.prevueLe)}. Le praticien sera prévenu la veille.`,
            )
          }
          onCancel={cancel}
        />
      )}
      {mode === 'report' && visit?.statut === 'planifiee' && (
        <ReportForm
          code={code}
          visit={visit}
          onSaved={(next) => saved(next, 'Compte rendu signé : la visite est enregistrée.')}
          onCancel={cancel}
        />
      )}
    </section>
  );
}

function VisitSummary({
  code,
  visit,
  onPlan,
  onReport,
  onPhoto,
}: {
  code: string;
  visit: FieldVisit | null;
  onPlan: () => void;
  onReport: () => void;
  onPhoto: (visit: FieldVisit) => void;
}) {
  if (!visit) {
    return (
      <div className="ui-form__actions">
        <Button variant="secondary" icon="clock" onClick={onPlan}>
          Planifier la visite <span className="ui-visually-hidden">du dossier {code}</span>
        </Button>
      </div>
    );
  }
  if (visit.statut === 'planifiee') {
    return (
      <>
        <dl className="ui-facts">
          <dt>Prévue le</dt>
          <dd>{plannedDate(visit.prevueLe)}</dd>
          <dt>Rappel au praticien</dt>
          <dd>
            {visit.rappelEnvoye ? (
              <Badge tone="success">Envoyé</Badge>
            ) : (
              <Badge tone="neutral">Par SMS, la veille</Badge>
            )}
          </dd>
        </dl>
        <div className="ui-form__actions">
          <Button variant="secondary" onClick={onReport}>
            Enregistrer le compte rendu{' '}
            <span className="ui-visually-hidden">du dossier {code}</span>
          </Button>
          <Button variant="tertiary" onClick={onPlan}>
            Replanifier <span className="ui-visually-hidden">la visite du dossier {code}</span>
          </Button>
        </div>
      </>
    );
  }
  return (
    <>
      <dl className="ui-facts">
        <dt>Réalisée le</dt>
        <dd>{visit.realiseeLe && dayDate(visit.realiseeLe)}</dd>
        <dt>Avis</dt>
        <dd>{visit.avis && OPINION_LABEL[visit.avis]}</dd>
        <dt>Compte rendu</dt>
        <dd>
          Signé par {visit.signePar}
          {visit.signeLe && <>, le {signedAt(visit.signeLe)}</>}
        </dd>
        <dt>Empreinte</dt>
        <dd>
          <code title="SHA3-256 du compte rendu signé">{visit.empreinte?.slice(0, 16)}…</code>
        </dd>
        <dt>Photo de la fiche</dt>
        <dd>{visit.photo ? <Badge tone="success">Jointe</Badge> : 'Aucune (facultative)'}</dd>
      </dl>
      {!visit.photo && <PhotoForm code={code} visit={visit} onSaved={onPhoto} />}
    </>
  );
}

function PlanForm({
  code,
  visit,
  onSaved,
  onCancel,
}: {
  code: string;
  visit: FieldVisit | null;
  onSaved: (visit: FieldVisit) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [when, setWhen] = useState(visit?.statut === 'planifiee' ? visit.prevueLe : '');
  const [fieldError, setFieldError] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLInputElement>(null);

  useEffect(() => field.current?.focus(), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!when) {
      setFieldError('Indiquez la date et l’heure de la visite.');
      field.current?.focus();
      return;
    }
    setFieldError(undefined);
    setBusy(true);
    setError(undefined);
    try {
      onSaved(await planVisit(code, { prevueLe: when }));
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <form className="ui-form" onSubmit={submit} noValidate aria-labelledby={`${id}-titre`}>
      <h5 id={`${id}-titre`}>
        {visit?.statut === 'planifiee' ? 'Replanifier' : 'Planifier'} la visite du dossier {code}
      </h5>
      {error && <Alert tone="error">{error}</Alert>}
      <TextField
        ref={field}
        type="datetime-local"
        label="Date et heure de la visite"
        hint="Heure de Conakry, dans les 90 prochains jours. Le praticien reçoit un rappel par SMS la veille."
        error={fieldError}
        value={when}
        min={nowMinute()}
        max={horizon()}
        required
        onChange={(event) => setWhen(event.target.value)}
      />
      <div className="ui-form__actions">
        <Button type="submit" variant="primary" disabled={busy}>
          Enregistrer la date
        </Button>
        <Button variant="tertiary" disabled={busy} onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

function ReportForm({
  code,
  visit,
  onSaved,
  onCancel,
}: {
  code: string;
  visit: FieldVisit;
  onSaved: (visit: FieldVisit) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [date, setDate] = useState(today());
  const [avis, setAvis] = useState<VisitOpinion>();
  const [constats, setConstats] = useState('');
  const [attestation, setAttestation] = useState(false);
  const [errors, setErrors] = useState<
    Partial<Record<'date' | 'avis' | 'constats' | 'attestation', string>>
  >({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const dateField = useRef<HTMLInputElement>(null);
  const notesField = useRef<HTMLTextAreaElement>(null);
  const firstOpinion = useRef<HTMLInputElement>(null);
  const attestationField = useRef<HTMLInputElement>(null);

  useEffect(() => dateField.current?.focus(), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found: typeof errors = {};
    if (!date) found.date = 'Indiquez la date de la visite.';
    if (!avis) found.avis = 'Choisissez un avis.';
    if (!constats.trim()) found.constats = 'Décrivez ce que vous avez constaté.';
    if (!attestation) found.attestation = 'Cochez l’attestation pour signer le compte rendu.';
    setErrors(found);
    // Le focus va au premier champ en erreur (WCAG 3.3.1)
    if (found.date) return dateField.current?.focus();
    if (found.avis) return firstOpinion.current?.focus();
    if (found.constats) return notesField.current?.focus();
    if (found.attestation) return attestationField.current?.focus();

    const report: FieldVisitReport = {
      visite: visit.id,
      realiseeLe: date,
      avis: avis!,
      constats: constats.trim(),
      attestation: true,
    };
    setBusy(true);
    setError(undefined);
    try {
      onSaved(await reportVisit(code, report));
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <form className="ui-form" onSubmit={submit} noValidate aria-labelledby={`${id}-titre`}>
      <h5 id={`${id}-titre`}>Compte rendu de la visite du dossier {code}</h5>
      {error && <Alert tone="error">{error}</Alert>}
      <TextField
        ref={dateField}
        type="date"
        label="Date de la visite"
        error={errors.date}
        value={date}
        max={today()}
        required
        onChange={(event) => setDate(event.target.value)}
      />
      <fieldset
        className="ui-fieldset"
        aria-describedby={errors.avis ? `${id}-avis-erreur` : undefined}
        aria-invalid={errors.avis ? true : undefined}
      >
        <legend className="ui-fieldset__legend">Avis</legend>
        {OPINIONS.map(([value, label], index) => (
          <label key={value} className="ui-choice">
            <input
              ref={index === 0 ? firstOpinion : undefined}
              type="radio"
              name={`${id}-avis`}
              value={value}
              checked={avis === value}
              onChange={() => setAvis(value)}
            />
            {label}
          </label>
        ))}
        {errors.avis && (
          <p className="ui-field__error" id={`${id}-avis-erreur`}>
            {errors.avis}
          </p>
        )}
      </fieldset>
      <TextAreaField
        ref={notesField}
        label="Constats"
        hint="Lieu d’exercice, conditions de préparation et de conservation, échanges avec le praticien."
        error={errors.constats}
        value={constats}
        maxLength={NOTES_MAX_LENGTH}
        rows={6}
        required
        onChange={(event) => setConstats(event.target.value)}
      />
      <div className="ui-field">
        <label className="ui-choice">
          <input
            ref={attestationField}
            type="checkbox"
            checked={attestation}
            aria-describedby={`${id}-attestation-aide${errors.attestation ? ` ${id}-attestation-erreur` : ''}`}
            aria-invalid={errors.attestation ? true : undefined}
            onChange={(event) => setAttestation(event.target.checked)}
          />
          Je certifie avoir réalisé cette visite et je signe ce compte rendu.
        </label>
        <p className="ui-field__hint" id={`${id}-attestation-aide`}>
          Une fois signé, le compte rendu ne peut plus être modifié.
        </p>
        {errors.attestation && (
          <p className="ui-field__error" id={`${id}-attestation-erreur`}>
            {errors.attestation}
          </p>
        )}
      </div>
      <div className="ui-form__actions">
        <Button type="submit" variant="primary" icon="success" disabled={busy}>
          Signer le compte rendu
        </Button>
        <Button variant="tertiary" disabled={busy} onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

function PhotoForm({
  code,
  visit,
  onSaved,
}: {
  code: string;
  visit: FieldVisit;
  onSaved: (visit: FieldVisit) => void;
}) {
  const [file, setFile] = useState<File>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      setError('Choisissez la photo de la fiche papier.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      onSaved(await attachVisitPhoto(code, visit.id, file));
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <form className="ui-form" onSubmit={submit} noValidate>
      <TextField
        type="file"
        label="Photo de la fiche papier (facultative)"
        hint="Photo JPEG ou PNG, ou document PDF, 5 Mo au plus. Elle se joint une seule fois."
        error={error}
        accept="image/jpeg,image/png,application/pdf"
        onChange={(event) => setFile(event.target.files?.[0])}
      />
      <div className="ui-form__actions">
        <Button type="submit" variant="secondary" disabled={busy}>
          Joindre la photo{' '}
          <span className="ui-visually-hidden">au compte rendu du dossier {code}</span>
        </Button>
      </div>
    </form>
  );
}
