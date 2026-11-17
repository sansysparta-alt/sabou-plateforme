import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Alert, Badge, Button, PageHeader, TextAreaField, TextField } from '@sabou/ui';
import type { RejectionCandidate, RejectionMotive, RejectionResult } from '@sabou/types';
import { ApiError } from './accounts-api';
import { rejectPractitioner, searchPractitioners } from './certification-api';
import { PAGE_HEADERS } from './page-headers';

// Rejet définitif d'un praticien par la Direction Générale (US-047, UC-61, R-CER-04).
// Décisions du maître d'œuvre des 12 et 14 novembre 2026 (05_Choix_Techniques.md §2.36) :
// trois motifs, avis du Comité pour une pratique dangereuse, recours de 30 jours auprès de
// la préfecture. La base contrôle le rôle et applique les effets ; l'écran les annonce.

// Définis ici plutôt qu'importés de @sabou/types : l'application n'en importe que des types,
// pour ne pas embarquer zod dans le paquet téléchargé (réseau 3G)
const DETAIL_MAX_LENGTH = 1000;
const REFERENCE_MAX_LENGTH = 100;
const SEARCH_MIN_LENGTH = 2;
const SEARCH_MAX_LENGTH = 100;
const APPEAL_DAYS = 30;

const MOTIVES: [RejectionMotive, string][] = [
  ['fraude_documentaire', 'Fraude documentaire'],
  ['usurpation_identite', 'Usurpation d’identité'],
  ['pratique_dangereuse', 'Pratique dangereuse avérée, après avis du Comité scientifique'],
];
// Libellé court, pour rappeler un rejet déjà prononcé
const MOTIVE_LABELS: Record<RejectionMotive, string> = {
  fraude_documentaire: 'fraude documentaire',
  usurpation_identite: 'usurpation d’identité',
  pratique_dangereuse: 'pratique dangereuse avérée',
};

const STATUS: Record<RejectionCandidate['statut'], [string, 'success' | 'warning' | 'error']> = {
  en_attente: ['En attente de certification', 'warning'],
  certifie: ['Certifié', 'success'],
  suspendu: ['Suspendu', 'warning'],
  rejete: ['Rejeté définitivement', 'error'],
};

const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : 'Une erreur est survenue.';

// Dates du calendrier (2026-12-14) et horodatages, en toutes lettres
const longDate = (value: string) =>
  new Date(value.length === 10 ? `${value}T12:00:00Z` : value).toLocaleDateString('fr-FR', {
    dateStyle: 'long',
    timeZone: 'UTC',
  });

// Aujourd'hui à Conakry (UTC, sans heure d'été), au format des champs de date
const today = () => new Date().toISOString().slice(0, 10);
const appealDeadline = () =>
  new Date(Date.now() + APPEAL_DAYS * 86_400_000).toISOString().slice(0, 10);

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

