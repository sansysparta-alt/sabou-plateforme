import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Alert, Badge, Button, PageHeader, SelectField, TextField } from '@sabou/ui';
import {
  fieldDossierCreateSchema,
  PIECE_LABELS,
  PRACTITIONER_PIECE_TYPES,
  type FieldDossier,
  type FieldDossierReferentials,
  type PractitionerPieceType,
} from '@sabou/types';
import { formatNationalMobile } from '@sabou/types/phone';
import { ApiError } from './accounts-api';
import {
  addFieldPiece,
  fetchFieldReferentials,
  listFieldDossiers,
  openFieldDossier,
  removeFieldPiece,
  submitFieldDossier,
} from './field-dossiers-api';
import { DossierRow } from './DossierRow';
import { PAGE_HEADERS } from './page-headers';

// Dossier terrain (US-040c, §6.4) : l'admin préfectoral crée le dossier d'un praticien
// rencontré sur le terrain, sans smartphone. Le compte du praticien est créé sans mot de
// passe ; un SMS l'invite à le définir par « mot de passe oublié » (US-069). L'agent dépose
// les pièces puis soumet : le dossier entre dans le circuit habituel (étapes 2 à 6).

const message = (failure: unknown) =>
  failure instanceof ApiError
    ? failure.message
    : 'Le service est momentanément indisponible. Veuillez réessayer.';

const longDate = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' }).format(new Date(iso));

