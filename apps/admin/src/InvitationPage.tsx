import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Alert, PageHeader, TextField } from '@sabou/ui';
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
        <PageHeader title="Invitation" />
        <Alert tone="error">{state.message}</Alert>
      </>
    );
  }
  if (state.status === 'done') {
    return (
      <>
        <PageHeader title="Compte activé" />
        <Alert tone="success">
          Votre mot de passe est enregistré. Connectez-vous avec votre adresse e-mail.
        </Alert>
        <p>
          À la première connexion, vous configurerez le double facteur : une application de votre
          téléphone affichera un code à saisir en plus du mot de passe.
        </p>
        <a className="ui-button ui-button--primary" href="/auth/login">
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
  // Erreurs de saisie sous le champ concerné ; le bandeau reste aux refus du serveur
  const [errors, setErrors] = useState<{ password?: string; confirmation?: string }>({});
  const [sending, setSending] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const found =
      password.length < MIN_PASSWORD
        ? { password: `Au moins ${MIN_PASSWORD} caractères.` }
        : password !== confirmation
          ? { confirmation: 'Les deux saisies ne sont pas identiques.' }
          : {};
    setErrors(found);
    if (found.password || found.confirmation) {
      setError(undefined);
      document.getElementById(`${id}-${found.password ? 'password' : 'confirmation'}`)?.focus();
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
      <PageHeader title={`Bienvenue, ${preview.firstName}`} />
      <p>
        La Direction Générale vous a ouvert un compte <strong>{ROLE_LABELS[preview.role]}</strong>.
        Votre identifiant de connexion est <strong>{preview.email}</strong>.
      </p>
      <form className="ui-form" onSubmit={onSubmit} noValidate>
        {error && (
          <Alert tone="error" ref={errorRef}>
            {error}
          </Alert>
        )}
        {/* Identifiant lu par les gestionnaires de mots de passe */}
        <input type="hidden" name="username" autoComplete="username" value={preview.email} />
        <TextField
          id={`${id}-password`}
          label="Choisissez un mot de passe"
          hint={`${MIN_PASSWORD} caractères au moins. Une phrase de plusieurs mots est facile à retenir.`}
          type="password"
          autoComplete="new-password"
          maxLength={128}
          value={password}
          error={errors.password}
          onChange={(event) => {
            setPassword(event.target.value);
            setErrors({});
          }}
        />
        <TextField
          id={`${id}-confirmation`}
          label="Saisissez-le une seconde fois"
          type="password"
          autoComplete="new-password"
          maxLength={128}
          value={confirmation}
          error={errors.confirmation}
          onChange={(event) => {
            setConfirmation(event.target.value);
            setErrors({});
          }}
        />
        <button type="submit" className="ui-button ui-button--primary" disabled={sending}>
          {sending ? 'Enregistrement…' : 'Enregistrer mon mot de passe'}
        </button>
      </form>
    </>
  );
}
