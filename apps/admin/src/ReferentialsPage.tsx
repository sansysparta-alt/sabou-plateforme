import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Alert, Badge, PageHeader } from '@sabou/ui';
import type { Language, LanguageType, Referentials, Specialty, TerritoryLevel } from '@sabou/types';
import { ApiError } from './accounts-api';
import { BADGE_TONES } from './roles';
import {
  createLanguage,
  createSpecialty,
  createTerritory,
  fetchReferentials,
  renameTerritory,
  updateLanguage,
  updateSpecialty,
} from './referentials-api';

const message = (error: unknown) =>
  error instanceof ApiError ? error.message : 'Une erreur est survenue.';

// Libellés locaux : importer des valeurs de @sabou/types chargerait zod dans la page (3G)
const LANGUAGE_TYPE_LABELS: Record<LanguageType, string> = {
  nationale: 'Nationale',
  officielle: 'Officielle',
  internationale: 'Internationale',
};
const LANGUAGE_TYPES = Object.keys(LANGUAGE_TYPE_LABELS) as LanguageType[];

const LEVEL_LABELS: Record<TerritoryLevel, { one: string; parent: string }> = {
  regions: { one: 'Région', parent: 'Région naturelle' },
  prefectures: { one: 'Préfecture', parent: 'Région' },
  'sous-prefectures': { one: 'Sous-préfecture', parent: 'Préfecture' },
};

const usage = (language: Language) =>
  [language.text && 'texte', language.voice && 'voix'].filter(Boolean).join(' et ');

// Paramétrage des référentiels par la DG, sans modifier le code (lot C : US-020, US-021)
export function ReferentialsPage() {
  const [data, setData] = useState<Referentials | null>(null);
  const [loadError, setLoadError] = useState<string>();
  const [notice, setNotice] = useState<string>();

  const reload = useCallback(async () => {
    try {
      setData(await fetchReferentials());
      setLoadError(undefined);
    } catch (error) {
      setLoadError(message(error));
    }
  }, []);

  useEffect(() => {
    fetchReferentials().then(setData, (error: unknown) => setLoadError(message(error)));
  }, []);

  // Après chaque décision : message pour les lecteurs d'écran et listes rechargées
  const done = (text: string) => {
    setNotice(text);
    void reload();
  };

  return (
    <>
      <PageHeader title="Référentiels" />
      <p>
        Langues, territoires et spécialités de la plateforme. Chaque modification est journalisée.
      </p>
      {loadError && <Alert tone="error">{loadError}</Alert>}
      <p role="status" className="ui-live-status">
        {notice}
      </p>
      {data === null && !loadError && <p>Chargement…</p>}
      {data && (
        <>
          <LanguagesSection languages={data.languages} onDone={done} />
          <TerritoriesSection data={data} onDone={done} />
          <SpecialtiesSection specialties={data.specialties} onDone={done} />
        </>
      )}
    </>
  );
}

type OnDone = (notice: string) => void;

// Bouton d'une décision, avec son erreur affichée à côté
function useAction(onDone: OnDone) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  async function run(work: () => Promise<void>, notice: string): Promise<boolean> {
    setBusy(true);
    setError(undefined);
    try {
      await work();
      onDone(notice);
      return true;
    } catch (failure) {
      setError(message(failure));
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

function ErrorText({ error }: { error?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) ref.current?.focus();
  }, [error]);
  return error ? (
    <Alert tone="error" ref={ref}>
      {error}
    </Alert>
  ) : null;
}

// ---------- Langues (US-020) ----------

function LanguagesSection({ languages, onDone }: { languages: Language[]; onDone: OnDone }) {
  return (
    <section aria-labelledby="languages-title">
      <h2 id="languages-title">Langues</h2>
      <p className="ui-field__hint">
        Les langues nationales existent uniquement en voix. Une langue ajoutée reste inactive
        jusqu’à son activation.
      </p>
      <ul className="ui-stack">
        {languages.map((language) => (
          <LanguageItem key={language.code} language={language} onDone={onDone} />
        ))}
      </ul>
      <LanguageForm onDone={onDone} />
    </section>
  );
}