export function FieldDossierPage() {
  const [referentials, setReferentials] = useState<FieldDossierReferentials>();
  const [dossiers, setDossiers] = useState<FieldDossier[]>();
  const [loadError, setLoadError] = useState<string>();
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState('');
  // Dossier tout juste créé : ouvert dans la liste, prêt pour le dépôt des pièces
  const [justCreated, setJustCreated] = useState<string>();

  const reload = useCallback(
    () =>
      listFieldDossiers().then(setDossiers, (failure: unknown) => setLoadError(message(failure))),
    [],
  );

  useEffect(() => {
    fetchFieldReferentials().then(setReferentials, (failure: unknown) =>
      setLoadError(message(failure)),
    );
    listFieldDossiers().then(setDossiers, (failure: unknown) => setLoadError(message(failure)));
  }, []);

  return (
    <>
      <PageHeader
        {...PAGE_HEADERS['/dossiers-terrain']}
        actions={
          <Button
            variant="primary"
            icon="plus"
            aria-expanded={creating}
            disabled={!referentials}
            onClick={() => setCreating((value) => !value)}
          >
            Nouveau dossier terrain
          </Button>
        }
      />
      {loadError && <Alert tone="error">{loadError}</Alert>}
      <p role="status" className="ui-live-status">
        {notice}
      </p>
      {creating && referentials && (
        <CreateForm
          referentials={referentials}
          onCancel={() => setCreating(false)}
          onCreated={async (code, name) => {
            setCreating(false);
            setJustCreated(code);
            setNotice(
              `Dossier ${code} créé pour ${name}. Un SMS l’invite à créer son mot de passe. Déposez maintenant les pièces.`,
            );
            await reload();
          }}
        />
      )}
      <section aria-labelledby="dossiers-terrain-liste">
        <h2 id="dossiers-terrain-liste">Dossiers à compléter</h2>
        {dossiers === undefined ? (
          !loadError && <p className="ui-muted">Chargement des dossiers…</p>
        ) : dossiers.length === 0 ? (
          <p className="ui-muted">
            Aucun dossier terrain en cours. Les dossiers soumis passent à la vérification terrain.
          </p>
        ) : (
          <ul className="ui-dossiers" aria-label="Dossiers terrain en cours">
            {dossiers.map((dossier) => (
              <DossierCard
                key={dossier.code}
                dossier={dossier}
                defaultOpen={dossier.code === justCreated}
                onChanged={reload}
                onSubmitted={async (code) => {
                  setNotice(
                    `Dossier ${code} soumis : il passe à la vérification terrain. Le praticien est prévenu par SMS.`,
                  );
                  await reload();
                }}
                announce={setNotice}
              />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

interface FormState {
  prenom: string;
  nom: string;
  telephone: string;
  specialiteId: string;
  sousPrefectureId: string;
  languePrincipale: string;
  anneesExperience: string;
}
type FieldKey = keyof FormState;
const FIELD_ORDER: FieldKey[] = [
  'prenom',
  'nom',
  'telephone',
  'specialiteId',
  'sousPrefectureId',
  'languePrincipale',
  'anneesExperience',
];
const EMPTY: FormState = {
  prenom: '',
  nom: '',
  telephone: '',
  specialiteId: '',
  sousPrefectureId: '',
  languePrincipale: '',
  anneesExperience: '',
};
const REQUIRED: Partial<Record<FieldKey, string>> = {
  specialiteId: 'Choisissez la spécialité.',
  languePrincipale: 'Choisissez la langue principale.',
  anneesExperience: 'Indiquez les années d’expérience.',
};

function CreateForm({
  referentials,
  onCreated,
  onCancel,
}: {
  referentials: FieldDossierReferentials;
  onCreated: (code: string, name: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const id = useId();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const fieldId = (key: FieldKey) => `${id}-${key}`;
  const set = (key: FieldKey, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
    setErrors((current) => {
      if (!(key in current)) return current;
      const rest = { ...current };
      delete rest[key];
      return rest;
    });
  };

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  function focusFirst(found: Partial<Record<FieldKey, string>>) {
    const first = FIELD_ORDER.find((key) => found[key]);
    if (first) document.getElementById(fieldId(first))?.focus();
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    // Mêmes règles que l'API (schéma partagé) : chaque erreur sous son champ
    const found: Partial<Record<FieldKey, string>> = {};
    for (const [key, text] of Object.entries(REQUIRED) as [FieldKey, string][]) {
      if (!form[key].trim()) found[key] = text;
    }
    const parsed = fieldDossierCreateSchema.safeParse({
      prenom: form.prenom,
      nom: form.nom,
      telephone: form.telephone,
      specialiteId: Number(form.specialiteId) || 0,
      sousPrefectureId: form.sousPrefectureId ? Number(form.sousPrefectureId) : null,
      languePrincipale: form.languePrincipale,
      anneesExperience: form.anneesExperience.trim() === '' ? -1 : Number(form.anneesExperience),
    });
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as FieldKey;
        found[key] ??= issue.message;
      }
    }
    setErrors(found);
    if (Object.keys(found).length > 0 || !parsed.success) {
      setError(undefined);
      focusFirst(found);
      return;
    }
    setSending(true);
    setError(undefined);
    try {
      const { code } = await openFieldDossier(parsed.data);
      await onCreated(code, `${parsed.data.prenom} ${parsed.data.nom}`);
    } catch (failure) {
      // Numéro déjà inscrit : sous le champ du téléphone ; tout autre refus en tête
      if (failure instanceof ApiError && failure.status === 409) {
        setErrors({ telephone: failure.message });
        focusFirst({ telephone: failure.message });
      } else {
        setError(message(failure));
      }
      setSending(false);
    }
  }

  return (
    <section aria-labelledby={`${id}-title`} className="ui-card ui-card--plain">
      <h2 id={`${id}-title`}>Nouveau dossier terrain</h2>
      <p className="ui-muted">
        Pour un praticien rencontré sur le terrain, dans la préfecture de {referentials.prefecture}.
        Son compte est créé sans mot de passe : il reçoit un SMS qui l’invite à le créer depuis
        l’application SABOU.
      </p>
      <form className="ui-form" onSubmit={onSubmit} noValidate>
        {error && (
          <Alert tone="error" ref={errorRef}>
            {error}
          </Alert>
        )}
        <fieldset className="ui-form-section">
          <legend className="ui-form-section__legend">Identité du praticien</legend>
          <div className="ui-form-row">
            <TextField
              id={fieldId('prenom')}
              label="Prénom"
              autoComplete="off"
              maxLength={50}
              value={form.prenom}
              error={errors.prenom}
              onChange={(event) => set('prenom', event.target.value)}
            />
            <TextField
              id={fieldId('nom')}
              label="Nom"
              hint="Porté par le certificat."
              autoComplete="off"
              maxLength={80}
              value={form.nom}
              error={errors.nom}
              onChange={(event) => set('nom', event.target.value)}
            />
          </div>
          <TextField
            id={fieldId('telephone')}
            label="Téléphone du praticien"
            hint="Mobile guinéen, par exemple 621 23 45 67. Il recevra les SMS du dossier."
            type="tel"
            inputMode="tel"
            autoComplete="off"
            value={form.telephone}
            error={errors.telephone}
            onChange={(event) => set('telephone', event.target.value)}
          />
        </fieldset>
        <fieldset className="ui-form-section">
          <legend className="ui-form-section__legend">Pratique</legend>
          <div className="ui-form-row">
            <SelectField
              id={fieldId('specialiteId')}
              label="Spécialité"
              value={form.specialiteId}
              error={errors.specialiteId}
              onChange={(event) => set('specialiteId', event.target.value)}
            >
              <option value="">Choisir…</option>
              {referentials.specialites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.libelle}
                </option>
              ))}
            </SelectField>
            <TextField
              id={fieldId('anneesExperience')}
              label="Années d’expérience"
              type="number"
              inputMode="numeric"
              min={0}
              max={80}
              value={form.anneesExperience}
              error={errors.anneesExperience}
              onChange={(event) => set('anneesExperience', event.target.value)}
            />
          </div>
          <div className="ui-form-row">
            <SelectField
              id={fieldId('sousPrefectureId')}
              label="Sous-préfecture (facultative)"
              value={form.sousPrefectureId}
              error={errors.sousPrefectureId}
              onChange={(event) => set('sousPrefectureId', event.target.value)}
            >
              <option value="">Non précisée</option>
              {referentials.sousPrefectures.map((sp) => (
                <option key={sp.id} value={sp.id}>
                  {sp.nom}
                </option>
              ))}
            </SelectField>
            <SelectField
              id={fieldId('languePrincipale')}
              label="Langue principale"
              value={form.languePrincipale}
              error={errors.languePrincipale}
              onChange={(event) => set('languePrincipale', event.target.value)}
            >
              <option value="">Choisir…</option>
              {referentials.langues.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.nom}
                </option>
              ))}
            </SelectField>
          </div>
        </fieldset>
        <div className="ui-form__actions">
          <Button type="submit" variant="primary" disabled={sending}>
            {sending ? 'Création…' : 'Créer le dossier'}
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Annuler
          </Button>
        </div>
      </form>
    </section>
  );
}

function DossierCard({
  dossier,
  defaultOpen,
  onChanged,
  onSubmitted,
  announce,
}: {
  dossier: FieldDossier;
  defaultOpen: boolean;
  onChanged: () => Promise<void>;
  onSubmitted: (code: string) => Promise<void>;
  announce: (text: string) => void;
}) {
  const id = useId();
  const [type, setType] = useState<PractitionerPieceType>(
    dossier.piecesManquantes[0] ?? 'identite',
  );
  const [file, setFile] = useState<File>();
  const [fileError, setFileError] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }

  function onAdd(event: FormEvent) {
    event.preventDefault();
    if (!file) {
      setFileError('Choisissez le fichier de la pièce.');
      return;
    }
    setFileError(undefined);
    void run(async () => {
      try {
        await addFieldPiece(dossier.code, type, file);
      } catch (failure) {
        // Format ou taille refusés : sous le champ du fichier
        if (failure instanceof ApiError && (failure.status === 413 || failure.status === 415)) {
          setFileError(failure.message);
          return;
        }
        throw failure;
      }
      setFile(undefined);
      if (fileInput.current) fileInput.current.value = '';
      announce(`${PIECE_LABELS[type]} ajoutée au dossier ${dossier.code}.`);
      await onChanged();
    });
  }

  const complete = dossier.piecesManquantes.length === 0;
  const missing = dossier.piecesManquantes.length;
  return (
    <DossierRow
      code={dossier.code}
      name={dossier.praticien}
      defaultOpen={defaultOpen}
      meta={
        <>
          {dossier.specialite} · créé le {longDate(dossier.creeLe)}
          {complete ? (
            <Badge tone="success">Prêt à soumettre</Badge>
          ) : (
            <Badge tone="warning">
              {missing} pièce{missing > 1 ? 's' : ''} manquante{missing > 1 ? 's' : ''}
            </Badge>
          )}
        </>
      }
    >
      {error && <Alert tone="error">{error}</Alert>}
      <dl className="ui-facts">
        <dt>Praticien</dt>
        <dd>{dossier.praticien}</dd>
        <dt>Téléphone</dt>
        <dd>{formatNationalMobile(dossier.telephone)}</dd>
        <dt>Spécialité</dt>
        <dd>{dossier.specialite}</dd>
        <dt>Créé le</dt>
        <dd>{longDate(dossier.creeLe)}</dd>
        <dt>Origine</dt>
        <dd>Dossier terrain, créé par vous</dd>
      </dl>
      <section aria-labelledby={`${id}-pieces`} className="ui-stack">
        <h4 id={`${id}-pieces`}>Pièces du dossier</h4>
        {dossier.pieces.length === 0 ? (
          <p className="ui-muted">Aucune pièce déposée.</p>
        ) : (
          <ul className="ui-list">
            {dossier.pieces.map((piece) => (
              <li key={piece.id}>
                <span>
                  {piece.type === 'compte_rendu_visite'
                    ? 'Compte rendu de visite'
                    : PIECE_LABELS[piece.type]}
                </span>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await removeFieldPiece(dossier.code, piece.id);
                      announce(`Pièce retirée du dossier ${dossier.code}.`);
                      await onChanged();
                    })
                  }
                >
                  Retirer{' '}
                  <span className="ui-visually-hidden">cette pièce du dossier {dossier.code}</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
        {!complete && (
          <p className="ui-muted">
            Pièces obligatoires manquantes :{' '}
            {dossier.piecesManquantes.map((t) => PIECE_LABELS[t].toLowerCase()).join(', ')}.
          </p>
        )}
      </section>
      <form className="ui-form" onSubmit={onAdd} noValidate>
        <div className="ui-form-row">
          <SelectField
            label="Type de pièce"
            value={type}
            onChange={(event) => setType(event.target.value as PractitionerPieceType)}
          >
            {PRACTITIONER_PIECE_TYPES.map((t) => (
              <option key={t} value={t}>
                {PIECE_LABELS[t]}
              </option>
            ))}
          </SelectField>
          <TextField
            ref={fileInput}
            type="file"
            label="Fichier"
            hint="Photo JPEG ou PNG, ou document PDF, 5 Mo au plus."
            accept="image/jpeg,image/png,application/pdf"
            error={fileError}
            onChange={(event) => {
              setFile(event.target.files?.[0]);
              setFileError(undefined);
            }}
          />
        </div>
        <div className="ui-form__actions">
          <Button type="submit" variant="secondary" disabled={busy}>
            Ajouter la pièce <span className="ui-visually-hidden">au dossier {dossier.code}</span>
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={busy || !complete}
            onClick={() =>
              void run(async () => {
                await submitFieldDossier(dossier.code);
                await onSubmitted(dossier.code);
              })
            }
          >
            Soumettre le dossier <span className="ui-visually-hidden">{dossier.code}</span>
          </Button>
        </div>
      </form>
    </DossierRow>
  );
}
