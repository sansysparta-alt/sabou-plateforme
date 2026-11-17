import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  Alert,
  Badge,
  Button,
  Icon,
  PageHeader,
  Pagination,
  StatCard,
  Tabs,
  usePagination,
  foldText,
} from '@sabou/ui';
import type {
  AccountReferences,
  AccountRole,
  AccountStatus,
  AccountSummary,
  InvitationLink,
  WorkLanguage,
} from '@sabou/types';
import {
  ApiError,
  fetchReferences,
  inviteAccount,
  listAccounts,
  reactivateAccount,
  renewInvitation,
  suspendAccount,
} from './accounts-api';
import {
  MATRIX_ROLE_LABELS,
  MATRIX_ROLES,
  PERMISSION_GROUPS,
  ROLE_PROFILES,
  VOICE_RIGHTS_NOTE,
  type MatrixRole,
} from '@sabou/types/permissions';
import { formatNationalMobile, PHONE_ERROR, toNationalMobile } from '@sabou/types/phone';
import { BADGE_TONES, ROLE_LABELS, ROLES, STATUS_LABELS } from './roles';
import { PAGE_HEADERS } from './page-headers';

const RIGHTS = [
  ['record', 'Enregistrer'],
  ['translate', 'Traduire'],
  ['validate', 'Valider'],
] as const;

const message = (error: unknown) =>
  error instanceof ApiError ? error.message : 'Une erreur est survenue.';

// Gestion des comptes par la DG (lot A : US-012, US-013, UC-65). Organisation de la page
// (US-019) : titre et action principale, chiffres, recherche et filtres, puis le tableau ;
// le formulaire d'invitation ne s'ouvre qu'à la demande.
type StatusFilter = AccountStatus | 'tous';
const STATUS_FILTERS: [StatusFilter, string][] = [
  ['tous', 'Tous'],
  ['actif', 'Actifs'],
  ['invite', 'Invitations en attente'],
  ['suspendu', 'Suspendus'],
];

