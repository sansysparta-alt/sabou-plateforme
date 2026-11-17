import { useEffect, useId, useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  DataTable,
  PageHeader,
  SelectField,
  TextAreaField,
  TextField,
} from '@sabou/ui';
import type {
  Denomination,
  DenominationLanguage,
  DiseaseDetail,
  DiseaseFields,
  DiseaseSummary,
} from '@sabou/types';
import { ApiError, call } from './accounts-api';

// Fiches maladies du Dictionnaire (US-052, UC-05) : liste, recherche, création et fiche, pour
// la DG et le Comité scientifique. Dénominations (synonymes) en français ou en anglais : aucun
// texte en langue nationale (R-LNG-02). La base contrôle le rôle et l'unicité du nom français.

// Définis ici plutôt qu'importés de @sabou/types (pas de zod dans le paquet téléchargé)
const NAME_MAX_LENGTH = 150;
const SYMPTOMS_MAX_LENGTH = 2000;
const DENOMINATIONS_MAX = 30;
const SEARCH_MAX_LENGTH = 100;
const LANGUAGES: [DenominationLanguage, string][] = [
  ['fr', 'Français'],
  ['en', 'Anglais'],
];

const BASE = '/api/maladies';
const diseasePath = (code: string) => `${BASE}/${encodeURIComponent(code)}`;
const listDiseases = (q = '') =>
  call<DiseaseSummary[]>(q ? `${BASE}?q=${encodeURIComponent(q)}` : BASE);
const fetchDisease = (code: string) => call<DiseaseDetail>(diseasePath(code));
const createDisease = (fields: DiseaseFields) => call<DiseaseDetail>(BASE, fields);
const updateDisease = (code: string, fields: DiseaseFields, vueLe: string) =>
  call<DiseaseDetail>(diseasePath(code), { ...fields, vueLe }, 'PATCH');

const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : 'Une erreur est survenue.';

// Dénominations vides retirées avant l'envoi
const cleaned = (fields: DiseaseFields): DiseaseFields => ({
  ...fields,
  denominations: fields.denominations.filter((d) => d.denomination.trim() !== ''),
});

