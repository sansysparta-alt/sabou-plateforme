import { lazy, Suspense, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { Alert, AppShell, Button, ButtonLink, PageHeader, type NavGroup } from '@sabou/ui';
// Pages chargées à la demande, tableau de bord compris : la page de connexion reste légère en 3G
// (seuil de temps de blocage de Lighthouse, US-010)
const Dashboard = lazy(() => import('./Dashboard').then((m) => ({ default: m.Dashboard })));
const AccountsPage = lazy(() =>
  import('./AccountsPage').then((m) => ({ default: m.AccountsPage })),
);
const ReferentialsPage = lazy(() =>
  import('./ReferentialsPage').then((m) => ({ default: m.ReferentialsPage })),
);
const InvitationPage = lazy(() =>
  import('./InvitationPage').then((m) => ({ default: m.InvitationPage })),
);
const FieldVerificationPage = lazy(() =>
  import('./FieldVerificationPage').then((m) => ({ default: m.FieldVerificationPage })),
);
const ConsolidationPage = lazy(() =>
  import('./ConsolidationPage').then((m) => ({ default: m.ConsolidationPage })),
);
const ApprovalPage = lazy(() =>
  import('./ApprovalPage').then((m) => ({ default: m.ApprovalPage })),
);
const CertificatePage = lazy(() =>
  import('./CertificatePage').then((m) => ({ default: m.CertificatePage })),
);
const RejectionPage = lazy(() =>
  import('./RejectionPage').then((m) => ({ default: m.RejectionPage })),
);
const FunnelPage = lazy(() => import('./FunnelPage').then((m) => ({ default: m.FunnelPage })));
const ExpertisePage = lazy(() =>
  import('./ExpertisePage').then((m) => ({ default: m.ExpertisePage })),
);
import {
  fetchSession,
  hasManagementAccess,
  isCommittee,
  isDirector,
  isPrefectoral,
  isRegional,
  LOGIN_ERRORS,
  logout,
  profileLabel,
  type SessionUser,
} from './session';
// Illustration de la connexion (maquette v1.3), 8 Ko en WebP
import illustration from './assets/connexion.webp';

type State =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'connected'; user: SessionUser }
  | { status: 'error' };

// Navigation hors de l'application (ouverture de la connexion Keycloak), isolée pour les tests
export const browser = { assign: (url: string) => window.location.assign(url) };

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

// Pages de l'application ; toute autre adresse mène à l'accueil
const path = () => window.location.pathname.replace(/\/+$/, '') || '/';

export function App() {
  // Acceptation d'une invitation : la personne n'a pas encore de compte ni de session
  if (path() === '/invitation') {
    return (
      <PublicLayout>
        <Suspense fallback={<p>Chargement…</p>}>
          <InvitationPage />
        </Suspense>
      </PublicLayout>
    );
  }
  return <ConnectedApp />;
}

function ConnectedApp() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [loginError] = useState(takeLoginError);
  // Déconnexion volontaire : on reste sur la page d'accueil au lieu de rouvrir la connexion
  const [loggedOut, setLoggedOut] = useState(false);
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

  // Sans session : la page de connexion unique (Keycloak, US-019) s'ouvre directement. La page
  // d'accueil ne sert qu'à montrer une erreur de connexion, ou après une déconnexion.
  const directLogin = state.status === 'anonymous' && !loginError && !loggedOut;
  useEffect(() => {
    if (directLogin) browser.assign('/auth/login');
  }, [directLogin]);

  async function onLogout() {
    try {
      await logout();
      setLoggedOut(true);
      setState({ status: 'anonymous' });
    } catch {
      setState({ status: 'error' });
    }
  }

  if (state.status === 'connected' && hasManagementAccess(state.user)) {
    const { user } = state;
    return (
      <AppShell
        user={{ name: user.name, zone: profileLabel(user) }}
        nav={navigation(user)}
        currentPath={path()}
        userActions={
          <Button variant="secondary" icon="logout" onClick={onLogout}>
            Se déconnecter
          </Button>
        }
      >
        <ConnectedPage user={user} mfaJustEnabled={mfaJustEnabled} />
      </AppShell>
    );
  }

  if (state.status === 'anonymous' && !directLogin) return <LoginPage error={loginError} />;

  return (
    <PublicLayout busy={state.status === 'loading'}>
      {(state.status === 'loading' || directLogin) && <p>Chargement…</p>}
      {state.status === 'error' && (
        <Alert tone="error" title="Service indisponible">
          Le service est momentanément indisponible. Veuillez réessayer dans quelques instants.
        </Alert>
      )}
      {state.status === 'connected' && <Forbidden user={state.user} onLogout={onLogout} />}
    </PublicLayout>
  );
}

// Pages hors navigation (connexion, invitation, accès refusé) : bandeau seul
function PublicLayout({ busy = false, children }: { busy?: boolean; children: ReactNode }) {
  return (
    <div className="ui-shell">
      <a className="ui-skip-link" href="#contenu">
        Aller au contenu
      </a>
      <header className="ui-topbar">
        <a className="ui-topbar__brand" href="/">
          <span className="ui-topbar__mark" aria-hidden="true">
            S
          </span>
          SABOU
        </a>
      </header>
      <main id="contenu" className="ui-main" tabIndex={-1} aria-busy={busy}>
        <div className="ui-main__inner">{children}</div>
      </main>
    </div>
  );
}

