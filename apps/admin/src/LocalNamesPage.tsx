import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  ListToolbar,
  PageHeader,
  SearchBox,
  SelectField,
  TextField,
  useDebounced,
} from '@sabou/ui';
import type { LocalNamesPlant, LocalNamesPlantSummary, RecordingLanguage } from '@sabou/types';
import { ApiError } from './accounts-api';
import {
  addLocalName,
  depositVoice,
  fetchLocalNames,
  listRecordingLanguages,
  makeLocalNamePrincipal,
  removeLocalName,
  searchLocalNamesPlants,
} from './local-names-api';
import { PAGE_HEADERS } from './page-headers';

// Noms locaux d'une plante (US-053, UC-12) : le référent d'une langue saisit, pour chaque
// plante, ses noms dans cette langue : une transcription en alphabet latin, qui ne sert qu'à la
// recherche (jamais affichée sur le site public, R-LNG-02, R-LNG-13), et la voix du nom.
// Plusieurs noms par langue, un seul principal ; la base vérifie le droit et trace chaque geste.

// Défini ici plutôt qu'importé de @sabou/types : l'application n'en importe que des types
export const LOCAL_NAME_MAX_LENGTH = 100;
const SEARCH_MAX_LENGTH = 100;
const VOICE_ACCEPT = 'audio/*';

const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : 'Une erreur est survenue.';

export function LocalNamesPage() {
  const [languages, setLanguages] = useState<RecordingLanguage[] | null>(null);
  const [plants, setPlants] = useState<LocalNamesPlantSummary[] | null>(null);
  const [plant, setPlant] = useState<LocalNamesPlant | null>(null);
  const [loadError, setLoadError] = useState<string>();
  const [query, setQuery] = useState('');
  // Gabarit de liste (05 §2.45) : la recherche part vers l'API une fois la frappe arrêtée
  const searched = useDebounced(query.trim());
  const plantTitle = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let active = true;
    listRecordingLanguages().then(
      (langs) => active && setLanguages(langs),
      (error: unknown) => active && setLoadError(errorMessage(error)),
    );
    return () => {
      active = false;
    };
  }, []);

  // Fiche choisie : le focus va à son titre (WCAG 2.4.3)
  const plantCode = plant?.code;
  useEffect(() => {
    if (plantCode) plantTitle.current?.focus();
  }, [plantCode]);

  useEffect(() => {
    let active = true;
    searchLocalNamesPlants(searched).then(
      (rows) => {
        if (!active) return;
        setPlants(rows);
        setLoadError(undefined);
      },
      (error: unknown) => active && setLoadError(errorMessage(error)),
    );
    return () => {
      active = false;
    };
  }, [searched]);

  async function choose(code: string) {
    try {
      setPlant(await fetchLocalNames(code));
      setLoadError(undefined);
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }

  return (
    <>
      <PageHeader {...PAGE_HEADERS['/noms-locaux']} />
      {loadError && <Alert tone="error">{loadError}</Alert>}
      {languages === null && !loadError && <p>Chargement…</p>}
      {languages && languages.length === 0 && (
        <Alert tone="info" title="Aucune langue">
          Vous n’êtes référent d’aucune langue : vous pouvez consulter les noms, pas en saisir. La
          Direction Générale donne le droit d’enregistrer dans une langue depuis la gestion des
          comptes.
        </Alert>
      )}
      {plants && (
        <section className="ui-section" aria-labelledby="plantes-titre">
          <h2 id="plantes-titre">Choisir une plante</h2>
          <ListToolbar>
            <SearchBox
              label="Rechercher une plante"
              placeholder="Nom français ou scientifique, ou code (PL-001)"
              value={query}
              maxLength={SEARCH_MAX_LENGTH}
              onChange={setQuery}
            />
          </ListToolbar>
          <DataTable
            caption={searched ? `Plantes trouvées pour « ${searched} »` : 'Plantes'}
            captionHidden
            rows={plants}
            paginate={{ key: 'noms-locaux', noun: ['plante', 'plantes'], resetOn: [searched] }}
            rowKey={(row) => row.code}
            empty={
              searched ? 'Aucune plante ne correspond.' : 'Aucune fiche plante pour l’instant.'
            }
            columns={[
              { key: 'nom', header: 'Plante', render: (row) => row.nomFr },
              {
                key: 'scientifique',
                header: 'Nom scientifique',
                render: (row) => <i>{row.nomScientifique}</i>,
              },
              { key: 'noms', header: 'Noms locaux', render: (row) => row.noms },
              {
                key: 'action',
                header: 'Action',
                actions: true,
                render: (row) => (
                  <Button variant="secondary" onClick={() => choose(row.code)}>
                    Noms locaux <span className="ui-visually-hidden">de {row.nomFr}</span>
                  </Button>
                ),
              },
            ]}
          />
        </section>
      )}
      {plant && (
        <section className="ui-section" aria-labelledby="noms-titre">
          <h2 id="noms-titre" ref={plantTitle} tabIndex={-1}>
            {plant.nomFr} <i>({plant.nomScientifique})</i>
          </h2>
          <NamesTable plant={plant} onChange={setPlant} />
          {languages && languages.length > 0 && (
            <NewNameForm plant={plant} languages={languages} onAdded={setPlant} />
          )}
        </section>
      )}
    </>
  );
}

