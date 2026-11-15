import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  ListToolbar,
  PageHeader,
  SearchBox,
  SegmentedFilter,
  SelectField,
  TextAreaField,
  TextField,
  foldText,
} from '@sabou/ui';
import type {
  NameVoiceObject,
  NameVoices,
  NameVoicesEntry,
  NameVoiceStatus,
  NameVoiceTarget,
} from '@sabou/types';
import { ApiError } from './accounts-api';
import { depositVoice } from './local-names-api';
import {
  fetchNameVoices,
  listNameVoiceTargets,
  moveNameVoice,
  nameVoiceAudioUrl,
  recordNameVoice,
} from './name-voices-api';

// Voix du nom des plantes et des maladies (US-071, UC-33, UC-41) : par langue, la voix suit
// Brouillon → Traduit → Validé → Publié (R-LNG-10). Le référent enregistre et présente la voix ;
// un valideur de la langue, qui ne l'a pas enregistrée, l'écoute puis la valide ou la renvoie ;
// la DG publie, si la personne qui parle a consenti (R-LNG-11). La base contrôle chaque geste.

// Défini ici plutôt qu'importé de @sabou/types : l'application n'en importe que des types
const MOTIF_MAX_LENGTH = 500;

export const STATUS: Record<
  NameVoiceStatus,
  [label: string, tone: 'neutral' | 'warning' | 'success']
> = {
  brouillon: ['Brouillon', 'neutral'],
  traduit: ['Traduit', 'neutral'],
  valide: ['Validé', 'warning'],
  publie: ['Publié', 'success'],
};
const OBJECT_LABEL: Record<NameVoiceObject, string> = { plante: 'Plante', maladie: 'Maladie' };

const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : 'Une erreur est survenue.';

type KindFilter = 'toutes' | NameVoiceObject;

export function NameVoicesPage() {
  const [targets, setTargets] = useState<NameVoiceTarget[] | null>(null);
  const [current, setCurrent] = useState<NameVoices | null>(null);
  const [loadError, setLoadError] = useState<string>();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('toutes');
  const title = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let active = true;
    listNameVoiceTargets().then(
      (rows) => active && setTargets(rows),
      (error: unknown) => active && setLoadError(errorMessage(error)),
    );
    return () => {
      active = false;
    };
  }, []);

  const currentKey = current ? `${current.objet}/${current.code}` : null;
  useEffect(() => {
    if (currentKey) title.current?.focus();
  }, [currentKey]);

  async function open(target: NameVoiceTarget) {
    try {
      setCurrent(await fetchNameVoices(target.objet, target.code));
      setLoadError(undefined);
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }

  // Gabarit de liste (05 §2.45) : la liste entière est reçue en une fois ; la recherche et le
  // filtre s'appliquent ici, sans nouvel appel
  const all = targets ?? [];
  const term = foldText(query.trim());
  const count = (wanted: KindFilter) =>
    all.filter((t) => wanted === 'toutes' || t.objet === wanted).length;
  const rows = all.filter(
    (t) =>
      (kind === 'toutes' || t.objet === kind) && (term === '' || foldText(t.nom).includes(term)),
  );

  return (
    <>
      <PageHeader
        title="Voix des noms"
        lead="La voix du nom de chaque plante et de chaque maladie, langue par langue : enregistrée par le référent, validée par un autre membre de l’atelier linguistique, publiée par la Direction Générale."
      />
      {loadError && <Alert tone="error">{loadError}</Alert>}
      {targets === null && !loadError && <p>Chargement…</p>}
      {targets && (
        <ListToolbar>
          <SearchBox
            label="Rechercher une fiche"
            placeholder="Nom de la plante ou de la maladie"
            value={query}
            onChange={setQuery}
          />
          <SegmentedFilter
            label="Filtrer par fiche"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'toutes', label: 'Toutes', count: count('toutes') },
              { value: 'plante', label: 'Plantes', count: count('plante') },
              { value: 'maladie', label: 'Maladies', count: count('maladie') },
            ]}
          />
        </ListToolbar>
      )}
      {targets && (
        <DataTable
          caption="Fiches du Dictionnaire"
          captionHidden
          rows={rows}
          rowKey={(t) => `${t.objet}/${t.code}`}
          empty={
            term || kind !== 'toutes'
              ? 'Aucune fiche ne correspond.'
              : 'Aucune fiche pour l’instant.'
          }
          paginate={{ key: 'voix-des-noms', noun: ['fiche', 'fiches'], resetOn: [term, kind] }}
          columns={[
            { key: 'nom', header: 'Nom', render: (t) => t.nom },
            { key: 'objet', header: 'Fiche', render: (t) => OBJECT_LABEL[t.objet] },
            { key: 'publiees', header: 'Langues publiées', render: (t) => t.publiees },
            { key: 'encours', header: 'À valider ou publier', render: (t) => t.enCours },
            {
              key: 'action',
              header: 'Action',
              actions: true,
              render: (t) => (
                <Button variant="secondary" onClick={() => open(t)}>
                  Voix <span className="ui-visually-hidden">du nom {t.nom}</span>
                </Button>
              ),
            },
          ]}
        />
      )}
      {current && (
        <section className="ui-section" aria-labelledby="voix-titre">
          <h2 id="voix-titre" ref={title} tabIndex={-1}>
            {OBJECT_LABEL[current.objet]} : {current.nom}
          </h2>
          <VoicesTable voices={current} onChange={setCurrent} />
        </section>
      )}
    </>
  );
}

