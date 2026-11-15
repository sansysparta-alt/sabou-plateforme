import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  ListToolbar,
  PageHeader,
  SearchBox,
  SegmentedFilter,
  StatCard,
  TextField,
  useDebounced,
} from '@sabou/ui';
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
// Plafond de la liste renvoyée par l'API (PLANT_LIST_LIMIT, plants.repository.ts)
const PLANT_LIST_LIMIT = 200;

export const STATUS: Record<PlantStatus, [label: string, tone: 'warning' | 'success']> = {
  en_revue: ['En revue', 'warning'],
  validee: ['Validée', 'success'],
};

const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : 'Une erreur est survenue.';

type StatusFilter = 'toutes' | PlantStatus;

// Gabarit de liste (05 §2.45) : en-tête et action, chiffres, recherche et filtre, tableau
// paginé. La recherche part vers l'API une fois la frappe arrêtée (accents, noms
// scientifiques et anglais : la base sait chercher) ; le filtre de statut trie la réponse.
export function PlantsPage() {
  const [plants, setPlants] = useState<PlantSummary[] | null>(null);
  // Dictionnaire entier, lu à l'ouverture : base des chiffres clés
  const [all, setAll] = useState<PlantSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string>();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('toutes');
  const [creating, setCreating] = useState(false);
  const searched = useDebounced(query.trim());

  useEffect(() => {
    let active = true;
    listPlants(searched).then(
      (rows) => {
        if (!active) return;
        setPlants(rows);
        if (searched === '') setAll(rows);
        setLoadError(undefined);
      },
      (error: unknown) => active && setLoadError(errorMessage(error)),
    );
    return () => {
      active = false;
    };
  }, [searched]);

  const count = (rows: PlantSummary[] | null, wanted: StatusFilter) =>
    (rows ?? []).filter((plant) => wanted === 'toutes' || plant.statut === wanted).length;
  const rows = (plants ?? []).filter((plant) => status === 'toutes' || plant.statut === status);

  return (
    <>
      <PageHeader
        title="Fiches plantes"
        lead="Une fiche par plante, commune à toutes les langues. Une fiche nouvelle ou modifiée reste « en revue » jusqu’à la validation du Comité scientifique."
        actions={
          <Button
            variant="primary"
            icon="plus"
            aria-expanded={creating}
            onClick={() => setCreating((value) => !value)}
          >
            Nouvelle fiche plante
          </Button>
        }
      />
      {creating && <NewPlantForm onCancel={() => setCreating(false)} />}
      {loadError && <Alert tone="error">{loadError}</Alert>}
      {all && (
        <div className="ui-grid ui-grid--stats" role="group" aria-label="Chiffres des fiches">
          <StatCard label="Fiches" value={all.length} />
          <StatCard label="En revue" value={count(all, 'en_revue')} />
          <StatCard label="Validées" value={count(all, 'validee')} />
          <StatCard label="Sans photo principale" value={all.filter((p) => !p.image).length} />
        </div>
      )}
      {plants === null && !loadError && <p>Chargement…</p>}
      {plants && (
        <section className="ui-section" aria-labelledby="fiches-titre">
          <h2 id="fiches-titre" className="ui-visually-hidden">
            Fiches
          </h2>
          <ListToolbar>
            <SearchBox
              label="Rechercher une plante"
              placeholder="Nom français, scientifique ou anglais, ou code (PL-001)"
              value={query}
              maxLength={SEARCH_MAX_LENGTH}
              onChange={setQuery}
            />
            <SegmentedFilter
              label="Filtrer par statut"
              value={status}
              onChange={setStatus}
              options={[
                { value: 'toutes', label: 'Toutes', count: count(plants, 'toutes') },
                { value: 'en_revue', label: 'En revue', count: count(plants, 'en_revue') },
                { value: 'validee', label: 'Validées', count: count(plants, 'validee') },
              ]}
            />
          </ListToolbar>
          {plants.length >= PLANT_LIST_LIMIT && (
            <p className="ui-muted">
              Seules les {PLANT_LIST_LIMIT} premières fiches sont listées : précisez la recherche.
            </p>
          )}
          <DataTable
            caption={searched ? `Fiches trouvées pour « ${searched} »` : 'Toutes les fiches'}
            captionHidden
            rows={rows}
            rowKey={(plant) => plant.code}
            empty={
              searched || status !== 'toutes'
                ? 'Aucune fiche ne correspond.'
                : 'Aucune fiche pour l’instant.'
            }
            paginate={{ key: 'plantes', noun: ['fiche', 'fiches'], resetOn: [searched, status] }}
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
        </section>
      )}
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

// Formulaire de création, ouvert sous l'en-tête à la demande ; le focus va au premier champ
function NewPlantForm({ onCancel }: { onCancel: () => void }) {
  const titleId = useId();
  const [fields, setFields] = useState<PlantFields>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const firstField = useRef<HTMLFormElement>(null);

  useEffect(() => {
    firstField.current?.querySelector('input')?.focus();
  }, []);

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
        <Button variant="tertiary" disabled={busy} onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  );
}