// Navigation selon le rôle ; l'API refuse aussi les pages de gestion aux autres profils
function navigation(user: SessionUser): NavGroup[] {
  const groups: NavGroup[] = [
    { heading: 'Pilotage', items: [{ href: '/', label: 'Tableau de bord', icon: 'dashboard' }] },
  ];
  if (isPrefectoral(user)) {
    groups.push({
      heading: 'Certification',
      items: [{ href: '/verification-terrain', label: 'Vérification terrain', icon: 'folder' }],
    });
  }
  if (isRegional(user)) {
    groups.push({
      heading: 'Certification',
      items: [{ href: '/consolidation', label: 'Consolidation régionale', icon: 'folder' }],
    });
  }
  if (isCommittee(user)) {
    groups.push({
      heading: 'Certification',
      items: [{ href: '/expertise', label: 'Expertise des dossiers', icon: 'folder' }],
    });
  }
  if (isDirector(user)) {
    // Pilotage de la DG : entonnoir des 6 étapes (US-048)
    groups[0]!.items.push({
      href: '/entonnoir',
      label: 'Entonnoir de certification',
      icon: 'clock',
    });
    groups.push({
      heading: 'Certification',
      items: [
        { href: '/approbation', label: 'Approbation des dossiers', icon: 'shield' },
        { href: '/rejet-definitif', label: 'Rejet définitif', icon: 'error' },
      ],
    });
    groups.push({
      heading: 'Administration',
      items: [
        { href: '/comptes', label: 'Comptes', icon: 'users' },
        { href: '/referentiels', label: 'Référentiels', icon: 'book' },
      ],
    });
  }
  return groups;
}

// Pages de chaque profil ; tout autre profil, ou toute autre adresse, mène à l'accueil
const DIRECTOR_PAGES: Record<string, ComponentType> = {
  '/entonnoir': FunnelPage,
  '/approbation': ApprovalPage,
  '/rejet-definitif': RejectionPage,
  '/comptes': AccountsPage,
  '/referentiels': ReferentialsPage,
};
const PREFECTORAL_PAGES: Record<string, ComponentType> = {
  '/verification-terrain': FieldVerificationPage,
};
const REGIONAL_PAGES: Record<string, ComponentType> = {
  '/consolidation': ConsolidationPage,
};
const COMMITTEE_PAGES: Record<string, ComponentType> = {
  '/expertise': ExpertisePage,
};

// Certificat à imprimer (US-045) : /certificats/<numéro>, ouvert à la DG après l'approbation
const CERTIFICATE_PATH = /^\/certificats\/(SAB-\d{4}-PR\d{1,10}-[A-Z2-9]{3})$/;

function ConnectedPage({ user, mfaJustEnabled }: { user: SessionUser; mfaJustEnabled: boolean }) {
  const certificate = isDirector(user) ? CERTIFICATE_PATH.exec(path()) : null;
  if (certificate) {
    return (
      <Suspense fallback={<p>Chargement…</p>}>
        <CertificatePage numero={certificate[1]!} />
      </Suspense>
    );
  }
  const Page = isDirector(user)
    ? DIRECTOR_PAGES[path()]
    : isPrefectoral(user)
      ? PREFECTORAL_PAGES[path()]
      : isRegional(user)
        ? REGIONAL_PAGES[path()]
        : isCommittee(user)
          ? COMMITTEE_PAGES[path()]
          : undefined;
  return (
    <Suspense fallback={<p>Chargement…</p>}>
      {Page ? <Page /> : <Dashboard user={user} mfaJustEnabled={mfaJustEnabled} />}
    </Suspense>
  );
}

// Connexion (maquette v1.3) : panneau vert à gauche (marque, illustration, accès), garanties de
// sécurité à droite ; les deux s'empilent sur téléphone. Le formulaire lui-même est celui de
// Keycloak, ouvert par le bouton.
function LoginPage({ error }: { error?: string }) {
  return (
    <div className="ui-login">
      <a className="ui-skip-link" href="#contenu">
        Aller au contenu
      </a>
      <main id="contenu" className="ui-login__main" tabIndex={-1}>
        <section className="ui-login__hero" aria-labelledby="connexion-titre">
          <img
            className="ui-login__art"
            src={illustration}
            alt=""
            width={960}
            height={480}
            decoding="async"
          />
          <p className="ui-login__brand">
            <span className="ui-topbar__mark" aria-hidden="true">
              S
            </span>
            SABOU
          </p>
          <p className="ui-login__kicker">Accès sécurisé</p>
          <h1 id="connexion-titre">Application de gestion</h1>
          <p className="ui-login__lead">
            Espace réservé aux équipes de la Direction Générale, des régions, des préfectures, du
            Comité scientifique et aux tradipraticiens.
          </p>
          {error && <Alert tone="error">{error}</Alert>}
          <ButtonLink variant="primary" href="/auth/login" className="ui-login__action">
            Se connecter
          </ButtonLink>
          <p className="ui-login__note">Double facteur obligatoire pour les administrateurs</p>
        </section>
        <section className="ui-login__panel" aria-labelledby="garanties-titre">
          <h2 id="garanties-titre">Vos garanties de sécurité</h2>
          <ul className="ui-login__list">
            <li>Double facteur obligatoire pour tous les administrateurs.</li>
            <li>Compte bloqué 15 minutes après 5 mots de passe erronés.</li>
            <li>Session fermée après 30 minutes d’inactivité.</li>
            <li>Chaque connexion est journalisée.</li>
          </ul>
        </section>
      </main>
    </div>
  );
}

function Forbidden({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  return (
    <>
      <PageHeader title="Accès non autorisé" />
      <p>
        Votre compte ({profileLabel(user)}) n’a pas accès à l’application de gestion. Vous pouvez
        vous déconnecter.
      </p>
      <div>
        <Button variant="secondary" icon="logout" onClick={onLogout}>
          Se déconnecter
        </Button>
      </div>
    </>
  );
}