// Gestes possibles pour le compte connecté ; la base les contrôle aussi
function actionsFor(entry: NameVoicesEntry, dg: boolean) {
  return {
    record: entry.peutEnregistrer,
    submit: entry.statut === 'brouillon' && (entry.parMoi || entry.peutTraduire),
    validate: entry.statut === 'traduit' && entry.peutValider && !entry.parMoi,
    sendBack: (entry.statut === 'traduit' || entry.statut === 'valide') && entry.peutValider,
    publish: entry.statut === 'valide' && dg,
  };
}

function VoicesTable({
  voices,
  onChange,
}: {
  voices: NameVoices;
  onChange: (v: NameVoices) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [form, setForm] = useState<{ langue: string; kind: 'record' | 'sendBack' } | null>(null);

  async function act(run: () => Promise<NameVoices>, done: string) {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      onChange(await run());
      setNotice(done);
      setForm(null);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  const move = (
    entry: NameVoicesEntry,
    vers: NameVoiceStatus,
    done: string,
    motif: string | null = null,
  ) => act(() => moveNameVoice(voices.objet, voices.code, entry.langue, vers, motif), done);

  return (
    <>
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      <DataTable
        caption="Voix du nom, par langue"
        rows={voices.voix}
        rowKey={(entry) => entry.langue}
        empty="Aucune langue de voix active."
        columns={[
          { key: 'langue', header: 'Langue', render: (e) => e.langueNom },
          {
            key: 'statut',
            header: 'Statut',
            render: (e) =>
              e.statut ? (
                <Badge tone={STATUS[e.statut][1]}>{STATUS[e.statut][0]}</Badge>
              ) : (
                'Aucune voix'
              ),
          },
          {
            key: 'detail',
            header: 'Détail',
            render: (e) =>
              e.statut ? (
                <>
                  <span>Enregistrée par {e.enregistrePar}</span>
                  {!e.consentement && <span> · sans consentement de publication</span>}
                  {e.motif && <span> · renvoyée : {e.motif}</span>}
                </>
              ) : (
                '—'
              ),
          },
          {
            key: 'ecoute',
            header: 'Écoute',
            render: (e) =>
              e.statut ? (
                <audio controls preload="none" aria-label={`Voix du nom en ${e.langueNom}`}>
                  <source
                    src={nameVoiceAudioUrl(voices.objet, voices.code, e.langue)}
                    type="audio/webm"
                  />
                  {e.secours && (
                    <source
                      src={nameVoiceAudioUrl(voices.objet, voices.code, e.langue, true)}
                      type="audio/mp4"
                    />
                  )}
                </audio>
              ) : (
                '—'
              ),
          },
          {
            key: 'actions',
            header: 'Actions',
            render: (e) => {
              const can = actionsFor(e, voices.dg);
              const hidden = (
                <>
                  {' '}
                  <span className="ui-visually-hidden">en {e.langueNom}</span>
                </>
              );
              return (
                <div className="ui-actions">
                  {can.record && (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => setForm({ langue: e.langue, kind: 'record' })}
                    >
                      {e.statut ? 'Réenregistrer' : 'Enregistrer'}
                      {hidden}
                    </Button>
                  )}
                  {can.submit && (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        move(e, 'traduit', `Voix en ${e.langueNom} présentée à la validation.`)
                      }
                    >
                      Présenter à la validation{hidden}
                    </Button>
                  )}
                  {can.validate && (
                    <Button
                      variant="primary"
                      disabled={busy}
                      onClick={() => move(e, 'valide', `Voix en ${e.langueNom} validée.`)}
                    >
                      Valider{hidden}
                    </Button>
                  )}
                  {can.sendBack && (
                    <Button
                      variant="tertiary"
                      disabled={busy}
                      onClick={() => setForm({ langue: e.langue, kind: 'sendBack' })}
                    >
                      Renvoyer{hidden}
                    </Button>
                  )}
                  {can.publish && (
                    <Button
                      variant="primary"
                      disabled={busy}
                      onClick={() => move(e, 'publie', `Voix en ${e.langueNom} publiée.`)}
                    >
                      Publier{hidden}
                    </Button>
                  )}
                </div>
              );
            },
          },
        ]}
      />
      {form?.kind === 'record' && (
        <RecordForm
          langue={voices.voix.find((e) => e.langue === form.langue)!}
          busy={busy}
          onCancel={() => setForm(null)}
          onSubmit={(file, consent) =>
            act(async () => {
              const depot = await depositVoice(file, consent);
              return recordNameVoice(voices.objet, voices.code, form.langue, depot);
            }, 'Voix enregistrée : elle est en brouillon.')
          }
        />
      )}
      {form?.kind === 'sendBack' && (
        <SendBackForm
          langue={voices.voix.find((e) => e.langue === form.langue)!}
          busy={busy}
          onCancel={() => setForm(null)}
          onSubmit={(motif) =>
            move(
              voices.voix.find((e) => e.langue === form.langue)!,
              'brouillon',
              'Voix renvoyée en brouillon avec le motif.',
              motif,
            )
          }
        />
      )}
    </>
  );
}