function LanguageItem({ language, onDone }: { language: Language; onDone: OnDone }) {
  const { busy, error, run } = useAction(onDone);
  const next = !language.active;
  return (
    <li className="ui-card ui-card--plain">
      <h3>
        {language.name} <span className="ui-field__hint">({language.code})</span>
      </h3>
      <dl className="ui-facts">
        <dt>Type</dt>
        <dd>{LANGUAGE_TYPE_LABELS[language.type]}</dd>
        <dt>Usage</dt>
        <dd>{usage(language)}</dd>
        <dt>Statut</dt>
        <dd>
          <Badge tone={BADGE_TONES[language.active ? 'actif' : 'suspendu']}>
            {language.active ? 'Active' : 'Inactive'}
          </Badge>
        </dd>
      </dl>
      <ErrorText error={error} />
      {language.code !== 'fr' && (
        <button
          type="button"
          className={`ui-button ${next ? 'ui-button--secondary' : 'ui-button--danger'}`}
          disabled={busy}
          onClick={() =>
            run(
              () => updateLanguage(language.code, { active: next }),
              `${language.name} ${next ? 'activée' : 'désactivée'}.`,
            )
          }
        >
          {next ? 'Activer' : 'Désactiver'}
          <span className="ui-visually-hidden"> la langue {language.name}</span>
        </button>
      )}
    </li>
  );
}

