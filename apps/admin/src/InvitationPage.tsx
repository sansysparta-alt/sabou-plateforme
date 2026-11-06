import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { InvitationPreview } from '@sabou/types';
import { acceptInvitation, ApiError, previewInvitation } from './accounts-api';
import { ROLE_LABELS } from './roles';

// Longueur exigée par Keycloak (règle du domaine « sabou ») ; Keycloak reste juge
const MIN_PASSWORD = 12;

// Jeton du lien, lu dans le fragment (#) puis retiré de l'adresse : il ne reste ni dans
// l'historique ni dans une capture d'écran de la barre d'adresse
function takeToken(): string {
  const token = window.location.hash.slice(1);
  if (token) window.history.replaceState(null, '', window.location.pathname);
  return token;
}

type State =
  | { status: 'loading' }
  | { status: 'invalid'; message: string }
  | { status: 'ready'; preview: InvitationPreview }
  | { status: 'done'; preview: InvitationPreview };

// Acceptation d'une invitation (US-012) : l'invité choisit son mot de passe
export function InvitationPage() {
  const [token] = useState(takeToken);
  const wellFormed = /^[\w-]{43}$/.test(token);
  const [state, setState] = useState<State>(() =>
    wellFormed
      ? { status: 'loading' }
      : { status: 'invalid', message: 'Ce lien d’invitation est incomplet.' },
  );

  useEffect(() => {
    if (!wellFormed) return;
    let active = true;
    previewInvitation(token).then(
      (preview) => active && setState({ status: 'ready', preview }),
      (error: unknown) =>
        active &&
        setState({
          status: 'invalid',
          message: error instanceof ApiError ? error.message : 'Lien d’invitation invalide.',
        }),
    );
    return () => {
      active = false;
    };
  }, [token, wellFormed]);

  if (state.status === 'loading') return <p>Chargement…</p>;
  if (state.status === 'invalid') {
    return (
      <>
        <h1>Invitation</h1>
        <p role="alert" className="alert alert--error">
          {state.message}
        </p>
      </>
    );
  }
  if (state.status === 'done') {
    return (
      <>
        <h1>Compte activé</h1>
        <p role="status" className="alert alert--success">
          Votre mot de passe est enregistré. Connectez-vous avec votre adresse e-mail.
        </p>
        <p>
          À la première connexion, vous configurerez le double facteur : une application de votre
          téléphone affichera un code à saisir en plus du mot de passe.
        </p>
        <a className="button button--primary" href="/auth/login">
          Se connecter
        </a>
      </>
    );
  }
  return (
    <PasswordForm
      token={token}
      preview={state.preview}
      onDone={() => setState({ status: 'done', preview: state.preview })}
    />
  );
}

function PasswordForm({
  token,
  preview,
  onDone,
}: {
  token: string;
  preview: InvitationPreview;
  onDone: () => void;
}) {
  const id = useId();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (password.length < MIN_PASSWORD) {
      setError(`Le mot de passe doit compter au moins ${MIN_PASSWORD} caractères.`);
      return;
    }
    if (password !== confirmation) {
      setError('Les deux mots de passe ne sont pas identiques.');
      return;
    }
    setSending(true);
    setError(undefined);
    try {
      await acceptInvitation(token, password);
      onDone();
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'Une erreur est survenue.');
      setSending(false);
    }
  }

  return (
    <>
      <h1>Bienvenue, {preview.firstName}</h1>
      <p>
        La Direction Générale vous a ouvert un compte <strong>{ROLE_LABELS[preview.role]}</strong>.
        Votre identifiant de connexion est <strong>{preview.email}</strong>.
      </p>
      <form className="form" onSubmit={onSubmit} noValidate>
        {error && (
          <p ref={errorRef} tabIndex={-1} role="alert" className="alert alert--error">
            {error}
          </p>
        )}
        {/* Identifiant lu par les gestionnaires de mots de passe */}
        <input type="hidden" name="username" autoComplete="username" value={preview.email} />
        <div className="field">
          <label htmlFor={`${id}-password`}>Choisissez un mot de passe</label>
          <p id={`${id}-hint`} className="hint">
            {MIN_PASSWORD} caractères au moins. Une phrase de plusieurs mots est facile à retenir.
          </p>
          <input
            id={`${id}-password`}
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD}
            maxLength={128}
            aria-describedby={`${id}-hint`}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`${id}-confirmation`}>Saisissez-le une seconde fois</label>
          <input
            id={`${id}-confirmation`}
            type="password"
            autoComplete="new-password"
            required
            maxLength={128}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
          />
        </div>
        <button type="submit" className="button button--primary" disabled={sending}>
          {sending ? 'Enregistrement…' : 'Enregistrer mon mot de passe'}
        </button>
      </form>
    </>
  );
}