function RecordForm({
  langue,
  busy,
  onCancel,
  onSubmit,
}: {
  langue: NameVoicesEntry;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (file: File, consent: boolean) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState<'' | 'oui' | 'non'>('');
  const [errors, setErrors] = useState<{ file?: string; consent?: string }>({});
  const fileField = useRef<HTMLInputElement>(null);
  const consentField = useRef<HTMLSelectElement>(null);

  useEffect(() => fileField.current?.focus(), []);

  function submit(event: FormEvent) {
    event.preventDefault();
    const found = {
      file: file ? undefined : 'Choisissez l’enregistrement du nom.',
      consent: consent ? undefined : 'Indiquez si la personne qui parle consent à la publication.',
    };
    setErrors(found);
    if (found.file) return fileField.current?.focus();
    if (found.consent) return consentField.current?.focus();
    onSubmit(file!, consent === 'oui');
  }

  return (
    <form className="ui-form" noValidate onSubmit={submit} aria-labelledby="enregistrer-titre">
      <h3 id="enregistrer-titre">Voix du nom en {langue.langueNom}</h3>
      <TextField
        ref={fileField}
        label="Enregistrement"
        hint="Le nom prononcé, 3 Mo au plus. Un nouvel enregistrement remplace la voix et la remet en brouillon."
        type="file"
        accept="audio/*"
        error={errors.file}
        aria-required="true"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
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
        <option value="non">Elle ne consent pas (la voix ne pourra pas être publiée)</option>
      </SelectField>
      <div className="ui-form__actions">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Traitement de la voix…' : 'Enregistrer la voix'}
        </Button>
        <Button variant="tertiary" disabled={busy} onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

function SendBackForm({
  langue,
  busy,
  onCancel,
  onSubmit,
}: {
  langue: NameVoicesEntry;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (motif: string) => void;
}) {
  const [motif, setMotif] = useState('');
  const [error, setError] = useState<string>();
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => field.current?.focus(), []);

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = motif.trim();
    if (!text) {
      setError('Saisissez le motif du renvoi.');
      return field.current?.focus();
    }
    onSubmit(text);
  }

  return (
    <form className="ui-form" noValidate onSubmit={submit} aria-labelledby="renvoi-titre">
      <h3 id="renvoi-titre">Renvoyer la voix en {langue.langueNom}</h3>
      <TextAreaField
        ref={field}
        label="Motif du renvoi"
        hint="Il est montré à la personne qui a enregistré la voix."
        value={motif}
        maxLength={MOTIF_MAX_LENGTH}
        error={error}
        aria-required="true"
        onChange={(event) => setMotif(event.target.value)}
      />
      <div className="ui-form__actions">
        <Button type="submit" variant="danger" disabled={busy}>
          Confirmer le renvoi
        </Button>
        <Button variant="tertiary" disabled={busy} onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  );
}