export function DiseasesPage() {
  const [diseases, setDiseases] = useState<DiseaseSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string>();
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');

  useEffect(() => {
    let active = true;
    listDiseases().then(
      (rows) => active && setDiseases(rows),
      (error: unknown) => active && setLoadError(errorMessage(error)),
    );
    return () => {
      active = false;
    };
  }, []);

  async function onSearch(event: FormEvent) {
    event.preventDefault();
    const q = query.trim();
    try {
      setDiseases(await listDiseases(q));
      setSearched(q);
      setLoadError(undefined);
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }

  return (
    <>
      <PageHeader
        title="Fiches maladies"
        lead="Une fiche par maladie : nom français, nom anglais, dénominations et symptômes. La recherche trouve aussi les dénominations, avec ou sans accents."
      />
      <NewDiseaseForm />
      <section className="ui-section" aria-labelledby="maladies-titre">
        <h2 id="maladies-titre">Fiches</h2>
        <form className="ui-form__actions" role="search" onSubmit={onSearch}>
          <TextField
            label="Rechercher une maladie"
            hint="Nom français ou anglais, dénomination, ou code (MA-001)."
            type="search"
            value={query}
            maxLength={SEARCH_MAX_LENGTH}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div>
            <Button type="submit" variant="secondary">
              Rechercher
            </Button>
          </div>
        </form>
        {loadError && <Alert tone="error">{loadError}</Alert>}
        {diseases === null && !loadError && <p>Chargement…</p>}
        {diseases && (
          <DataTable
            caption={searched ? `Fiches trouvées pour « ${searched} »` : 'Toutes les fiches'}
            rows={diseases}
            rowKey={(disease) => disease.code}
            empty={searched ? 'Aucune fiche ne correspond.' : 'Aucune fiche pour l’instant.'}
            columns={[
              {
                key: 'nom',
                header: 'Maladie',
                render: (disease) => (
                  <a href={`/maladies/${disease.code}`}>
                    {disease.nomFr}
                    <span className="ui-visually-hidden">, fiche {disease.code}</span>
                  </a>
                ),
              },
              { key: 'en', header: 'Nom anglais', render: (disease) => disease.nomEn ?? '—' },
              {
                key: 'denominations',
                header: 'Dénominations',
                render: (disease) => disease.denominations.join(', ') || '—',
              },
            ]}
          />
        )}
      </section>
    </>
  );
}

function DiseaseFieldInputs({
  value,
  onChange,
}: {
  value: DiseaseFields;
  onChange: (value: DiseaseFields) => void;
}) {
  const set =
    (field: 'nomFr' | 'nomEn' | 'symptomesFr' | 'symptomesEn') =>
    (event: { target: { value: string } }) =>
      onChange({ ...value, [field]: event.target.value });
  const setDenomination = (index: number, change: Partial<Denomination>) =>
    onChange({
      ...value,
      denominations: value.denominations.map((d, i) => (i === index ? { ...d, ...change } : d)),
    });
  return (
    <>
      <TextField
        label="Nom français"
        hint="Unique : deux fiches ne peuvent pas porter le même nom."
        required
        maxLength={NAME_MAX_LENGTH}
        value={value.nomFr}
        onChange={set('nomFr')}
      />
      <TextField
        label="Nom anglais (facultatif)"
        maxLength={NAME_MAX_LENGTH}
        value={value.nomEn ?? ''}
        onChange={set('nomEn')}
      />
      <TextAreaField
        label="Symptômes (facultatif)"
        maxLength={SYMPTOMS_MAX_LENGTH}
        value={value.symptomesFr ?? ''}
        onChange={set('symptomesFr')}
      />
      <TextAreaField
        label="Symptômes en anglais (facultatif)"
        maxLength={SYMPTOMS_MAX_LENGTH}
        value={value.symptomesEn ?? ''}
        onChange={set('symptomesEn')}
      />
      <fieldset className="ui-fieldset">
        <legend className="ui-fieldset__legend">Dénominations</legend>
        <p className="ui-field__hint">
          Autres noms de la maladie, en français ou en anglais. Les noms en langue nationale sont
          enregistrés en voix, pas par écrit.
        </p>
        {value.denominations.map((denomination, index) => (
          <div key={index} className="ui-form__actions">
            <SelectField
              label={`Langue de la dénomination ${index + 1}`}
              value={denomination.langue}
              onChange={(event) =>
                setDenomination(index, { langue: event.target.value as DenominationLanguage })
              }
            >
              {LANGUAGES.map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </SelectField>
            <TextField
              label={`Dénomination ${index + 1}`}
              maxLength={NAME_MAX_LENGTH}
              value={denomination.denomination}
              onChange={(event) => setDenomination(index, { denomination: event.target.value })}
            />
            <div>
              <Button
                variant="tertiary"
                onClick={() =>
                  onChange({
                    ...value,
                    denominations: value.denominations.filter((_, i) => i !== index),
                  })
                }
              >
                Retirer <span className="ui-visually-hidden">la dénomination {index + 1}</span>
              </Button>
            </div>
          </div>
        ))}
        {value.denominations.length < DENOMINATIONS_MAX && (
          <div>
            <Button
              variant="secondary"
              icon="plus"
              onClick={() =>
                onChange({
                  ...value,
                  denominations: [...value.denominations, { langue: 'fr', denomination: '' }],
                })
              }
            >
              Ajouter une dénomination
            </Button>
          </div>
        )}
      </fieldset>
    </>
  );
}

const EMPTY: DiseaseFields = {
  nomFr: '',
  nomEn: '',
  symptomesFr: '',
  symptomesEn: '',
  denominations: [],
};

function NewDiseaseForm() {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<DiseaseFields>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const disease = await createDisease(cleaned(fields));
      window.location.assign(`/maladies/${disease.code}`);
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div>
        <Button variant="primary" icon="plus" onClick={() => setOpen(true)}>
          Nouvelle fiche maladie
        </Button>
      </div>
    );
  }
  return (
    <form className="ui-form ui-card ui-card--plain" aria-labelledby={titleId} onSubmit={onSubmit}>
      <h2 id={titleId}>Nouvelle fiche maladie</h2>
      {error && <Alert tone="error">{error}</Alert>}
      <DiseaseFieldInputs value={fields} onChange={setFields} />
      <div className="ui-form__actions">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Création…' : 'Créer la fiche'}
        </Button>
        <Button
          variant="tertiary"
          disabled={busy}
          onClick={() => {
            setOpen(false);
            setFields(EMPTY);
            setError(undefined);
          }}
        >
          Annuler
        </Button>
      </div>
    </form>
  );
}

const fieldsOf = (disease: DiseaseDetail): DiseaseFields => ({
  nomFr: disease.nomFr,
  nomEn: disease.nomEn ?? '',
  symptomesFr: disease.symptomesFr ?? '',
  symptomesEn: disease.symptomesEn ?? '',
  denominations: disease.denominations,
});

export function DiseasePage({ code }: { code: string }) {
  const titleId = useId();
  const [disease, setDisease] = useState<DiseaseDetail | null>(null);
  const [fields, setFields] = useState<DiseaseFields>(EMPTY);
  const [loadError, setLoadError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    fetchDisease(code).then(
      (detail) => {
        if (!active) return;
        setDisease(detail);
        setFields(fieldsOf(detail));
      },
      (failure: unknown) => active && setLoadError(errorMessage(failure)),
    );
    return () => {
      active = false;
    };
  }, [code]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!disease) return;
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      const updated = await updateDisease(disease.code, cleaned(fields), disease.modifieLe);
      setDisease(updated);
      setFields(fieldsOf(updated));
      setSaved(true);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title={disease?.nomFr ?? 'Fiche maladie'}
        lead={disease ? `Fiche ${disease.code}` : undefined}
      />
      <p>
        <a href="/maladies">Retour aux fiches maladies</a>
      </p>
      {loadError && <Alert tone="error">{loadError}</Alert>}
      {!disease && !loadError && <p>Chargement…</p>}
      {disease && (
        <form
          className="ui-form ui-card ui-card--plain"
          aria-labelledby={titleId}
          onSubmit={onSubmit}
        >
          <h2 id={titleId}>Contenu de la fiche</h2>
          {error && <Alert tone="error">{error}</Alert>}
          <div role="status">{saved && <Alert tone="success">Fiche enregistrée.</Alert>}</div>
          <DiseaseFieldInputs value={fields} onChange={setFields} />
          <div className="ui-form__actions">
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? 'Enregistrement…' : 'Enregistrer la fiche'}
            </Button>
          </div>
        </form>
      )}
    </>
  );
}
