import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Alert, Badge, Button, DataTable, PageHeader, TextField } from '@sabou/ui';
import type { PlantFields, PlantStatus, PlantSummary } from '@sabou/types';
import { ApiError } from './accounts-api';
import { createPlant, listPlants } from './plants-api';

// Fiches plantes du Dictionnaire (US-050, UC-05) : liste, recherche et création, pour la DG
// et le Comité scientifique. La base contrôle le rôle et l'unicité du nom scientifique.

// Définis ici plutôt qu'importés de @sabou/types : l'application n'en importe que des types,
// pour ne pas embarquer zod dans le paquet téléchargé (réseau 3G)
export const SCIENTIFIC_NAME_MAX_LENGTH = 150;
export const FAMILY_MAX_LENGTH = 100;
export const NAME_MAX_LENGTH = 150;
const SEARCH_MAX_LENGTH = 100;

export const STATUS: Record<PlantStatus, [label: string, tone: 'warning' | 'success']> = {
  en_revue: ['En revue', 'warning'],
  validee: ['Validée', 'success'],
};

const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : 'Une erreur est survenue.';

export function PlantsPage() {
  const [plants, setPlants] = useState<PlantSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string>();
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');

  useEffect(() => {
    let active = true;
    listPlants().then(
      (rows) => active && setPlants(rows),
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
      setPlants(await listPlants(q));
      setSearched(q);
      setLoadError(undefined);
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }

  return (
    <>
      <PageHeader
        title="Fiches plantes"
        lead="Dictionnaire des plantes : une fiche par plante, commune à toutes les langues. Les fiches nouvelles ou modifiées sont « en revue » jusqu’à la validation du Comité scientifique."
      />
      <NewPlantForm />
      <section className="ui-section" aria-labelledby="fiches-titre">
        <h2 id="fiches-titre">Fiches</h2>
        <form className="ui-form__actions" role="search" onSubmit={onSearch}>
          <TextField
            label="Rechercher une plante"
            hint="Nom français, scientifique ou anglais, ou code (PL-001)."
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
        {plants === null && !loadError && <p>Chargement…</p>}
        {plants && (
          <DataTable
            caption={searched ? `Fiches trouvées pour « ${searched} »` : 'Toutes les fiches'}
            rows={plants}
            rowKey={(plant) => plant.code}
            empty={searched ? 'Aucune fiche ne correspond.' : 'Aucune fiche pour l’instant.'}
            columns={[
              {
                key: 'nom',
                header: 'Plante',
                render: (plant) => (
                  <a href={`/plantes/${plant.code}`}>
                    {plant.nomFr} <span className="ui-visually-hidden">, fiche {plant.code}</span>
                  </a>
                ),
              },
              {
                key: 'scientifique',
                header: 'Nom scientifique',
                render: (plant) => <i>{plant.nomScientifique}</i>,
              },
              { key: 'famille', header: 'Famille', render: (plant) => plant.famille },
              {
                key: 'statut',
                header: 'Statut',
                render: (plant) => (
                  <Badge tone={STATUS[plant.statut][1]}>{STATUS[plant.statut][0]}</Badge>
                ),
              },
              {
                key: 'photo',
                header: 'Photo principale',
                render: (plant) => (plant.image ? 'Oui' : 'Non'),
              },
            ]}
          />
        )}
      </section>
    </>
  );
}

// Champs communs à la création et à la modification d'une fiche
export function PlantFieldInputs({
  value,
  onChange,
}: {
  value: PlantFields;
  onChange: (value: PlantFields) => void;
}) {
  const set = (field: keyof PlantFields) => (event: { target: { value: string } }) =>
    onChange({ ...value, [field]: event.target.value });
  return (
    <>
      <TextField
        label="Nom scientifique"
        hint="Unique : deux fiches ne peuvent pas porter le même nom scientifique."
        required
        maxLength={SCIENTIFIC_NAME_MAX_LENGTH}
        value={value.nomScientifique}
        onChange={set('nomScientifique')}
      />
      <TextField
        label="Famille"
        required
        maxLength={FAMILY_MAX_LENGTH}
        value={value.famille}
        onChange={set('famille')}
      />
      <TextField
        label="Nom français"
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
    </>
  );
}

const EMPTY: PlantFields = { nomScientifique: '', famille: '', nomFr: '', nomEn: '' };

function NewPlantForm() {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const [fields, setFields] = useState<PlantFields>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const firstField = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (open) firstField.current?.querySelector('input')?.focus();
  }, [open]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const plant = await createPlant(fields);
      // La fiche créée s'ouvre : on y ajoute aussitôt sa photo principale
      window.location.assign(`/plantes/${plant.code}?creee=1`);
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div>
        <Button variant="primary" icon="plus" onClick={() => setOpen(true)}>
          Nouvelle fiche plante
        </Button>
      </div>
    );
  }
  return (
    <form
      ref={firstField}
      className="ui-form ui-card ui-card--plain"
      aria-labelledby={titleId}
      onSubmit={onSubmit}
    >
      <h2 id={titleId}>Nouvelle fiche plante</h2>
      {error && <Alert tone="error">{error}</Alert>}
      <PlantFieldInputs value={fields} onChange={setFields} />
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