export function AccountsPage() {
  const [accounts, setAccounts] = useState<AccountSummary[] | null>(null);
  const [references, setReferences] = useState<AccountReferences | null>(null);
  const [loadError, setLoadError] = useState<string>();
  const [link, setLink] = useState<{ name: string; invitation: InvitationLink }>();
  const [notice, setNotice] = useState<string>();
  const [inviting, setInviting] = useState(false);
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<AccountRole | ''>('');
  const [status, setStatus] = useState<StatusFilter>('tous');
  const searchId = useId();
  const roleId = useId();

  const reload = useCallback(async () => {
    try {
      setAccounts(await listAccounts());
    } catch (error) {
      setLoadError(message(error));
    }
  }, []);

  const ready = accounts !== null && references !== null;

  useEffect(() => {
    listAccounts().then(setAccounts, (error: unknown) => setLoadError(message(error)));
    fetchReferences().then(setReferences, (error: unknown) => setLoadError(message(error)));
  }, []);

  const all = accounts ?? [];
  const count = (wanted: StatusFilter) =>
    wanted === 'tous' ? all.length : all.filter((account) => account.status === wanted).length;
  const term = foldText(query.trim());
  const filtered = all.filter(
    (account) =>
      (status === 'tous' || account.status === status) &&
      (role === '' || account.role === role) &&
      (term === '' ||
        foldText(`${account.firstName} ${account.lastName} ${account.email}`).includes(term)),
  );
  // Retour à la première page à chaque changement de recherche ou de filtre
  const { pageItems: shown, paginationProps } = usePagination(filtered, 'comptes', [
    query,
    role,
    status,
  ]);

  return (
    <>
      <PageHeader
        {...PAGE_HEADERS['/comptes']}
        actions={
          <Button
            variant="primary"
            icon="plus"
            aria-expanded={inviting}
            onClick={() => setInviting((value) => !value)}
          >
            Inviter un compte
          </Button>
        }
      />
      {loadError && <Alert tone="error">{loadError}</Alert>}
      <p role="status" className="ui-live-status">
        {notice}
      </p>
      {link && (
        // Une clé par lien : le panneau repart de zéro (« Lien copié » effacé) à chaque lien
        <InvitationLinkPanel
          key={link.invitation.link}
          name={link.name}
          invitation={link.invitation}
        />
      )}
      {inviting && references && (
        <InviteForm
          references={references}
          onCancel={() => setInviting(false)}
          onInvited={(name, invitation) => {
            setLink({ name, invitation });
            setNotice(`Invitation créée pour ${name}.`);
            setInviting(false);
            void reload();
          }}
        />
      )}
      {!ready && !loadError && <p>Chargement…</p>}
      {ready && (
        <Tabs
          label="Comptes et droits"
          tabs={[
            {
              id: 'comptes',
              label: 'Comptes',
              count: all.length,
              content: accountsTab(),
            },
            { id: 'droits', label: 'Rôles et droits', content: <RolesMatrix /> },
          ]}
        />
      )}
    </>
  );

  function accountsTab() {
    return (
      <>
        <div className="ui-grid ui-grid--stats" aria-label="Chiffres des comptes" role="group">
          <StatCard label="Comptes" value={count('tous')} />
          <StatCard label="Actifs" value={count('actif')} />
          <StatCard label="Invitations en attente" value={count('invite')} />
          <StatCard label="Suspendus" value={count('suspendu')} />
        </div>
        <section aria-labelledby="accounts-title" className="ui-section">
          <h2 id="accounts-title" className="ui-visually-hidden">
            Comptes d’administration
          </h2>
          <div className="ui-toolbar" role="search">
            <div className="ui-toolbar__search">
              <label htmlFor={searchId} className="ui-visually-hidden">
                Rechercher un compte
              </label>
              <input
                id={searchId}
                className="ui-input"
                type="search"
                placeholder="Rechercher par nom ou adresse e-mail"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                }}
              />
            </div>
            <label htmlFor={roleId} className="ui-visually-hidden">
              Filtrer par rôle
            </label>
            <select
              id={roleId}
              className="ui-select ui-toolbar__select"
              value={role}
              onChange={(event) => {
                setRole(event.target.value as AccountRole | '');
              }}
            >
              <option value="">Tous les rôles</option>
              {ROLES.map((value) => (
                <option key={value} value={value}>
                  {ROLE_LABELS[value]}
                </option>
              ))}
            </select>
            <div className="ui-segmented" role="group" aria-label="Filtrer par statut">
              {STATUS_FILTERS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className="ui-segmented__item"
                  aria-pressed={status === value}
                  onClick={() => setStatus(value)}
                >
                  {label} ({count(value)})
                </button>
              ))}
            </div>
          </div>
          <div className="ui-table-block">
            <div className="ui-table-wrap">
              <table className="ui-table">
                <caption className="ui-visually-hidden">Comptes d’administration</caption>
                <thead>
                  <tr>
                    <th scope="col">Compte</th>
                    <th scope="col">Rôle</th>
                    <th scope="col">Zone</th>
                    <th scope="col">Langues de travail</th>
                    <th scope="col">Statut</th>
                    <th scope="col" className="ui-table__actions">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((account) => (
                    <AccountRow
                      key={account.id}
                      account={account}
                      references={references}
                      onChanged={(text, invitation) => {
                        setNotice(text);
                        if (invitation) {
                          setLink({
                            name: `${account.firstName} ${account.lastName}`,
                            invitation,
                          });
                        }
                        void reload();
                      }}
                    />
                  ))}
                </tbody>
              </table>
              {shown.length === 0 && (
                <p className="ui-table-empty">
                  {all.length === 0 ? 'Aucun compte.' : 'Aucun compte ne correspond.'}
                </p>
              )}
            </div>
            <Pagination
              {...paginationProps}
              noun={['compte', 'comptes']}
              label="Pages des comptes"
            />
          </div>
        </section>
      </>
    );
  }
}

// Matrice des droits (US-012b), en consultation seule : celle du cahier des charges (§3.2),
// ligne à ligne, puis les précisions des règles métier. Les droits déjà développés sont prouvés
// conformes au serveur par des tests (packages/db/test/matrice-droits.test.ts, tests de l'API) ;
// les autres sont marqués « À venir ».
const PROFILE_ORDER: MatrixRole[] = [
  'dg',
  'regional',
  'prefectoral',
  'scientifique',
  'praticien',
  'citoyen',
];

