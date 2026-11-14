import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { Alert, Badge, Button, PageHeader, SelectField, TextField } from '@sabou/ui';
import type {
  PlantDetail,
  PlantFields,
  PlantImage,
  PlantImageFields,
  PlantImageType,
} from '@sabou/types';
import { ApiError } from './accounts-api';
import {
  addPlantImage,
  fetchPlant,
  plantImageUrl,
  removePlantImage,
  updatePlant,
  updatePlantImage,
} from './plants-api';
import { PlantFieldInputs, STATUS } from './PlantsPage';

// Une fiche plante (US-050) : ses champs et ses photos. Une seule photo principale, texte
// alternatif obligatoire (R-PLA-04) ; la base le garantit, l'écran le dit.

// Définis ici plutôt qu'importés de @sabou/types (pas de zod dans le paquet téléchargé)
const ALT_MAX_LENGTH = 250;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES: [PlantImageType, string][] = [
  ['plante_entiere', 'Plante entière'],
  ['feuille', 'Feuille'],
  ['ecorce', 'Écorce'],
  ['racine', 'Racine'],
  ['produit_prepare', 'Produit préparé'],
  ['autre', 'Autre'],
];
const ACCEPTED = 'image/jpeg,image/png,image/webp';

const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : 'Une erreur est survenue.';

const fieldsOf = (plant: PlantDetail): PlantFields => ({
  nomScientifique: plant.nomScientifique,
  famille: plant.famille,
  nomFr: plant.nomFr,
  nomEn: plant.nomEn ?? '',
});

export function PlantPage({ code }: { code: string }) {
  const [plant, setPlant] = useState<PlantDetail | null>(null);
  const [loadError, setLoadError] = useState<string>();
  // Fiche tout juste créée (?creee=1), lu une fois puis retiré de l'adresse
  const [created] = useState(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('creee')) return false;
    url.searchParams.delete('creee');
    window.history.replaceState(null, '', url);
    return true;
  });

  useEffect(() => {
    let active = true;
    fetchPlant(code).then(
      (detail) => active && setPlant(detail),
      (error: unknown) => active && setLoadError(errorMessage(error)),
    );
    return () => {
      active = false;
    };
  }, [code]);

  if (!plant) {
    return (
      <>
        <PageHeader title="Fiche plante" />
        {loadError ? <Alert tone="error">{loadError}</Alert> : <p>Chargement…</p>}
        <p>
          <a href="/plantes">Retour aux fiches plantes</a>
        </p>
      </>
    );
  }
  const [statusLabel, tone] = STATUS[plant.statut];
  return (
    <>
      <PageHeader title={plant.nomFr} lead={`Fiche ${plant.code}`} />
      <p>
        <a href="/plantes">Retour aux fiches plantes</a>
      </p>
      {created && (
        <Alert tone="success" title="Fiche créée">
          Ajoutez maintenant sa photo principale.
        </Alert>
      )}
      <p>
        Statut : <Badge tone={tone}>{statusLabel}</Badge>
      </p>
      <PlantForm plant={plant} onSaved={setPlant} />
      <PlantImages plant={plant} onChanged={setPlant} />
    </>
  );
}

function PlantForm({
  plant,
  onSaved,
}: {
  plant: PlantDetail;
  onSaved: (plant: PlantDetail) => void;
}) {
  const titleId = useId();
  const [fields, setFields] = useState(() => fieldsOf(plant));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    setSaved(false);
    try {
      const updated = await updatePlant(plant.code, { ...fields, vueLe: plant.modifieLe });
      onSaved(updated);
      setFields(fieldsOf(updated));
      setSaved(true);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="ui-form ui-card ui-card--plain" aria-labelledby={titleId} onSubmit={onSubmit}>
      <h2 id={titleId}>Identité de la plante</h2>
      {error && <Alert tone="error">{error}</Alert>}
      {saved && (
        <div role="status">
          <Alert tone="success">Fiche enregistrée.</Alert>
        </div>
      )}
      <PlantFieldInputs value={fields} onChange={setFields} />
      <div className="ui-form__actions">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Enregistrement…' : 'Enregistrer la fiche'}
        </Button>
      </div>
    </form>
  );
}

function PlantImages({
  plant,
  onChanged,
}: {
  plant: PlantDetail;
  onChanged: (plant: PlantDetail) => void;
}) {
  const [notice, setNotice] = useState<string>();
  const changed = (updated: PlantDetail, message: string) => {
    onChanged(updated);
    setNotice(message);
  };
  return (
    <section className="ui-section" aria-labelledby="photos-titre">
      <h2 id="photos-titre">Photos</h2>
      <p className="ui-muted">
        Une seule photo principale, montrée en tête de la fiche. Chaque photo a un texte alternatif,
        lu à la place de l’image par les lecteurs d’écran.
      </p>
      <div role="status">{notice && <Alert tone="success">{notice}</Alert>}</div>
      {plant.images.length === 0 ? (
        <p>Aucune photo : la fiche publique montrera une illustration par défaut.</p>
      ) : (
        <ul className="ui-list">
          {plant.images.map((image) => (
            <ImageItem key={image.id} plant={plant} image={image} onChanged={changed} />
          ))}
        </ul>
      )}
      <AddImageForm plant={plant} onAdded={(updated) => changed(updated, 'Photo ajoutée.')} />
    </section>
  );
}