export function RejectionPage() {
  const [query, setQuery] = useState('');
  const [queryError, setQueryError] = useState<string>();
  const [searched, setSearched] = useState<string>();
  const [results, setResults] = useState<RejectionCandidate[] | null>(null);
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const queryField = useRef<HTMLInputElement>(null);

  async function search(event: FormEvent) {
    event.preventDefault();
    const q = query.trim();
    if (q.length < SEARCH_MIN_LENGTH) {
      setQueryError('Saisissez au moins 2 caractères.');
      queryField.current?.focus();
      return;
    }
    setQueryError(undefined);
    setBusy(true);
    setError(undefined);
    try {
      const found = await searchPractitioners(q);
      setResults(found);
      setSearched(q);
      setNotice(
        found.length === 0
          ? 'Aucun praticien trouvé.'
          : `${plural(found.length, 'praticien trouvé', 'praticiens trouvés')}.`,
      );
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  // Le rejet prononcé met à jour la fiche affichée, sans nouvelle recherche
  function onRejected(code: string, result: RejectionResult, motif: RejectionMotive) {
    setResults(
      (current) =>
        current?.map((candidate) =>
          candidate.praticien === code
            ? {
                ...candidate,
                statut: 'rejete',
                dossier: null,
                certificat: null,
                traitementsCertifies: 0,
                rejet: {
                  le: new Date().toISOString(),
                  motif,
                  recoursJusquau: result.recoursJusquau,
                },
              }
            : candidate,
        ) ?? null,
    );
  }

  return (
    <>
      <PageHeader {...PAGE_HEADERS['/rejet-definitif']} />
      <form
        className="ui-search-bar"
        role="search"
        onSubmit={search}
        noValidate
        aria-label="Rechercher un praticien"
      >
        <TextField
          ref={queryField}
          label="Praticien"
          hint="Nom, code du praticien (PR-…), du dossier (DS-…) ou numéro de certificat (SAB-…)."
          error={queryError}
          value={query}
          maxLength={SEARCH_MAX_LENGTH}
          autoComplete="off"
          required
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="ui-form__actions">
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? 'Recherche…' : 'Rechercher'}
          </Button>
        </div>
      </form>
      {error && <Alert tone="error">{error}</Alert>}
      <p role="status" className="ui-live-status">
        {notice}
      </p>
      {results !== null && (
        <section aria-labelledby="resultats-titre">
          <h2 id="resultats-titre">Résultats pour « {searched} »</h2>
          {results.length === 0 && (
            <p>Aucun praticien ne correspond à cette recherche. Vérifiez le nom ou le code.</p>
          )}
          {results.length > 0 && (
            <ul className="ui-stack">
              {results.map((candidate) => (
                <PractitionerItem
                  key={candidate.praticien}
                  candidate={candidate}
                  onRejected={onRejected}
                />
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}

function PractitionerItem({
  candidate,
  onRejected,
}: {
  candidate: RejectionCandidate;
  onRejected: (code: string, result: RejectionResult, motif: RejectionMotive) => void;
}) {
  const [rejecting, setRejecting] = useState(false);
  const [done, setDone] = useState<RejectionResult>();
  const openButton = useRef<HTMLButtonElement>(null);
  const doneMessage = useRef<HTMLDivElement>(null);
  const [label, tone] = STATUS[candidate.statut];

  useEffect(() => {
    if (done) doneMessage.current?.focus();
  }, [done]);

  return (
    <li className="ui-card ui-card--plain">
      <h3>
        {candidate.nom} · {candidate.praticien}
      </h3>
      <dl className="ui-facts">
        <dt>Statut</dt>
        <dd>
          <Badge tone={tone}>{label}</Badge>
        </dd>
        <dt>Spécialité</dt>
        <dd>{candidate.specialite}</dd>
        <dt>Zone</dt>
        <dd>
          {candidate.prefecture}, région de {candidate.region}
        </dd>
        <dt>Dossier en cours</dt>
        <dd>
          {candidate.dossier
            ? `${candidate.dossier.code}, étape ${candidate.dossier.etape} sur 6`
            : 'Aucun'}
        </dd>
        <dt>Certificat actif</dt>
        <dd>{candidate.certificat ?? 'Aucun'}</dd>
        <dt>Traitements</dt>
        <dd>
          {plural(candidate.traitementsCertifies, 'certifié', 'certifiés')},{' '}
          {plural(candidate.traitementsEnExamen, 'en cours d’examen', 'en cours d’examen')}
        </dd>
        {candidate.rejet && (
          <>
            <dt>Rejet définitif</dt>
            <dd>
              Prononcé le {longDate(candidate.rejet.le)} pour {MOTIVE_LABELS[candidate.rejet.motif]}{' '}
              ; recours possible jusqu’au {longDate(candidate.rejet.recoursJusquau)}
            </dd>
          </>
        )}
      </dl>
      {done && (
        <Alert ref={doneMessage} tone="success" title="Rejet définitif prononcé">
          Le praticien est informé par SMS. Il peut contester la décision jusqu’au{' '}
          {longDate(done.recoursJusquau)} auprès de l’administration de sa préfecture.
        </Alert>
      )}
      {candidate.statut !== 'rejete' && !rejecting && (
        <div className="ui-form__actions">
          <Button ref={openButton} variant="secondary" onClick={() => setRejecting(true)}>
            Prononcer le rejet définitif{' '}
            <span className="ui-visually-hidden">
              de {candidate.nom}, {candidate.praticien}
            </span>
          </Button>
        </div>
      )}
      {candidate.statut !== 'rejete' && rejecting && (
        <RejectionForm
          candidate={candidate}
          onCancel={() => {
            setRejecting(false);
            // Le bouton réapparaît : le focus y revient
            setTimeout(() => openButton.current?.focus());
          }}
          onRejected={(result, motif) => {
            setRejecting(false);
            setDone(result);
            onRejected(candidate.praticien, result, motif);
          }}
        />
      )}
    </li>
  );
}

type FormErrors = Partial<Record<'motif' | 'date' | 'reference' | 'detail' | 'confirm', string>>;

function RejectionForm({
  candidate,
  onCancel,
  onRejected,
}: {
  candidate: RejectionCandidate;
  onCancel: () => void;
  onRejected: (result: RejectionResult, motif: RejectionMotive) => void;
}) {
  const id = useId();
  const [motif, setMotif] = useState<RejectionMotive>();
  const [date, setDate] = useState('');
  const [reference, setReference] = useState('');
  const [detail, setDetail] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const firstMotive = useRef<HTMLInputElement>(null);
  const dateField = useRef<HTMLInputElement>(null);
  const referenceField = useRef<HTMLInputElement>(null);
  const detailField = useRef<HTMLTextAreaElement>(null);
  const confirmField = useRef<HTMLInputElement>(null);
  const errorMessageRef = useRef<HTMLDivElement>(null);
  const dangerous = motif === 'pratique_dangereuse';

  useEffect(() => firstMotive.current?.focus(), []);
  useEffect(() => {
    if (error) errorMessageRef.current?.focus();
  }, [error]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const found: FormErrors = {};
    if (!motif) found.motif = 'Choisissez le motif du rejet.';
    if (dangerous && !date) found.date = 'Indiquez la date de l’avis du Comité.';
    if (dangerous && date > today()) found.date = 'L’avis du Comité doit précéder le rejet.';
    if (dangerous && !reference.trim())
      found.reference = 'Indiquez la référence de l’avis du Comité.';
    if (!detail.trim()) found.detail = 'Précisez les faits qui fondent le rejet.';
    if (!confirmed) found.confirm = 'Cochez la confirmation pour prononcer le rejet.';
    setErrors(found);
    // Le focus va au premier champ en erreur (WCAG 3.3.1)
    if (found.motif) return firstMotive.current?.focus();
    if (found.date) return dateField.current?.focus();
    if (found.reference) return referenceField.current?.focus();
    if (found.detail) return detailField.current?.focus();
    if (found.confirm) return confirmField.current?.focus();

    setBusy(true);
    setError(undefined);
    try {
      const result = await rejectPractitioner(candidate.praticien, {
        dossier: candidate.dossier?.code ?? null,
        motif: motif!,
        detail: detail.trim(),
        ...(dangerous ? { avisComite: { date, reference: reference.trim() } } : {}),
        confirmation: true,
      });
      onRejected(result, motif!);
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  // Conséquences annoncées avant la confirmation : ce que la base appliquera
  const effects = [
    'Le praticien passe « rejeté » et quitte l’annuaire public.',
    candidate.dossier &&
      `Le dossier ${candidate.dossier.code} est clos à l’étape ${candidate.dossier.etape}.`,
    candidate.certificat && `Le certificat ${candidate.certificat} est révoqué.`,
    candidate.traitementsCertifies > 0 &&
      `${plural(candidate.traitementsCertifies, 'traitement certifié passe', 'traitements certifiés passent')} « suspendu » (réversible si le recours aboutit).`,
    candidate.traitementsEnExamen > 0 &&
      `${plural(candidate.traitementsEnExamen, 'traitement en cours d’examen est arrêté', 'traitements en cours d’examen sont arrêtés')} : ${candidate.traitementsEnExamen > 1 ? 'ils sortent' : 'il sort'} des files du régional et du Comité.`,
    `Le praticien est informé par SMS. Il peut contester la décision jusqu’au ${longDate(appealDeadline())} auprès de l’administration de sa préfecture.`,
    'Aucun nouveau dossier n’est possible avant 12 mois.',
  ].filter(Boolean) as string[];

  return (
    <form className="ui-form" onSubmit={submit} noValidate aria-labelledby={`${id}-titre`}>
      <h4 id={`${id}-titre`}>
        Rejet définitif de {candidate.nom} ({candidate.praticien})
      </h4>
      {error && (
        <Alert ref={errorMessageRef} tone="error">
          {error}
        </Alert>
      )}
      <fieldset
        className="ui-fieldset"
        aria-describedby={`${id}-motif-aide${errors.motif ? ` ${id}-motif-erreur` : ''}`}
        aria-invalid={errors.motif ? true : undefined}
      >
        <legend className="ui-fieldset__legend">Motif</legend>
        <p className="ui-field__hint" id={`${id}-motif-aide`}>
          Seuls ces trois motifs permettent un rejet définitif.
        </p>
        {MOTIVES.map(([value, text], index) => (
          <label key={value} className="ui-choice">
            <input
              ref={index === 0 ? firstMotive : undefined}
              type="radio"
              name={`${id}-motif`}
              value={value}
              checked={motif === value}
              onChange={() => setMotif(value)}
            />
            {text}
          </label>
        ))}
        {errors.motif && (
          <p className="ui-field__error" id={`${id}-motif-erreur`}>
            {errors.motif}
          </p>
        )}
      </fieldset>
      {dangerous && (
        <>
          <TextField
            ref={dateField}
            type="date"
            label="Date de l’avis du Comité scientifique"
            error={errors.date}
            value={date}
            max={today()}
            required
            onChange={(event) => setDate(event.target.value)}
          />
          <TextField
            ref={referenceField}
            label="Référence de l’avis du Comité"
            hint="Telle qu’elle figure sur l’avis, par exemple AV-2026-014."
            error={errors.reference}
            value={reference}
            maxLength={REFERENCE_MAX_LENGTH}
            required
            onChange={(event) => setReference(event.target.value)}
          />
        </>
      )}
      <TextAreaField
        ref={detailField}
        label="Faits qui fondent le rejet"
        hint="Conservés avec la décision et lus par le praticien dans son espace ; ils ne sont pas envoyés par SMS."
        error={errors.detail}
        value={detail}
        maxLength={DETAIL_MAX_LENGTH}
        rows={5}
        required
        onChange={(event) => setDetail(event.target.value)}
      />
      <div className="ui-card ui-card--plain" id={`${id}-effets`}>
        <h5>Ce que le rejet entraîne</h5>
        <ul className="ui-list">
          {effects.map((effect) => (
            <li key={effect}>{effect}</li>
          ))}
        </ul>
      </div>
      <div className="ui-field">
        <label className="ui-choice">
          <input
            ref={confirmField}
            type="checkbox"
            checked={confirmed}
            aria-describedby={`${id}-effets${errors.confirm ? ` ${id}-confirmation-erreur` : ''}`}
            aria-invalid={errors.confirm ? true : undefined}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          Je prononce le rejet définitif de {candidate.nom} et j’en accepte les conséquences
          ci-dessus.
        </label>
        {errors.confirm && (
          <p className="ui-field__error" id={`${id}-confirmation-erreur`}>
            {errors.confirm}
          </p>
        )}
      </div>
      <div className="ui-form__actions">
        <Button type="submit" variant="danger" disabled={busy}>
          {busy ? 'Enregistrement…' : 'Prononcer le rejet définitif'}
        </Button>
        <Button variant="tertiary" disabled={busy} onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  );
}