function LanguageForm({ onDone }: { onDone: OnDone }) {
  const id = useId();
  const [form, setForm] = useState({
    code: '',
    iso: '',
    name: '',
    type: 'nationale' as LanguageType,
    text: false,
    voice: true,
  });
  const { busy, error, run } = useAction(onDone);
  const national = form.type === 'nationale';

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const ok = await run(
      () =>
        createLanguage({
          code: form.code,
          iso6393: form.iso.trim() || null,
          name: form.name,
          type: form.type,
          text: national ? false : form.text,
          voice: form.voice,
        }),
      `Langue ${form.name} ajoutée, inactive.`,
    );
    if (ok) setForm({ ...form, code: '', iso: '', name: '' });
  }

  return (
    <form
      className="ui-form ui-card ui-card--plain"
      onSubmit={onSubmit}
      aria-labelledby={`${id}-t`}
      noValidate
    >
      <h3 id={`${id}-t`}>Ajouter une langue</h3>
      <ErrorText error={error} />
      <div className="ui-field">
        <label className="ui-field__label" htmlFor={`${id}-name`}>
          Nom en français
        </label>
        <input
          className="ui-input"
          id={`${id}-name`}
          required
          maxLength={80}
          value={form.name}
          onChange={(e) => setForm({ ...form, name: e.target.value })}
        />
      </div>
      <div className="ui-field">
        <label className="ui-field__label" htmlFor={`${id}-code`}>
          Code
        </label>
        <span className="ui-field__hint" id={`${id}-code-hint`}>
          2 ou 3 lettres, sans accent (ex. kis).
        </span>
        <input
          className="ui-input"
          id={`${id}-code`}
          required
          maxLength={3}
          aria-describedby={`${id}-code-hint`}
          value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value })}
        />
      </div>
      <div className="ui-field">
        <label className="ui-field__label" htmlFor={`${id}-iso`}>
          Code ISO 639-3 (facultatif)
        </label>
        <input
          className="ui-input"
          id={`${id}-iso`}
          maxLength={3}
          value={form.iso}
          onChange={(e) => setForm({ ...form, iso: e.target.value })}
        />
      </div>
      <div className="ui-field">
        <label className="ui-field__label" htmlFor={`${id}-type`}>
          Type
        </label>
        <select
          className="ui-select"
          id={`${id}-type`}
          value={form.type}
          onChange={(e) => setForm({ ...form, type: e.target.value as LanguageType })}
        >
          {LANGUAGE_TYPES.map((type) => (
            <option key={type} value={type}>
              {LANGUAGE_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      </div>
      <fieldset className="ui-fieldset">
        <legend className="ui-fieldset__legend">Usage</legend>
        <label className="ui-choice">
          <input
            type="checkbox"
            checked={!national && form.text}
            disabled={national}
            aria-describedby={national ? `${id}-text-hint` : undefined}
            onChange={(e) => setForm({ ...form, text: e.target.checked })}
          />
          Texte
        </label>
        {national && (
          <span className="ui-field__hint" id={`${id}-text-hint`}>
            Aucun texte écrit en langue nationale.
          </span>
        )}
        <label className="ui-choice">
          <input
            type="checkbox"
            checked={form.voice}
            onChange={(e) => setForm({ ...form, voice: e.target.checked })}
          />
          Voix
        </label>
      </fieldset>
      <button type="submit" className="ui-button ui-button--primary" disabled={busy}>
        Ajouter la langue
      </button>
    </form>
  );
}

// ---------- Territoires (US-020) ----------

function TerritoriesSection({ data, onDone }: { data: Referentials; onDone: OnDone }) {
  const languageName = (code: string) =>
    data.languages.find((language) => language.code === code)?.name ?? code;
  return (
    <section aria-labelledby="territories-title">
      <h2 id="territories-title">Territoires</h2>
      <p className="ui-field__hint">
        La région naturelle fixe la langue vocale proposée par défaut. La fusion de territoires fera
        l’objet d’une évolution à part.
      </p>
      <ul className="ui-stack">
        {data.regions.map((region) => {
          const natural = data.naturalRegions.find((n) => n.id === region.parentId);
          const prefectures = data.prefectures.filter((p) => p.parentId === region.id);
          return (
            <li key={region.id} className="ui-card ui-card--plain">
              <h3>{region.name}</h3>
              <dl className="ui-facts">
                <dt>Région naturelle</dt>
                <dd>{natural?.name}</dd>
                <dt>Langue par défaut</dt>
                <dd>{natural && languageName(natural.defaultLanguage)}</dd>
                <dt>Préfectures</dt>
                <dd>
                  {prefectures
                    .map((p) => {
                      const subs = data.subPrefectures.filter((s) => s.parentId === p.id);
                      return subs.length
                        ? `${p.name} (${subs.map((s) => s.name).join(', ')})`
                        : p.name;
                    })
                    .join(' ; ') || 'Aucune'}
                </dd>
              </dl>
            </li>
          );
        })}
      </ul>
      <TerritoryForm data={data} onDone={onDone} />
      <RenameForm data={data} onDone={onDone} />
    </section>
  );
}

function options(data: Referentials, level: TerritoryLevel) {
  switch (level) {
    case 'regions':
      return data.regions;
    case 'prefectures':
      return data.prefectures;
    default:
      return data.subPrefectures;
  }
}

function parents(data: Referentials, level: TerritoryLevel) {
  switch (level) {
    case 'regions':
      return data.naturalRegions;
    case 'prefectures':
      return data.regions;
    default:
      return data.prefectures;
  }
}

function LevelSelect({
  id,
  value,
  onChange,
}: {
  id: string;
  value: TerritoryLevel;
  onChange: (level: TerritoryLevel) => void;
}) {
  return (
    <div className="ui-field">
      <label className="ui-field__label" htmlFor={id}>
        Niveau
      </label>
      <select
        className="ui-select"
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value as TerritoryLevel)}
      >
        {(Object.keys(LEVEL_LABELS) as TerritoryLevel[]).map((level) => (
          <option key={level} value={level}>
            {LEVEL_LABELS[level].one}
          </option>
        ))}
      </select>
    </div>
  );
}

function TerritoryForm({ data, onDone }: { data: Referentials; onDone: OnDone }) {
  const id = useId();
  const [level, setLevel] = useState<TerritoryLevel>('sous-prefectures');
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const { busy, error, run } = useAction(onDone);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const ok = await run(
      () => createTerritory(level, { name, parentId: Number(parentId) }),
      `${LEVEL_LABELS[level].one} ${name} ajoutée.`,
    );
    if (ok) setName('');
  }

  return (
    <form
      className="ui-form ui-card ui-card--plain"
      onSubmit={onSubmit}
      aria-labelledby={`${id}-t`}
      noValidate
    >
      <h3 id={`${id}-t`}>Ajouter un territoire</h3>
      <ErrorText error={error} />
      <LevelSelect
        id={`${id}-level`}
        value={level}
        onChange={(next) => {
          setLevel(next);
          setParentId('');
        }}
      />
      <div className="ui-field">
        <label className="ui-field__label" htmlFor={`${id}-parent`}>
          {LEVEL_LABELS[level].parent}
        </label>
        <select
          className="ui-select"
          id={`${id}-parent`}
          required
          value={parentId}
          onChange={(e) => setParentId(e.target.value)}
        >
          <option value="">Choisir…</option>
          {parents(data, level).map((parent) => (
            <option key={parent.id} value={parent.id}>
              {parent.name}
            </option>
          ))}
        </select>
      </div>
      <div className="ui-field">
        <label className="ui-field__label" htmlFor={`${id}-name`}>
          Nom
        </label>
        <input
          className="ui-input"
          id={`${id}-name`}
          required
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <button type="submit" className="ui-button ui-button--primary" disabled={busy}>
        Ajouter le territoire
      </button>
    </form>
  );
}

