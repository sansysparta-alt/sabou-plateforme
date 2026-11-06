import { useEffect, useState } from 'react';
import {
  fetchSession,
  hasManagementAccess,
  LOGIN_ERRORS,
  logout,
  profileLabel,
  type SessionUser,
} from './session';

type State =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'connected'; user: SessionUser }
  | { status: 'error' };

// Paramètre posé par l'API au retour de Keycloak (?erreur=…, ?info=…), lu une fois puis
// retiré de l'adresse
function takeParam(name: string): string | undefined {
  const url = new URL(window.location.href);
  const value = url.searchParams.get(name);
  if (!value) return undefined;
  url.searchParams.delete(name);
  window.history.replaceState(null, '', url);
  return value;
}

function takeLoginError(): string | undefined {
  const code = takeParam('erreur');
  return code ? (LOGIN_ERRORS[code] ?? LOGIN_ERRORS.connexion) : undefined;
}

export function App() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [loginError] = useState(takeLoginError);
  const [mfaJustEnabled] = useState(() => takeParam('info') === 'double-facteur');

  useEffect(() => {
    let active = true;
    fetchSession().then(
      (user) => active && setState(user ? { status: 'connected', user } : { status: 'anonymous' }),
      () => active && setState({ status: 'error' }),
    );
    return () => {
      active = false;
    };
  }, []);

  async function onLogout() {
    try {
      await logout();
      setState({ status: 'anonymous' });
    } catch {
      setState({ status: 'error' });
    }
  }

  return (
    <>
      <header className="topbar">
        <span className="brand">SABOU</span>
        {state.status === 'connected' && (
          <div className="topbar__user">
            <span>{state.user.name}</span>
            <button type="button" className="button button--secondary" onClick={onLogout}>
              Se déconnecter
            </button>
          </div>
        )}
      </header>
      <main className="page" aria-busy={state.status === 'loading'}>
        {state.status === 'loading' && <p>Chargement…</p>}
        {state.status === 'error' && (
          <p role="alert" className="alert alert--error">
            Le service est momentanément indisponible. Veuillez réessayer dans quelques instants.
          </p>
        )}
        {state.status === 'anonymous' && <LoginPage error={loginError} />}
        {state.status === 'connected' && (
          <HomePage user={state.user} mfaJustEnabled={mfaJustEnabled} />
        )}
      </main>
    </>
  );
}

function LoginPage({ error }: { error?: string }) {
  return (
    <>
      <h1>Application de gestion</h1>
      {error && (
        <p role="alert" className="alert alert--error">
          {error}
        </p>
      )}
      <p>
        Espace réservé aux équipes de la Direction Générale, des régions, des préfectures, du Comité
        scientifique et aux tradipraticiens.
      </p>
      <a className="button button--primary" href="/auth/login">
        Se connecter
      </a>
      <h2>Vos garanties de sécurité</h2>
      <ul className="guarantees">
        <li>Double facteur obligatoire pour tous les administrateurs.</li>
        <li>Compte bloqué 15 minutes après 5 mots de passe erronés.</li>
        <li>Session fermée après 30 minutes d’inactivité.</li>
        <li>Chaque connexion est journalisée.</li>
      </ul>
    </>
  );
}

function HomePage({ user, mfaJustEnabled }: { user: SessionUser; mfaJustEnabled: boolean }) {
  if (!hasManagementAccess(user)) {
    return (
      <>
        <h1>Accès non autorisé</h1>
        <p>
          Votre compte ({profileLabel(user)}) n’a pas accès à l’application de gestion. Vous pouvez
          vous déconnecter.
        </p>
      </>
    );
  }
  return (
    <>
      <h1>Bonjour, {user.name}</h1>
      {mfaJustEnabled && (
        <p role="status" className="alert alert--success">
          Double facteur activé. Le code de votre application vous sera demandé à chaque connexion.
        </p>
      )}
      <dl className="facts">
        <dt>Profil</dt>
        <dd>{profileLabel(user)}</dd>
        <dt>Connexion protégée par double facteur</dt>
        <dd>{user.secondFactor ? 'Oui' : 'Non'}</dd>
      </dl>
      {!user.secondFactor && !mfaJustEnabled && (
        <section aria-labelledby="mfa-title" className="card">
          <h2 id="mfa-title">Protégez votre compte</h2>
          <p>
            Le double facteur demande, en plus du mot de passe, un code affiché par une application
            de votre téléphone. Il est facultatif pour votre profil, mais recommandé.
          </p>
          <a className="button button--primary" href="/auth/login?action=configure-totp">
            Activer le double facteur
          </a>
        </section>
      )}
    </>
  );
}
