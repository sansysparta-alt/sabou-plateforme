import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Alert, Badge, Button, PageHeader, Pagination, Tabs, usePagination } from '@sabou/ui';
import { REDISTRICTING_LABELS } from '@sabou/types';
import type {
  CreateSpecialty,
  Language,
  LanguageType,
  RedistrictingOperation,
  RedistrictingPreview,
  Referentials,
  Specialty,
  TerritoryLevel,
  UpdateSpecialty,
} from '@sabou/types';
import { ApiError } from './accounts-api';
import { BADGE_TONES } from './roles';
import {
  createContraindication,
  createLanguage,
  createSpecialty,
  createTerritory,
  fetchReferentials,
  previewRedistricting,
  redistrict,
  renameTerritory,
  updateContraindication,
  updateLanguage,
  updateSpecialty,
} from './referentials-api';
import { PAGE_HEADERS } from './page-headers';

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
// Référentiels de la DG (lot C : US-020, US-021). Organisation (US-019) : un onglet par
// référentiel, avec son explication, son action d'ajout (formulaire ouvert à la demande) et
// son tableau.
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
      <PageHeader {...PAGE_HEADERS['/referentiels']} />
      {loadError && <Alert tone="error">{loadError}</Alert>}
      <p role="status" className="ui-live-status">
        {notice}
      </p>
      {data === null && !loadError && <p>Chargement…</p>}
      {data && (
        <Tabs
          label="Référentiels"
          tabs={[
            {
              id: 'langues',
              label: 'Langues',
              count: data.languages.length,
              content: <LanguagesSection languages={data.languages} onDone={done} />,
            },
            {
              id: 'territoires',
              label: 'Territoires',
              count: data.regions.length,
              content: <TerritoriesSection data={data} onDone={done} />,
            },
            {
              id: 'specialites',
              label: 'Spécialités',
              count: data.specialties.length,
              content: (
                <CodedListSection kind={SPECIALTIES} items={data.specialties} onDone={done} />
              ),
            },
            {
              id: 'contre-indications',
              label: 'Contre-indications',
              count: data.contraindications.length,
              content: (
                <CodedListSection
                  kind={CONTRAINDICATIONS}
                  items={data.contraindications}
                  onDone={done}
                />
              ),
            },
          ]}
        />
      )}
    </>
  );
}

// Bouton qui ouvre un formulaire à la demande, et le formulaire dessous
function OnDemand({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant={open ? 'secondary' : 'primary'}
        icon={open ? 'close' : 'plus'}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? 'Fermer' : label}
        {open && <span className="ui-visually-hidden"> : {label}</span>}
      </Button>
      {open && <div className="ui-on-demand">{children}</div>}
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
  // Pagination commune au-delà de 10 lignes (gabarit de liste, 05 §2.45)
  const { pageItems, paginationProps } = usePagination(languages, 'langues');
  return (
    <section aria-labelledby="languages-title" className="ui-section">
      <h2 id="languages-title" className="ui-visually-hidden">
        Langues
      </h2>
      <div className="ui-panel-header">
        <p>
          Les langues nationales existent uniquement en voix. Une langue ajoutée reste inactive
          jusqu’à son activation.
        </p>
        <OnDemand label="Ajouter une langue">
          <LanguageForm onDone={onDone} />
        </OnDemand>
      </div>
      <div className="ui-table-block">
        <div className="ui-table-wrap">
          <table className="ui-table">
            <caption className="ui-visually-hidden">Langues</caption>
            <thead>
              <tr>
                <th scope="col">Langue</th>
                <th scope="col">Type</th>
                <th scope="col">Usage</th>
                <th scope="col">Statut</th>
                <th scope="col" className="ui-table__actions">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((language) => (
                <LanguageItem key={language.code} language={language} onDone={onDone} />
              ))}
            </tbody>
          </table>
        </div>
        <Pagination {...paginationProps} noun={['langue', 'langues']} label="Pages : Langues" />
      </div>
    </section>
  );
}