function RenameForm({ data, onDone }: { data: Referentials; onDone: OnDone }) {
  const id = useId();
  const [level, setLevel] = useState<TerritoryLevel>('prefectures');
  const [targetId, setTargetId] = useState('');
  const [name, setName] = useState('');
  const { busy, error, run } = useAction(onDone);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const ok = await run(
      () => renameTerritory(level, Number(targetId), name),
      `Territoire renommé en ${name}.`,
    );
    if (ok) {
      setName('');
      setTargetId('');
    }
  }

  return (
    <form
      className="ui-form ui-card ui-card--plain"
      onSubmit={onSubmit}
      aria-labelledby={`${id}-t`}
      noValidate
    >
      <h3 id={`${id}-t`}>Renommer un territoire</h3>
      <ErrorText error={error} />
      <LevelSelect
        id={`${id}-level`}
        value={level}
        onChange={(next) => {
          setLevel(next);
          setTargetId('');
        }}
      />
      <div className="ui-field">
        <label className="ui-field__label" htmlFor={`${id}-target`}>
          {LEVEL_LABELS[level].one} à renommer
        </label>
        <select
          className="ui-select"
          id={`${id}-target`}
          required
          value={targetId}
          onChange={(e) => setTargetId(e.target.value)}
        >
          <option value="">Choisir…</option>
          {options(data, level).map((territory) => (
            <option key={territory.id} value={territory.id}>
              {territory.name}
            </option>
          ))}
        </select>
      </div>
      <div className="ui-field">
        <label className="ui-field__label" htmlFor={`${id}-name`}>
          Nouveau nom
        </label>
        <input
          className="ui-input"
          id={`${id}-name`}
          required
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <button type="submit" className="ui-button ui-button--primary" disabled={busy}>
        Renommer
      </button>
    </form>
  );
}

// ---------- Spécialités (US-021) ----------

function SpecialtiesSection({ specialties, onDone }: { specialties: Specialty[]; onDone: OnDone }) {
  return (
    <section aria-labelledby="specialties-title">
      <h2 id="specialties-title">Spécialités</h2>
      <p className="ui-field__hint">
        Une spécialité désactivée n’est plus proposée ; les praticiens qui l’ont la gardent.
      </p>
      <ul className="ui-stack">
        {specialties.map((specialty) => (
          <SpecialtyItem key={specialty.id} specialty={specialty} onDone={onDone} />
        ))}
      </ul>
      <SpecialtyForm onDone={onDone} />
    </section>
  );
}