function ImageItem({
  plant,
  image,
  onChanged,
}: {
  plant: PlantDetail;
  image: PlantImage;
  onChanged: (plant: PlantDetail, message: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const typeLabel = IMAGE_TYPES.find(([type]) => type === image.type)?.[1] ?? image.type;

  async function run(action: () => Promise<PlantDetail>, message: string) {
    setBusy(true);
    setError(undefined);
    try {
      onChanged(await action(), message);
      setEditing(false);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li>
      <img
        className="ui-thumb"
        src={plantImageUrl(plant.code, image.id)}
        alt={image.alt}
        width={160}
        height={120}
        loading="lazy"
        decoding="async"
      />
      <div className="ui-stack">
        <p>
          {image.principale && <Badge tone="success">Photo principale</Badge>} {typeLabel}
        </p>
        <p>
          Texte alternatif : {image.alt}
          {image.altEn && <> · en anglais : {image.altEn}</>}
        </p>
        {error && <Alert tone="error">{error}</Alert>}
        {editing ? (
          <ImageFieldsForm
            title="Modifier la photo"
            initial={image}
            busy={busy}
            submitLabel="Enregistrer la photo"
            onCancel={() => setEditing(false)}
            onSubmit={(fields) =>
              run(() => updatePlantImage(plant.code, image.id, fields), 'Photo enregistrée.')
            }
          />
        ) : (
          <div className="ui-form__actions">
            {!image.principale && (
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  run(
                    () =>
                      updatePlantImage(plant.code, image.id, {
                        alt: image.alt,
                        altEn: image.altEn,
                        type: image.type,
                        principale: true,
                      }),
                    'Photo principale changée.',
                  )
                }
              >
                Choisir comme photo principale
                <span className="ui-visually-hidden"> : {image.alt}</span>
              </Button>
            )}
            <Button variant="tertiary" disabled={busy} onClick={() => setEditing(true)}>
              Modifier <span className="ui-visually-hidden">la photo : {image.alt}</span>
            </Button>
            <Button
              variant="tertiary"
              disabled={busy}
              onClick={() => {
                if (window.confirm('Retirer cette photo de la fiche ?')) {
                  void run(() => removePlantImage(plant.code, image.id), 'Photo retirée.');
                }
              }}
            >
              Retirer <span className="ui-visually-hidden">la photo : {image.alt}</span>
            </Button>
          </div>
        )}
      </div>
    </li>
  );
}

// Description d'une photo : texte alternatif (obligatoire), anglais, type, principale
function ImageFieldsForm({
  title,
  initial,
  busy,
  submitLabel,
  onSubmit,
  onCancel,
  file,
}: {
  title: string;
  initial: PlantImageFields;
  busy: boolean;
  submitLabel: string;
  onSubmit: (fields: PlantImageFields) => void;
  onCancel?: () => void;
  file?: ReactNode;
}) {
  const titleId = useId();
  const [fields, setFields] = useState(initial);
  return (
    <form
      className="ui-form ui-card ui-card--plain"
      aria-labelledby={titleId}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ ...fields, altEn: fields.altEn?.trim() ? fields.altEn : null });
      }}
    >
      <h3 id={titleId}>{title}</h3>
      {file}
      <TextField
        label="Texte alternatif"
        hint="Ce que montre la photo, en une phrase (ex. « Feuilles séchées de kinkéliba »)."
        required
        maxLength={ALT_MAX_LENGTH}
        value={fields.alt}
        onChange={(event) => setFields({ ...fields, alt: event.target.value })}
      />
      <TextField
        label="Texte alternatif en anglais (facultatif)"
        maxLength={ALT_MAX_LENGTH}
        value={fields.altEn ?? ''}
        onChange={(event) => setFields({ ...fields, altEn: event.target.value })}
      />
      <SelectField
        label="Ce que montre la photo"
        value={fields.type}
        onChange={(event) => setFields({ ...fields, type: event.target.value as PlantImageType })}
      >
        {IMAGE_TYPES.map(([type, label]) => (
          <option key={type} value={type}>
            {label}
          </option>
        ))}
      </SelectField>
      <label className="ui-choice">
        <input
          type="checkbox"
          checked={fields.principale}
          disabled={initial.principale}
          onChange={(event) => setFields({ ...fields, principale: event.target.checked })}
        />
        Photo principale
      </label>
      <div className="ui-form__actions">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Enregistrement…' : submitLabel}
        </Button>
        {onCancel && (
          <Button variant="tertiary" disabled={busy} onClick={onCancel}>
            Annuler
          </Button>
        )}
      </div>
    </form>
  );
}

function AddImageForm({
  plant,
  onAdded,
}: {
  plant: PlantDetail;
  onAdded: (plant: PlantDetail) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // Nouveau formulaire après chaque ajout (champs vidés)
  const [round, setRound] = useState(0);

  async function onSubmit(fields: PlantImageFields) {
    if (!file) {
      setError('Choisissez la photo à ajouter.');
      return;
    }
    if (file.size > IMAGE_MAX_BYTES) {
      setError('La photo fait au plus 5 Mo.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      onAdded(await addPlantImage(plant.code, file, fields));
      setFile(null);
      setRound((n) => n + 1);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ui-stack">
      {error && <Alert tone="error">{error}</Alert>}
      <ImageFieldsForm
        key={round}
        title="Ajouter une photo"
        initial={{
          alt: '',
          altEn: null,
          type: 'plante_entiere',
          principale: plant.images.length === 0,
        }}
        busy={busy}
        submitLabel="Ajouter la photo"
        onSubmit={(fields) => void onSubmit(fields)}
        file={
          <TextField
            label="Photo"
            hint="JPEG, PNG ou WebP, 5 Mo au plus."
            type="file"
            accept={ACCEPTED}
            required
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        }
      />
    </div>
  );
}
