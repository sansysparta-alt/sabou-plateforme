import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Alert, Badge, PageHeader } from '@sabou/ui';
import type {
  AccountReferences,
  AccountRole,
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
import { BADGE_TONES, ROLE_LABELS, ROLES, STATUS_LABELS } from './roles';

const RIGHTS = [
  ['record', 'Enregistrer'],
  ['translate', 'Traduire'],
  ['validate', 'Valider'],
] as const;

const message = (error: unknown) =>
  error instanceof ApiError ? error.message : 'Une erreur est survenue.';

// Gestion des comptes par la DG (lot A : US-012, US-013, UC-65)
export function AccountsPage() {
  const [accounts, setAccounts] = useState<AccountSummary[] | null>(null);
  const [references, setReferences] = useState<AccountReferences | null>(null);
  const [loadError, setLoadError] = useState<string>();
  const [link, setLink] = useState<{ name: string; invitation: InvitationLink }>();
  const [notice, setNotice] = useState<string>();

  const reload = useCallback(async () => {
    try {
      setAccounts(await listAccounts());
    } catch (error) {
      setLoadError(message(error));
    }
  }, []);

  useEffect(() => {
    listAccounts().then(setAccounts, (error: unknown) => setLoadError(message(error)));
    fetchReferences().then(setReferences, (error: unknown) => setLoadError(message(error)));
  }, []);

  return (
    <>
      <PageHeader title="Comptes" />
      <p>
        Invitez les membres des équipes, attribuez leur rôle, leur zone et leurs langues de travail.
        Une suspension coupe l’accès immédiatement.
      </p>
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
      {references && (
        <InviteForm
          references={references}
          onInvited={(name, invitation) => {
            setLink({ name, invitation });
            setNotice(`Invitation créée pour ${name}.`);
            void reload();
          }}
        />
      )}
      <section aria-labelledby="accounts-title">
        <h2 id="accounts-title">Comptes d’administration</h2>
        {accounts === null && !loadError && <p>Chargement…</p>}
        {accounts?.length === 0 && <p>Aucun compte.</p>}
        {accounts && accounts.length > 0 && (
          <ul className="ui-stack">
            {accounts.map((account) => (
              <AccountItem
                key={account.id}
                account={account}
                references={references}
                onChanged={(text, invitation) => {
                  setNotice(text);
                  if (invitation) {
                    setLink({ name: `${account.firstName} ${account.lastName}`, invitation });
                  }
                  void reload();
                }}
              />
            ))}
          </ul>
        )}
      </section>
    </>
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

function AccountItem({
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
    <li className="ui-card ui-card--plain">
      <h3>{name}</h3>
      <dl className="ui-facts">
        <dt>Rôle</dt>
        <dd>{ROLE_LABELS[account.role]}</dd>
        <dt>Zone</dt>
        <dd>{account.zone}</dd>
        <dt>Adresse e-mail</dt>
        <dd>{account.email}</dd>
        <dt>Langues de travail</dt>
        <dd>
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
        </dd>
        <dt>Statut</dt>
        <dd>
          <Badge tone={BADGE_TONES[account.status]}>{STATUS_LABELS[account.status]}</Badge>
        </dd>
      </dl>
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
    </li>
  );
}

interface FormState {
  firstName: string;
  lastName: string;
  email: string;
  role: AccountRole | '';
  regionId: string;
  prefectureId: string;
  interfaceLanguage: 'fr' | 'en';
  listeningLanguage: string;
  languages: Record<string, Omit<WorkLanguage, 'code'>>;
}

const EMPTY: FormState = {
  firstName: '',
  lastName: '',
  email: '',
  role: '',
  regionId: '',
  prefectureId: '',
  interfaceLanguage: 'fr',
  listeningLanguage: '',
  languages: {},
};

function InviteForm({
  references,
  onInvited,
}: {
  references: AccountReferences;
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
    setSending(true);
    setError(undefined);
    try {
      const invitation = await inviteAccount({
        firstName: form.firstName,
        lastName: form.lastName,
        email: form.email,
        role: form.role,
        // Seule la zone du rôle est envoyée ; l'API refuse une zone absente ou en trop
        regionId: form.role === 'regional' && form.regionId ? Number(form.regionId) : null,
        prefectureId:
          form.role === 'prefectoral' && form.prefectureId ? Number(form.prefectureId) : null,
        interfaceLanguage: form.interfaceLanguage,
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
      <form className="ui-form" onSubmit={onSubmit} noValidate>
        {error && (
          <Alert tone="error" ref={errorRef}>
            {error}
          </Alert>
        )}
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
        <div className="ui-field">
          <label className="ui-field__label" htmlFor={`${id}-email`}>
            Adresse e-mail (identifiant de connexion)
          </label>
          <input
            className="ui-input"
            id={`${id}-email`}
            type="email"
            autoComplete="off"
            required
            maxLength={254}
            value={form.email}
            onChange={(event) => set('email', event.target.value)}
          />
        </div>
        <div className="ui-field">
          <label className="ui-field__label" htmlFor={`${id}-role`}>
            Rôle
          </label>
          <select
            className="ui-select"
            id={`${id}-role`}
            required
            value={form.role}
            onChange={(event) => set('role', event.target.value as AccountRole | '')}
          >
            <option value="">Choisir un rôle</option>
            {ROLES.map((role) => (
              <option key={role} value={role}>
                {ROLE_LABELS[role]}
              </option>
            ))}
          </select>
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
        <fieldset className="ui-fieldset">
          <legend className="ui-fieldset__legend">Langue de l’interface</legend>
          {(
            [
              ['fr', 'Français'],
              ['en', 'Anglais'],
            ] as const
          ).map(([code, label]) => (
            <label key={code} className="ui-choice">
              <input
                type="radio"
                name={`${id}-interface`}
                value={code}
                checked={form.interfaceLanguage === code}
                onChange={() => set('interfaceLanguage', code)}
              />
              {label}
            </label>
          ))}
        </fieldset>
        <div className="ui-field">
          <label className="ui-field__label" htmlFor={`${id}-listening`}>
            Langue d’écoute préférée (voix)
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
        <fieldset className="ui-fieldset">
          <legend className="ui-fieldset__legend">Langues de travail</legend>
          <p className="ui-field__hint">Cochez ce que la personne peut faire dans chaque langue.</p>
          {voiceLanguages.map((language) => (
            <fieldset key={language.code} className="ui-fieldset ui-card ui-card--plain">
              <legend className="ui-fieldset__legend">{language.name}</legend>
              {RIGHTS.map(([right, label]) => (
                <label key={right} className="ui-choice">
                  <input
                    type="checkbox"
                    checked={form.languages[language.code]?.[right] ?? false}
                    onChange={(event) => setRight(language.code, right, event.target.checked)}
                  />
                  {label}
                </label>
              ))}
            </fieldset>
          ))}
        </fieldset>
        <button type="submit" className="ui-button ui-button--primary" disabled={sending}>
          {sending ? 'Création…' : 'Créer l’invitation'}
        </button>
      </form>
    </section>
  );
}