function SpecialtyItem({ specialty, onDone }: { specialty: Specialty; onDone: OnDone }) {
  const id = useId();
  const { busy, error, run } = useAction(onDone);
  const [editing, setEditing] = useState(false);
  const [labelFr, setLabelFr] = useState(specialty.labelFr);
  const [labelEn, setLabelEn] = useState(specialty.labelEn ?? '');
  const next = !specialty.active;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const ok = await run(
      () => updateSpecialty(specialty.id, { labelFr, labelEn: labelEn.trim() || null }),
      `Spécialité ${labelFr} modifiée.`,
    );
    if (ok) setEditing(false);
  }

  return (
    <li className="ui-card ui-card--plain">
      <h3>{specialty.labelFr}</h3>
      <dl className="ui-facts">
        <dt>En anglais</dt>
        <dd lang="en">{specialty.labelEn ?? '—'}</dd>
        <dt>Statut</dt>
        <dd>
          <Badge tone={BADGE_TONES[specialty.active ? 'actif' : 'suspendu']}>
            {specialty.active ? 'Active' : 'Inactive'}
          </Badge>
        </dd>
      </dl>
      <ErrorText error={error} />
      {editing ? (
        <form className="ui-form" onSubmit={onSubmit} noValidate>
          <div className="ui-field">
            <label className="ui-field__label" htmlFor={`${id}-fr`}>
              Libellé en français
            </label>
            <input
              className="ui-input"
              id={`${id}-fr`}
              required
              maxLength={80}
              value={labelFr}
              onChange={(e) => setLabelFr(e.target.value)}
            />
          </div>
          <div className="ui-field">
            <label className="ui-field__label" htmlFor={`${id}-en`}>
              Libellé en anglais (facultatif)
            </label>
            <input
              className="ui-input"
              id={`${id}-en`}
              lang="en"
              maxLength={80}
              value={labelEn}
              onChange={(e) => setLabelEn(e.target.value)}
            />
          </div>
          <button type="submit" className="ui-button ui-button--primary" disabled={busy}>
            Enregistrer
          </button>
        </form>
      ) : (
        <button
          type="button"
          className="ui-button ui-button--secondary"
          onClick={() => setEditing(true)}
        >
          Modifier<span className="ui-visually-hidden"> la spécialité {specialty.labelFr}</span>
        </button>
      )}
      <button
        type="button"
        className={`ui-button ${next ? 'ui-button--secondary' : 'ui-button--danger'}`}
        disabled={busy}
        onClick={() =>
          run(
            () => updateSpecialty(specialty.id, { active: next }),
            `${specialty.labelFr} ${next ? 'activée' : 'désactivée'}.`,
          )
        }
      >
        {next ? 'Activer' : 'Désactiver'}
        <span className="ui-visually-hidden"> la spécialité {specialty.labelFr}</span>
      </button>
    </li>
  );
}

function SpecialtyForm({ onDone }: { onDone: OnDone }) {
  const id = useId();
  const [form, setForm] = useState({ code: '', labelFr: '', labelEn: '' });
  const { busy, error, run } = useAction(onDone);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const ok = await run(
      () =>
        createSpecialty({
          code: form.code,
          labelFr: form.labelFr,
          labelEn: form.labelEn.trim() || null,
        }),
      `Spécialité ${form.labelFr} ajoutée.`,
    );
    if (ok) setForm({ code: '', labelFr: '', labelEn: '' });
  }

  return (
    <form
      className="ui-form ui-card ui-card--plain"
      onSubmit={onSubmit}
      aria-labelledby={`${id}-t`}
      noValidate
    >
      <h3 id={`${id}-t`}>Ajouter une spécialité</h3>
      <ErrorText error={error} />
      <div className="ui-field">
        <label className="ui-field__label" htmlFor={`${id}-fr`}>
          Libellé en français
        </label>
        <input
          className="ui-input"
          id={`${id}-fr`}
          required
          maxLength={80}
          value={form.labelFr}
          onChange={(e) => setForm({ ...form, labelFr: e.target.value })}
        />
      </div>
      <div className="ui-field">
        <label className="ui-field__label" htmlFor={`${id}-en`}>
          Libellé en anglais (facultatif)
        </label>
        <input
          className="ui-input"
          id={`${id}-en`}
          lang="en"
          maxLength={80}
          value={form.labelEn}
          onChange={(e) => setForm({ ...form, labelEn: e.target.value })}
        />
      </div>
      <div className="ui-field">
        <label className="ui-field__label" htmlFor={`${id}-code`}>
          Code
        </label>
        <span className="ui-field__hint" id={`${id}-code-hint`}>
          Minuscules, chiffres et _, sans accent (ex. ophtalmologie).
        </span>
        <input
          className="ui-input"
          id={`${id}-code`}
          required
          maxLength={40}
          aria-describedby={`${id}-code-hint`}
          value={form.code}
          onChange={(e) => setForm({ ...form, code: e.target.value })}
        />
      </div>
      <button type="submit" className="ui-button ui-button--primary" disabled={busy}>
        Ajouter la spécialité
      </button>
    </form>
  );
}