function LanguageItem({ language, onDone }: { language: Language; onDone: OnDone }) {
  const { busy, error, run } = useAction(onDone);
  const next = !language.active;
  return (
    <tr>
      <th scope="row">
        <span className="ui-person__name">{language.name}</span>{' '}
        <span className="ui-muted">({language.code})</span>
      </th>
      <td>{LANGUAGE_TYPE_LABELS[language.type]}</td>
      <td>{usage(language)}</td>
      <td>
        <Badge tone={BADGE_TONES[language.active ? 'actif' : 'suspendu']}>
          {language.active ? 'Active' : 'Inactive'}
        </Badge>
      </td>
      <td className="ui-table__actions">
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
      </td>
    </tr>
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
  // Un seul formulaire ouvert à la fois, sous l'en-tête du panneau
  const [open, setOpen] = useState<'ajouter' | 'renommer' | 'redecouper' | null>(null);
  const languageName = (code: string) =>
    data.languages.find((language) => language.code === code)?.name ?? code;
  return (
    <section aria-labelledby="territories-title" className="ui-section">
      <h2 id="territories-title" className="ui-visually-hidden">
        Territoires
      </h2>
      <div className="ui-panel-header">
        <p>
          La région naturelle fixe la langue vocale proposée par défaut. Un redécoupage
          (rattachement, découpage, fusion) se fait ici, sans modifier le code : un territoire
          remplacé reste en base, inactif.
        </p>
        <div className="ui-form__actions">
          {(
            [
              ['ajouter', 'Ajouter un territoire'],
              ['renommer', 'Renommer un territoire'],
              ['redecouper', 'Redécouper'],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              variant={open === value ? 'secondary' : 'primary'}
              icon={open === value ? 'close' : 'plus'}
              aria-expanded={open === value}
              onClick={() => setOpen(open === value ? null : value)}
            >
              {open === value ? 'Fermer' : label}
              {open === value && <span className="ui-visually-hidden"> : {label}</span>}
            </Button>
          ))}
        </div>
      </div>
      {open === 'ajouter' && <TerritoryForm data={data} onDone={onDone} />}
      {open === 'renommer' && <RenameForm data={data} onDone={onDone} />}
      {open === 'redecouper' && <RedistrictForm data={data} onDone={onDone} />}
      <div className="ui-table-wrap">
        <table className="ui-table">
          <caption className="ui-visually-hidden">Territoires</caption>
          <thead>
            <tr>
              <th scope="col">Région</th>
              <th scope="col">Région naturelle</th>
              <th scope="col">Langue par défaut</th>
              <th scope="col">Préfectures (sous-préfectures)</th>
            </tr>
          </thead>
          <tbody>
            {data.regions.map((region) => {
              const natural = data.naturalRegions.find((n) => n.id === region.parentId);
              const prefectures = data.prefectures.filter((p) => p.parentId === region.id);
              return (
                <tr key={region.id}>
                  <th scope="row">
                    <span className="ui-person__name">{region.name}</span>
                  </th>
                  <td>{natural?.name}</td>
                  <td>{natural && languageName(natural.defaultLanguage)}</td>
                  <td>
                    {prefectures
                      .map((p) => {
                        const subs = data.subPrefectures.filter((s) => s.parentId === p.id);
                        const name = p.active ? p.name : `${p.name} (remplacée)`;
                        return subs.length
                          ? `${name} (${subs.map((s) => s.name).join(', ')})`
                          : name;
                      })
                      .join(' ; ') || 'Aucune'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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

// Rattachements possibles : les territoires actifs seulement (un territoire remplacé ne
// reçoit plus rien, R-ACC-08)
function parents(data: Referentials, level: TerritoryLevel) {
  switch (level) {
    case 'regions':
      return data.naturalRegions;
    case 'prefectures':
      return data.regions.filter((r) => r.active);
    default:
      return data.prefectures.filter((p) => p.active);
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

// ---------- Redécoupage (US-022) ----------
// Trois opérations, chacune en deux temps : la DG voit d'abord ce qui bouge, puis confirme.
// Pas d'annulation : on corrige par l'opération inverse, journalisée elle aussi.

const REDISTRICTING_FIELDS: Record<
  RedistrictingOperation,
  { object: string; target: string; done: (p: RedistrictingPreview) => string }
> = {
  rattacher_prefecture: {
    object: 'Préfecture',
    target: 'Nouvelle région',
    done: (p) => `Préfecture ${p.object} rattachée à la région ${p.target}.`,
  },
  rattacher_sous_prefecture: {
    object: 'Sous-préfecture',
    target: 'Nouvelle préfecture',
    done: (p) => `Sous-préfecture ${p.object} rattachée à la préfecture ${p.target}.`,
  },
  fusionner_prefectures: {
    object: 'Préfecture absorbée (devient inactive)',
    target: 'Préfecture conservée',
    done: (p) => `Préfecture ${p.object} fusionnée dans ${p.target}.`,
  },
};

const EFFECT_LABELS: Record<RedistrictingPreview['administrators'][number]['effect'], string> = {
  gagne: 'gagne ce territoire',
  perd: 'perd ce territoire',
  suspendu: 'compte suspendu jusqu’à sa réaffectation',
};

function RedistrictForm({ data, onDone }: { data: Referentials; onDone: OnDone }) {
  const id = useId();
  const [operation, setOperation] = useState<RedistrictingOperation>('rattacher_prefecture');
  const [objectId, setObjectId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [preview, setPreview] = useState<RedistrictingPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const previewRef = useRef<HTMLDivElement>(null);
  const fields = REDISTRICTING_FIELDS[operation];

  const activePrefectures = data.prefectures.filter((p) => p.active);
  const objects =
    operation === 'rattacher_sous_prefecture'
      ? data.subPrefectures.filter((s) => s.active)
      : activePrefectures;
  const targets = (
    operation === 'rattacher_prefecture' ? data.regions.filter((r) => r.active) : activePrefectures
  ).filter((t) => operation !== 'fusionner_prefectures' || String(t.id) !== objectId);

  // Toute modification du choix efface l'aperçu : on confirme toujours ce qu'on a vu
  const change = (apply: () => void) => {
    apply();
    setPreview(null);
    setError(undefined);
  };

  useEffect(() => {
    if (preview) previewRef.current?.focus();
  }, [preview]);

  async function attempt(work: () => Promise<void>) {
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

  const input = () => ({ operation, objectId: Number(objectId), targetId: Number(targetId) });

  function onPreview(event: FormEvent) {
    event.preventDefault();
    if (!objectId || !targetId) {
      setError('Choisissez le territoire et son nouveau rattachement.');
      return;
    }
    void attempt(async () => setPreview(await previewRedistricting(input())));
  }

  function onConfirm() {
    void attempt(async () => {
      const result = await redistrict(input());
      onDone(fields.done(result));
      setPreview(null);
      setObjectId('');
      setTargetId('');
    });
  }

  return (
    <form
      className="ui-form ui-card ui-card--plain"
      onSubmit={onPreview}
      aria-labelledby={`${id}-t`}
      noValidate
    >
      <h3 id={`${id}-t`}>Redécouper</h3>
      <ErrorText error={error} />
      <div className="ui-field">
        <label className="ui-field__label" htmlFor={`${id}-op`}>
          Opération
        </label>
        <select
          className="ui-select"
          id={`${id}-op`}
          value={operation}
          onChange={(e) =>
            change(() => {
              setOperation(e.target.value as RedistrictingOperation);
              setObjectId('');
              setTargetId('');
            })
          }
        >
          {(Object.keys(REDISTRICTING_LABELS) as RedistrictingOperation[]).map((value) => (
            <option key={value} value={value}>
              {REDISTRICTING_LABELS[value]}
            </option>
          ))}
        </select>
      </div>
      <div className="ui-field">
        <label className="ui-field__label" htmlFor={`${id}-object`}>
          {fields.object}
        </label>
        <select
          className="ui-select"
          id={`${id}-object`}
          required
          value={objectId}
          onChange={(e) => change(() => setObjectId(e.target.value))}
        >
          <option value="">Choisir…</option>
          {objects.map((territory) => (
            <option key={territory.id} value={territory.id}>
              {territory.name}
            </option>
          ))}
        </select>
      </div>
      <div className="ui-field">
        <label className="ui-field__label" htmlFor={`${id}-target`}>
          {fields.target}
        </label>
        <select
          className="ui-select"
          id={`${id}-target`}
          required
          value={targetId}
          onChange={(e) => change(() => setTargetId(e.target.value))}
        >
          <option value="">Choisir…</option>
          {targets.map((territory) => (
            <option key={territory.id} value={territory.id}>
              {territory.name}
            </option>
          ))}
        </select>
      </div>
      {!preview && (
        <button type="submit" className="ui-button ui-button--primary" disabled={busy}>
          Voir ce qui bouge
        </button>
      )}
      {preview && (
        <div
          className="ui-card ui-card--plain"
          ref={previewRef}
          tabIndex={-1}
          role="region"
          aria-labelledby={`${id}-preview`}
        >
          <h4 id={`${id}-preview`}>
            {REDISTRICTING_LABELS[preview.operation]} : {preview.object} (aujourd’hui{' '}
            {preview.before}) vers {preview.target}
          </h4>
          <dl className="ui-facts">
            <dt>Praticiens</dt>
            <dd>{preview.practitioners}</dd>
            <dt>Dossiers</dt>
            <dd>{preview.dossiers}</dd>
            {preview.operation === 'fusionner_prefectures' && (
              <>
                <dt>Sous-préfectures</dt>
                <dd>{preview.subPrefectures}</dd>
              </>
            )}
            {preview.others > 0 && (
              <>
                <dt>Autres éléments (demandes, alertes, litiges…)</dt>
                <dd>{preview.others}</dd>
              </>
            )}
            <dt>Administrateurs</dt>
            <dd>
              {preview.administrators.length === 0 ? (
                'Aucun administrateur ne change de territoire.'
              ) : (
                <ul>
                  {preview.administrators.map((admin) => (
                    <li key={`${admin.id}-${admin.effect}`}>
                      {admin.name} (
                      {admin.role === 'regional' ? 'admin régional' : 'admin préfectoral'}) :{' '}
                      {EFFECT_LABELS[admin.effect]}
                    </li>
                  ))}
                </ul>
              )}
            </dd>
          </dl>
          <p>
            Les certificats déjà émis gardent leur territoire d’origine. Pas d’annulation : pour
            revenir en arrière, faites l’opération inverse.
          </p>
          <div className="ui-form__actions">
            <button
              type="button"
              className="ui-button ui-button--primary"
              disabled={busy}
              onClick={onConfirm}
            >
              Confirmer le redécoupage
            </button>
            <button
              type="button"
              className="ui-button ui-button--secondary"
              disabled={busy}
              onClick={() => setPreview(null)}
            >
              Revenir au choix
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

// ---------- Listes codées : spécialités (US-021) et contre-indications (US-063) ----------
// Même forme (code, libellés, actif) et mêmes gestes : ajout, modification, désactivation,
// jamais de suppression. Les deux noms sont féminins (« activée », « Active »).

interface CodedKind {
  key: string;
  title: string;
  intro: string;
  one: string;
  capitalized: string;
  many: string;
  codeExample: string;
  create: (input: CreateSpecialty) => Promise<void>;
  update: (id: number, input: UpdateSpecialty) => Promise<void>;
}

const SPECIALTIES: CodedKind = {
  key: 'specialites',
  title: 'Spécialités',
  intro: 'Une spécialité désactivée n’est plus proposée ; les praticiens qui l’ont la gardent.',
  one: 'spécialité',
  capitalized: 'Spécialité',
  many: 'spécialités',
  codeExample: 'ophtalmologie',
  create: createSpecialty,
  update: updateSpecialty,
};

const CONTRAINDICATIONS: CodedKind = {
  key: 'contre-indications',
  title: 'Contre-indications',
  intro:
    'Proposées au praticien dans le Studio et affichées en alerte sur le traitement. Une contre-indication désactivée n’est plus proposée ; les traitements qui l’ont la gardent.',
  one: 'contre-indication',
  capitalized: 'Contre-indication',
  many: 'contre-indications',
  codeExample: 'insuffisance_renale',
  create: createContraindication,
  update: updateContraindication,
};

function CodedListSection({
  kind,
  items,
  onDone,
}: {
  kind: CodedKind;
  items: Specialty[];
  onDone: OnDone;
}) {
  // Pagination commune au-delà de 10 lignes (gabarit de liste, 05 §2.45)
  const { pageItems, paginationProps } = usePagination(items, kind.key);
  return (
    <section aria-labelledby={`${kind.key}-title`} className="ui-section">
      <h2 id={`${kind.key}-title`} className="ui-visually-hidden">
        {kind.title}
      </h2>
      <div className="ui-panel-header">
        <p>{kind.intro}</p>
        <OnDemand label={`Ajouter une ${kind.one}`}>
          <SpecialtyForm kind={kind} onDone={onDone} />
        </OnDemand>
      </div>
      <div className="ui-table-block">
        <div className="ui-table-wrap">
          <table className="ui-table">
            <caption className="ui-visually-hidden">{kind.title}</caption>
            <thead>
              <tr>
                <th scope="col">{kind.capitalized}</th>
                <th scope="col">En anglais</th>
                <th scope="col">Statut</th>
                <th scope="col" className="ui-table__actions">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {pageItems.map((specialty) => (
                <SpecialtyItem
                  key={specialty.id}
                  kind={kind}
                  specialty={specialty}
                  onDone={onDone}
                />
              ))}
            </tbody>
          </table>
        </div>
        <Pagination
          {...paginationProps}
          noun={[kind.one, kind.many]}
          label={`Pages : ${kind.title}`}
        />
      </div>
    </section>
  );
}

function SpecialtyItem({
  kind,
  specialty,
  onDone,
}: {
  kind: CodedKind;
  specialty: Specialty;
  onDone: OnDone;
}) {
  const id = useId();
  const { busy, error, run } = useAction(onDone);
  const [editing, setEditing] = useState(false);
  const [labelFr, setLabelFr] = useState(specialty.labelFr);
  const [labelEn, setLabelEn] = useState(specialty.labelEn ?? '');
  const next = !specialty.active;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const ok = await run(
      () => kind.update(specialty.id, { labelFr, labelEn: labelEn.trim() || null }),
      `${kind.capitalized} ${labelFr} modifiée.`,
    );
    if (ok) setEditing(false);
  }

  const toggle = (
    <button
      type="button"
      className={`ui-button ${next ? 'ui-button--secondary' : 'ui-button--danger'}`}
      disabled={busy}
      onClick={() =>
        run(
          () => kind.update(specialty.id, { active: next }),
          `${specialty.labelFr} ${next ? 'activée' : 'désactivée'}.`,
        )
      }
    >
      {next ? 'Activer' : 'Désactiver'}
      <span className="ui-visually-hidden">
        {' '}
        la {kind.one} {specialty.labelFr}
      </span>
    </button>
  );

  return (
    <>
      <tr>
        <th scope="row">
          <span className="ui-person__name">{specialty.labelFr}</span>
        </th>
        <td lang="en">{specialty.labelEn ?? '—'}</td>
        <td>
          <Badge tone={BADGE_TONES[specialty.active ? 'actif' : 'suspendu']}>
            {specialty.active ? 'Active' : 'Inactive'}
          </Badge>
        </td>
        <td className="ui-table__actions">
          <ErrorText error={error} />
          <button
            type="button"
            className="ui-button ui-button--secondary"
            aria-expanded={editing}
            onClick={() => setEditing((value) => !value)}
          >
            {editing ? 'Fermer' : 'Modifier'}
            <span className="ui-visually-hidden">
              {' '}
              la {kind.one} {specialty.labelFr}
            </span>
          </button>{' '}
          {toggle}
        </td>
      </tr>
      {editing && (
        <tr>
          <td colSpan={4}>
            <form className="ui-form ui-form--inline" onSubmit={onSubmit} noValidate>
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
              <div className="ui-form__actions">
                <button type="submit" className="ui-button ui-button--primary" disabled={busy}>
                  Enregistrer
                </button>
              </div>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}

function SpecialtyForm({ kind, onDone }: { kind: CodedKind; onDone: OnDone }) {
  const id = useId();
  const [form, setForm] = useState({ code: '', labelFr: '', labelEn: '' });
  const { busy, error, run } = useAction(onDone);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const ok = await run(
      () =>
        kind.create({
          code: form.code,
          labelFr: form.labelFr,
          labelEn: form.labelEn.trim() || null,
        }),
      `${kind.capitalized} ${form.labelFr} ajoutée.`,
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
      <h3 id={`${id}-t`}>Ajouter une {kind.one}</h3>
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
          Minuscules, chiffres et _, sans accent (ex. {kind.codeExample}).
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
        Ajouter la {kind.one}
      </button>
    </form>
  );
}