function NamesTable({
  plant,
  onChange,
}: {
  plant: LocalNamesPlant;
  onChange: (plant: LocalNamesPlant) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  async function act(run: () => Promise<LocalNamesPlant>, done: string) {
    setBusy(true);
    setError(undefined);
    try {
      onChange(await run());
      setNotice(done);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      <DataTable
        caption="Noms locaux, par langue"
        rows={plant.noms}
        rowKey={(name) => String(name.id)}
        empty="Aucun nom local pour l’instant."
        columns={[
          { key: 'langue', header: 'Langue', render: (name) => name.langueNom },
          {
            key: 'transcription',
            header: 'Transcription de recherche',
            render: (name) => name.transcription,
          },
          {
            key: 'principal',
            header: 'Principal',
            render: (name) => (name.principal ? <Badge tone="success">Principal</Badge> : 'Non'),
          },
          { key: 'voix', header: 'Voix', render: (name) => (name.voix ? 'Oui' : 'À enregistrer') },
          {
            key: 'actions',
            header: 'Actions',
            render: (name) =>
              name.modifiable ? (
                <div className="ui-actions">
                  {!name.principal && (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        act(
                          () => makeLocalNamePrincipal(name.id),
                          `« ${name.transcription} » est le nom principal en ${name.langueNom}.`,
                        )
                      }
                    >
                      Rendre principal{' '}
                      <span className="ui-visually-hidden">: {name.transcription}</span>
                    </Button>
                  )}
                  <Button
                    variant="tertiary"
                    disabled={busy}
                    onClick={() =>
                      act(() => removeLocalName(name.id), `« ${name.transcription} » est retiré.`)
                    }
                  >
                    Retirer <span className="ui-visually-hidden">: {name.transcription}</span>
                  </Button>
                </div>
              ) : (
                '—'
              ),
          },
        ]}
      />
    </>
  );
}

interface NameErrors {
  transcription?: string;
  consent?: string;
}

function NewNameForm({
  plant,
  languages,
  onAdded,
}: {
  plant: LocalNamesPlant;
  languages: RecordingLanguage[];
  onAdded: (plant: LocalNamesPlant) => void;
}) {
  const [language, setLanguage] = useState(languages[0]!.code);
  const [transcription, setTranscription] = useState('');
  const [principal, setPrincipal] = useState(false);
  const [voice, setVoice] = useState<File | null>(null);
  const [consent, setConsent] = useState<'' | 'oui' | 'non'>('');
  const [errors, setErrors] = useState<NameErrors>({});
  const [busy, setBusy] = useState<string>();
  const [failure, setFailure] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const transcriptionField = useRef<HTMLInputElement>(null);
  const consentField = useRef<HTMLSelectElement>(null);
  const voiceField = useRef<HTMLInputElement>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = transcription.trim();
    const found: NameErrors = {};
    if (!text) found.transcription = 'Saisissez la transcription du nom.';
    if (voice && !consent) {
      found.consent = 'Indiquez si la personne qui parle consent à la publication de sa voix.';
    }
    setErrors(found);
    setNotice(undefined);
    if (found.transcription) return transcriptionField.current?.focus();
    if (found.consent) return consentField.current?.focus();
    setFailure(undefined);
    try {
      let depot: number | null = null;
      if (voice) {
        setBusy('Traitement de la voix…');
        depot = await depositVoice(voice, consent === 'oui');
      }
      setBusy('Enregistrement…');
      const updated = await addLocalName({
        plante: plant.code,
        langue: language,
        transcription: text,
        principal,
        depot,
      });
      onAdded(updated);
      setNotice(`« ${text} » est ajouté.`);
      setTranscription('');
      setPrincipal(false);
      setVoice(null);
      setConsent('');
      if (voiceField.current) voiceField.current.value = '';
    } catch (error) {
      setFailure(errorMessage(error));
    } finally {
      setBusy(undefined);
    }
  }

  return (
    <form className="ui-form" noValidate onSubmit={onSubmit} aria-labelledby="ajout-titre">
      <h3 id="ajout-titre">Ajouter un nom</h3>
      {failure && <Alert tone="error">{failure}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      <SelectField
        label="Langue"
        value={language}
        onChange={(event) => setLanguage(event.target.value)}
      >
        {languages.map((lang) => (
          <option key={lang.code} value={lang.code}>
            {lang.nom}
          </option>
        ))}
      </SelectField>
      <TextField
        ref={transcriptionField}
        label="Transcription de recherche"
        hint="En alphabet latin, telle qu’on la tape sur un téléphone. Elle sert seulement à retrouver la plante : elle n’est jamais affichée sur le site public."
        value={transcription}
        maxLength={LOCAL_NAME_MAX_LENGTH}
        error={errors.transcription}
        aria-required="true"
        onChange={(event) => setTranscription(event.target.value)}
      />
      <label className="ui-choice">
        <input
          type="checkbox"
          checked={principal}
          onChange={(event) => setPrincipal(event.target.checked)}
        />
        Nom principal dans cette langue (le premier nom d’une langue l’est d’office)
      </label>
      <TextField
        ref={voiceField}
        label="Voix du nom (facultatif)"
        hint="Enregistrement du nom prononcé, 3 Mo au plus. Il peut être ajouté plus tard."
        type="file"
        accept={VOICE_ACCEPT}
        onChange={(event) => setVoice(event.target.files?.[0] ?? null)}
      />
      {voice && (
        <SelectField
          ref={consentField}
          label="Consentement de la personne qui parle"
          value={consent}
          error={errors.consent}
          aria-required="true"
          onChange={(event) => setConsent(event.target.value as '' | 'oui' | 'non')}
        >
          <option value="">Choisir…</option>
          <option value="oui">Elle consent à la publication de sa voix</option>
          <option value="non">Elle ne consent pas (la voix ne sera pas publiée)</option>
        </SelectField>
      )}
      <div className="ui-form__actions">
        <Button type="submit" variant="primary" disabled={busy !== undefined}>
          {busy ?? 'Ajouter le nom'}
        </Button>
      </div>
    </form>
  );
}