function RolesMatrix() {
  return (
    <section aria-labelledby="roles-title" className="ui-section">
      <h2 id="roles-title" className="ui-visually-hidden">
        Rôles et droits
      </h2>
      <p className="ui-muted">
        Chaque compte a un profil, qui fixe ce qu’il peut faire et sur quelle zone. Profils et
        droits sont ceux du cahier des charges : ils se consultent ici, ils ne se modifient pas.
      </p>
      <ul className="ui-grid ui-grid--wide ui-role-cards">
        {PROFILE_ORDER.map((role) => (
          <li key={role} className="ui-card ui-card--plain">
            <h3 className="ui-role-cards__title">{MATRIX_ROLE_LABELS[role]}</h3>
            <p className="ui-muted">{ROLE_PROFILES[role].scope}</p>
            <p>{ROLE_PROFILES[role].mission}</p>
          </li>
        ))}
      </ul>
      <div className="ui-table-wrap ui-role-matrix">
        <table className="ui-table">
          <caption className="ui-visually-hidden">Droits de chaque profil</caption>
          <thead>
            <tr>
              <th scope="col">Droit</th>
              {MATRIX_ROLES.map((role) => (
                <th key={role} scope="col" className="ui-table__check">
                  {MATRIX_ROLE_LABELS[role]}
                </th>
              ))}
            </tr>
          </thead>
          {PERMISSION_GROUPS.map((group) => (
            <tbody key={group.title}>
              <tr>
                <th
                  scope="colgroup"
                  colSpan={MATRIX_ROLES.length + 1}
                  className="ui-role-matrix__group"
                >
                  {group.title}
                </th>
              </tr>
              {group.permissions.map((entry) => (
                <tr key={entry.id}>
                  <th scope="row">
                    <span className="ui-role-matrix__label">
                      {entry.label}
                      {!entry.available && <Badge tone="neutral">À venir</Badge>}
                    </span>
                    {entry.source && (
                      <span className="ui-role-matrix__source">Source : {entry.source}</span>
                    )}
                  </th>
                  {MATRIX_ROLES.map((role) => {
                    const grant = entry.grants[role];
                    if (grant === undefined) {
                      return (
                        <td key={role} className="ui-table__check ui-muted">
                          <span aria-hidden="true">—</span>
                          <span className="ui-visually-hidden">Non</span>
                        </td>
                      );
                    }
                    return (
                      <td key={role} className="ui-table__check">
                        {grant === true ? (
                          <>
                            <Icon name="check" />
                            <span className="ui-visually-hidden">Oui</span>
                          </>
                        ) : (
                          grant
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
      <p className="ui-field__hint">{VOICE_RIGHTS_NOTE}</p>
    </section>
  );
}

function InvitationLinkPanel({ name, invitation }: { name: string; invitation: InvitationLink }) {
  const id = useId();
  const [copied, setCopied] = useState(false);
  const panel = useRef<HTMLElement>(null);
  // Le lien vient d'apparaître : le focus y est porté, pour le clavier et les lecteurs d'écran
  useEffect(() => {
    panel.current?.focus();
  }, []);
  const expires = new Date(invitation.expiresAt).toLocaleString('fr-FR', {
    dateStyle: 'long',
    timeStyle: 'short',
  });
  return (
    <section
      ref={panel}
      tabIndex={-1}
      className="ui-card ui-card--plain ui-card--success"
      aria-labelledby={`${id}-title`}
    >
      <h2 id={`${id}-title`}>Lien d’invitation pour {name}</h2>
      <p>
        Transmettez ce lien à la personne, par un moyen sûr. Il ne sert qu’une fois et expire le{' '}
        {expires}.
      </p>
      <label className="ui-field__label" htmlFor={`${id}-link`}>
        Lien
      </label>
      <input
        id={`${id}-link`}
        className="ui-input ui-code"
        readOnly
        value={invitation.link}
        onFocus={(event) => event.target.select()}
      />
      <button
        type="button"
        className="ui-button ui-button--secondary"
        onClick={() =>
          void navigator.clipboard?.writeText(invitation.link).then(() => setCopied(true))
        }
      >
        Copier le lien
      </button>
      <span role="status" className="ui-badge ui-badge--success">
        {copied ? 'Lien copié.' : ''}
      </span>
    </section>
  );
}

function AccountRow({
  account,
  references,
  onChanged,
}: {
  account: AccountSummary;
  references: AccountReferences | null;
  onChanged: (notice: string, invitation?: InvitationLink) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const name = `${account.firstName} ${account.lastName}`;
  const languageName = (code: string) =>
    references?.languages.find((language) => language.code === code)?.name ?? code;

  async function act(work: () => Promise<InvitationLink | void>, done: string) {
    setBusy(true);
    setError(undefined);
    try {
      const invitation = await work();
      onChanged(done, invitation ?? undefined);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <th scope="row">
        <span className="ui-person">
          <span className="ui-avatar ui-avatar--light" aria-hidden="true">
            {(account.firstName[0] ?? '') + (account.lastName[0] ?? '')}
          </span>
          <span className="ui-person__text">
            <span className="ui-person__name">{name}</span>
            <span className="ui-person__email">{account.email}</span>
            {account.phone && (
              <span className="ui-person__email">
                {formatNationalMobile(account.phone.replace(/^\+224/, ''))}
              </span>
            )}
          </span>
        </span>
      </th>
      <td>{ROLE_LABELS[account.role]}</td>
      <td>{account.zone}</td>
      <td>
        {account.languages.length === 0
          ? 'Aucune'
          : account.languages
              .map(
                (language) =>
                  `${languageName(language.code)} (${RIGHTS.filter(([right]) => language[right])
                    .map(([, label]) => label.toLowerCase())
                    .join(', ')})`,
              )
              .join(' ; ')}
      </td>
      <td>
        <Badge tone={BADGE_TONES[account.status]}>{STATUS_LABELS[account.status]}</Badge>
      </td>
      <td className="ui-table__actions">
        {error && <Alert tone="error">{error}</Alert>}
        {account.status === 'actif' && !account.self && (
          <button
            type="button"
            className="ui-button ui-button--danger"
            disabled={busy}
            onClick={() => act(() => suspendAccount(account.id), `Compte de ${name} suspendu.`)}
          >
            Suspendre<span className="ui-visually-hidden"> le compte de {name}</span>
          </button>
        )}
        {account.status === 'suspendu' && (
          <button
            type="button"
            className="ui-button ui-button--secondary"
            disabled={busy}
            onClick={() => act(() => reactivateAccount(account.id), `Compte de ${name} réactivé.`)}
          >
            Réactiver<span className="ui-visually-hidden"> le compte de {name}</span>
          </button>
        )}
        {account.status === 'invite' && (
          <button
            type="button"
            className="ui-button ui-button--secondary"
            disabled={busy}
            onClick={() => act(() => renewInvitation(account.id), `Nouveau lien pour ${name}.`)}
          >
            Nouveau lien<span className="ui-visually-hidden"> d’invitation pour {name}</span>
          </button>
        )}
      </td>
    </tr>
  );
}

interface FormState {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  role: AccountRole | '';
  regionId: string;
  prefectureId: string;
  listeningLanguage: string;
  languages: Record<string, Omit<WorkLanguage, 'code'>>;
}

const EMPTY: FormState = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  role: '',
  regionId: '',
  prefectureId: '',
  listeningLanguage: '',
  languages: {},
};

function InviteForm({
  references,
  onInvited,
  onCancel,
}: {
  references: AccountReferences;
  onCancel: () => void;
  onInvited: (name: string, invitation: InvitationLink) => void;
}) {
  const id = useId();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  function setRight(code: string, right: (typeof RIGHTS)[number][0], value: boolean) {
    setForm((current) => {
      const rights = current.languages[code] ?? {
        record: false,
        translate: false,
        validate: false,
      };
      return {
        ...current,
        languages: { ...current.languages, [code]: { ...rights, [right]: value } },
      };
    });
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!form.firstName.trim() || !form.lastName.trim() || !form.email.trim() || !form.role) {
      setError('Renseignez le prénom, le nom, l’adresse e-mail et le rôle.');
      return;
    }
    if (form.phone.trim() && !toNationalMobile(form.phone)) {
      setError(PHONE_ERROR);
      return;
    }
    setSending(true);
    setError(undefined);
    try {
      const invitation = await inviteAccount({
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        phone: form.phone.trim() || null,
        role: form.role,
        // Seule la zone du rôle est envoyée ; l'API refuse une zone absente ou en trop
        regionId: form.role === 'regional' && form.regionId ? Number(form.regionId) : null,
        prefectureId:
          form.role === 'prefectoral' && form.prefectureId ? Number(form.prefectureId) : null,
        listeningLanguage: form.listeningLanguage || null,
        languages: Object.entries(form.languages)
          .filter(([, rights]) => rights.record || rights.translate || rights.validate)
          .map(([code, rights]) => ({ code, ...rights })),
      });
      onInvited(`${form.firstName.trim()} ${form.lastName.trim()}`, invitation);
      setForm(EMPTY);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setSending(false);
    }
  }

  const voiceLanguages = references.languages.filter((language) => language.voice);
  return (
    <section aria-labelledby={`${id}-title`} className="ui-card ui-card--plain">
      <h2 id={`${id}-title`}>Inviter un compte</h2>
      <p className="ui-muted">
        Le prénom, le nom, l’adresse e-mail et le rôle sont obligatoires. Un lien d’invitation est
        créé, à transmettre à la personne.
      </p>
      <form className="ui-form" onSubmit={onSubmit} noValidate>
        {error && (
          <Alert tone="error" ref={errorRef}>
            {error}
          </Alert>
        )}
        <fieldset className="ui-form-section">
          <legend className="ui-form-section__legend">Identité</legend>
          <div className="ui-form-row">
            <div className="ui-field">
              <label className="ui-field__label" htmlFor={`${id}-first`}>
                Prénom
              </label>
              <input
                className="ui-input"
                id={`${id}-first`}
                autoComplete="off"
                required
                maxLength={80}
                value={form.firstName}
                onChange={(event) => set('firstName', event.target.value)}
              />
            </div>
            <div className="ui-field">
              <label className="ui-field__label" htmlFor={`${id}-last`}>
                Nom
              </label>
              <input
                className="ui-input"
                id={`${id}-last`}
                autoComplete="off"
                required
                maxLength={80}
                value={form.lastName}
                onChange={(event) => set('lastName', event.target.value)}
              />
            </div>
          </div>
          <div className="ui-form-row">
            <div className="ui-field">
              <label className="ui-field__label" htmlFor={`${id}-email`}>
                Adresse e-mail
              </label>
              <input
                className="ui-input"
                id={`${id}-email`}
                type="email"
                autoComplete="off"
                required
                maxLength={254}
                aria-describedby={`${id}-email-hint`}
                value={form.email}
                onChange={(event) => set('email', event.target.value)}
              />
              <p id={`${id}-email-hint`} className="ui-field__hint">
                Elle sert d’identifiant de connexion.
              </p>
            </div>
            <div className="ui-field">
              <label className="ui-field__label" htmlFor={`${id}-phone`}>
                Téléphone (facultatif)
              </label>
              <input
                className="ui-input"
                id={`${id}-phone`}
                type="tel"
                inputMode="tel"
                autoComplete="off"
                maxLength={30}
                aria-describedby={`${id}-phone-hint`}
                value={form.phone}
                onChange={(event) => set('phone', event.target.value)}
              />
              <p id={`${id}-phone-hint`} className="ui-field__hint">
                Mobile guinéen (par exemple 621 23 45 67), pour être joint par la Direction
                générale.
              </p>
            </div>
          </div>
        </fieldset>
        <fieldset className="ui-form-section">
          <legend className="ui-form-section__legend">Rôle et zone</legend>
          <div className="ui-form-row">
            <div className="ui-field">
              <label className="ui-field__label" htmlFor={`${id}-role`}>
                Rôle
              </label>
              <select
                className="ui-select"
                id={`${id}-role`}
                required
                value={form.role}
                aria-describedby={form.role ? `${id}-role-hint` : undefined}
                onChange={(event) => set('role', event.target.value as AccountRole | '')}
              >
                <option value="">Choisir un rôle</option>
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {ROLE_LABELS[role]}
                  </option>
                ))}
              </select>
              {/* Ce que la DG attribue, au moment de le choisir (maquette, diapositive 2) */}
              {form.role && (
                <p id={`${id}-role-hint`} className="ui-field__hint">
                  {ROLE_PROFILES[form.role].scope} · {ROLE_PROFILES[form.role].mission}
                </p>
              )}
            </div>
            {form.role === 'regional' && (
              <div className="ui-field">
                <label className="ui-field__label" htmlFor={`${id}-region`}>
                  Région
                </label>
                <select
                  className="ui-select"
                  id={`${id}-region`}
                  required
                  value={form.regionId}
                  onChange={(event) => set('regionId', event.target.value)}
                >
                  <option value="">Choisir une région</option>
                  {references.regions.map((region) => (
                    <option key={region.id} value={region.id}>
                      {region.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {form.role === 'prefectoral' && (
              <div className="ui-field">
                <label className="ui-field__label" htmlFor={`${id}-prefecture`}>
                  Préfecture
                </label>
                <select
                  className="ui-select"
                  id={`${id}-prefecture`}
                  required
                  value={form.prefectureId}
                  onChange={(event) => set('prefectureId', event.target.value)}
                >
                  <option value="">Choisir une préfecture</option>
                  {references.regions.map((region) => (
                    <optgroup key={region.id} label={region.name}>
                      {references.prefectures
                        .filter((prefecture) => prefecture.regionId === region.id)
                        .map((prefecture) => (
                          <option key={prefecture.id} value={prefecture.id}>
                            {prefecture.name}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
              </div>
            )}
          </div>
        </fieldset>
        {/* Langue de l'interface : préférence personnelle, choisie par la personne elle-même
            (sélecteur FR / EN), pas par la DG ; français par défaut */}
        <fieldset className="ui-form-section">
          <legend className="ui-form-section__legend">Langues et voix</legend>
          <div className="ui-field">
            <label className="ui-field__label" htmlFor={`${id}-listening`}>
              Langue d’écoute préférée
            </label>
            <select
              className="ui-select"
              id={`${id}-listening`}
              value={form.listeningLanguage}
              onChange={(event) => set('listeningLanguage', event.target.value)}
            >
              <option value="">Celle de la région</option>
              {voiceLanguages.map((language) => (
                <option key={language.code} value={language.code}>
                  {language.name}
                </option>
              ))}
            </select>
          </div>
          <fieldset className="ui-fieldset" aria-describedby={`${id}-rights-hint`}>
            <legend className="ui-fieldset__legend">Langues de travail</legend>
            <p id={`${id}-rights-hint`} className="ui-field__hint">
              Cochez ce que la personne peut faire dans chaque langue ; rien à cocher si elle ne
              travaille pas sur les voix.
            </p>
            {/* Une ligne par langue, une colonne par droit : quinze langues tiennent sur un écran */}
            <div className="ui-table-wrap ui-check-matrix">
              <table className="ui-table">
                <caption className="ui-visually-hidden">Droits par langue de travail</caption>
                <thead>
                  <tr>
                    <th scope="col">Langue</th>
                    {RIGHTS.map(([right, label]) => (
                      <th key={right} scope="col" className="ui-table__check">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {voiceLanguages.map((language) => (
                    <tr key={language.code}>
                      <th scope="row">{language.name}</th>
                      {RIGHTS.map(([right, label]) => (
                        <td key={right} className="ui-table__check">
                          <label>
                            <input
                              type="checkbox"
                              checked={form.languages[language.code]?.[right] ?? false}
                              onChange={(event) =>
                                setRight(language.code, right, event.target.checked)
                              }
                            />
                            <span className="ui-visually-hidden">
                              {label} en {language.name}
                            </span>
                            <span className="ui-check-matrix__short" aria-hidden="true">
                              {label}
                            </span>
                          </label>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </fieldset>
        </fieldset>
        <div className="ui-form__actions">
          <button type="submit" className="ui-button ui-button--primary" disabled={sending}>
            {sending ? 'Création…' : 'Créer l’invitation'}
          </button>
          <button
            type="button"
            className="ui-button ui-button--tertiary"
            disabled={sending}
            onClick={onCancel}
          >
            Annuler
          </button>
        </div>
      </form>
    </section>
  );
}
