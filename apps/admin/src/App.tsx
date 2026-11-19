import { lazy, Suspense, useEffect, useState, type ComponentType, type ReactNode } from 'react';
import { Alert, AppShell, Button, ButtonLink, PageHeader, type NavGroup } from '@sabou/ui';
// Pages chargées à la demande, tableau de bord compris : la page de connexion reste légère en 3G
// (seuil de temps de blocage de Lighthouse, US-010)
const loaders = {
  dashboard: () => import('./Dashboard'),
  accounts: () => import('./AccountsPage'),
  referentials: () => import('./ReferentialsPage'),
  invitation: () => import('./InvitationPage'),
  fieldVerification: () => import('./FieldVerificationPage'),
  fieldDossiers: () => import('./FieldDossierPage'),
  consolidation: () => import('./ConsolidationPage'),
  approval: () => import('./ApprovalPage'),
  certificate: () => import('./CertificatePage'),
  rejection: () => import('./RejectionPage'),
  funnel: () => import('./FunnelPage'),
  expertise: () => import('./ExpertisePage'),
  // Dictionnaire (US-050)
  plants: () => import('./PlantsPage'),
  plant: () => import('./PlantPage'),
  // US-052 : fiches maladies (liste et fiche dans le même module)
  diseases: () => import('./DiseasesPage'),
  // US-053 : noms locaux des plantes
  localNames: () => import('./LocalNamesPage'),
  // US-071 : voix du nom des plantes et des maladies
  nameVoices: () => import('./NameVoicesPage'),
  // US-061 : traitements à transmettre, expertiser ou certifier
  treatments: () => import('./TreatmentsPage'),
};
const Dashboard = lazy(() => loaders.dashboard().then((m) => ({ default: m.Dashboard })));
const AccountsPage = lazy(() => loaders.accounts().then((m) => ({ default: m.AccountsPage })));
const ReferentialsPage = lazy(() =>
  loaders.referentials().then((m) => ({ default: m.ReferentialsPage })),
);
const InvitationPage = lazy(() =>
  loaders.invitation().then((m) => ({ default: m.InvitationPage })),
);
const FieldDossierPage = lazy(() =>
  loaders.fieldDossiers().then((m) => ({ default: m.FieldDossierPage })),
);
const FieldVerificationPage = lazy(() =>
  loaders.fieldVerification().then((m) => ({ default: m.FieldVerificationPage })),
);
const ConsolidationPage = lazy(() =>
  loaders.consolidation().then((m) => ({ default: m.ConsolidationPage })),
);
const ApprovalPage = lazy(() => loaders.approval().then((m) => ({ default: m.ApprovalPage })));
const CertificatePage = lazy(() =>
  loaders.certificate().then((m) => ({ default: m.CertificatePage })),
);
const RejectionPage = lazy(() => loaders.rejection().then((m) => ({ default: m.RejectionPage })));
const FunnelPage = lazy(() => loaders.funnel().then((m) => ({ default: m.FunnelPage })));
const ExpertisePage = lazy(() => loaders.expertise().then((m) => ({ default: m.ExpertisePage })));
const PlantsPage = lazy(() => loaders.plants().then((m) => ({ default: m.PlantsPage })));
const PlantPage = lazy(() => loaders.plant().then((m) => ({ default: m.PlantPage })));
const DiseasesPage = lazy(() => loaders.diseases().then((m) => ({ default: m.DiseasesPage })));
const DiseasePage = lazy(() => loaders.diseases().then((m) => ({ default: m.DiseasePage })));
const NameVoicesPage = lazy(() =>
  loaders.nameVoices().then((m) => ({ default: m.NameVoicesPage })),
);
const TreatmentsPage = lazy(() =>
  loaders.treatments().then((m) => ({ default: m.TreatmentsPage })),
);
const LocalNamesPage = lazy(() =>
  loaders.localNames().then((m) => ({ default: m.LocalNamesPage })),
);

// Morceau de la page demandée, d'après la seule adresse
const PAGE_LOADERS: Record<string, () => Promise<unknown>> = {
  '/': loaders.dashboard,
  '/comptes': loaders.accounts,
  '/referentiels': loaders.referentials,
  '/invitation': loaders.invitation,
  '/verification-terrain': loaders.fieldVerification,
  '/dossiers-terrain': loaders.fieldDossiers,
  '/consolidation': loaders.consolidation,
  '/approbation': loaders.approval,
  '/rejet-definitif': loaders.rejection,
  '/entonnoir': loaders.funnel,
  '/expertise': loaders.expertise,
  '/plantes': loaders.plants,
  '/maladies': loaders.diseases,
  '/noms-locaux': loaders.localNames,
  '/voix-des-noms': loaders.nameVoices,
  '/traitements': loaders.treatments,
};

// Lectures que chaque page fait à son ouverture, exactement comme elle les demande ; une file
// de dossiers demande sa première page à la taille mémorisée (US-019b)
const PAGE_DATA: Record<string, (string | (() => string))[]> = {
  '/': ['/api/tableau-de-bord'],
  '/comptes': ['/api/comptes', '/api/comptes/referentiels'],
  '/referentiels': ['/api/referentiels'],
  '/verification-terrain': [() => firstQueuePagePath(QUEUES.fieldVerification)],
  '/dossiers-terrain': ['/api/dossiers-terrain/referentiels', '/api/dossiers-terrain'],
  '/consolidation': [() => firstQueuePagePath(QUEUES.consolidation)],
  '/approbation': [() => firstQueuePagePath(QUEUES.approval)],
  '/entonnoir': ['/api/entonnoir'],
  '/expertise': [() => firstQueuePagePath(QUEUES.expertise)],
  '/plantes': ['/api/plantes'],
  '/maladies': ['/api/maladies'],
  '/noms-locaux': ['/api/noms-locaux/langues', '/api/noms-locaux/plantes'],
  '/voix-des-noms': ['/api/voix-des-noms'],
  '/traitements': [() => firstQueuePagePath(QUEUES.treatments)],
};
const CERTIFICATE_PREFIX = /^\/certificats\/(SAB-\d{4}-PR\d{1,10}-[A-Z2-9]{3})$/;
// Fiche plante (US-050) : /plantes/PL-001, pour la DG et le Comité
const PLANT_PATH = /^\/plantes\/(PL-\d{3,10})$/;
// Fiche maladie (US-052) : /maladies/MA-001, pour la DG et le Comité
const DISEASE_PATH = /^\/maladies\/(MA-\d{3,10})$/;

// US-017 : le morceau de la page et ses données sont demandés dès le démarrage, en même temps
// que la session, au lieu d'attendre la réponse de celle-ci (en 3G, un aller-retour de 300 ms
// par étape). D'après la seule adresse : l'affichage reste soumis au profil, et l'API contrôle
// chaque lecture (un refus n'est jamais repris par une page).
export function preloadCurrentPage(): void {
  const current = path();
  const certificate = CERTIFICATE_PREFIX.exec(current);
  const load = certificate ? loaders.certificate : PAGE_LOADERS[current];
  // Échec (réseau coupé) : sans effet ici, la page le signale à son affichage
  load?.().catch(() => undefined);
  if (certificate) return prefetch(`/api/certificats/${encodeURIComponent(certificate[1]!)}`);
  const plant = PLANT_PATH.exec(current);
  if (plant) {
    loaders.plant().catch(() => undefined);
    return prefetch(`/api/plantes/${encodeURIComponent(plant[1]!)}`);
  }
  const disease = DISEASE_PATH.exec(current);
  if (disease) {
    loaders.diseases().catch(() => undefined);
    return prefetch(`/api/maladies/${encodeURIComponent(disease[1]!)}`);
  }
  // Invitation : la consultation, sans effet, avec le jeton du lien (après le #)
  if (current === '/invitation') {
    const token = window.location.hash.slice(1);
    if (/^[\w-]{43}$/.test(token)) {
      prefetch('/api/invitation/consultation', { method: 'POST', body: { token } });
    }
    return;
  }
  // Retour de connexion en erreur ou connexion perdue : la page de données ne s'ouvre pas
  const params = new URLSearchParams(window.location.search);
  if (params.has('erreur') || params.has('reprise')) return;
  PAGE_DATA[current]?.forEach((url) => prefetch(typeof url === 'string' ? url : url()));
}

import { prefetch } from './prefetch';
import { LoadingShell, PageFallback } from './LoadingShell';
import { firstQueuePagePath, QUEUES } from './queues';
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

// Connexion perdue en route (?reprise=1, US-019) : relancée une fois ; une deuxième perte en
// moins de deux minutes (cookies bloqués, par exemple) affiche l'erreur au lieu de boucler
const RETRY_KEY = 'sabou-reprise-connexion';
const RETRY_WINDOW_MS = 120_000;

function lostLoginTwice(): boolean {
  try {
    const last = Number(window.sessionStorage.getItem(RETRY_KEY));
    if (last && Date.now() - last < RETRY_WINDOW_MS) return true;
    window.sessionStorage.setItem(RETRY_KEY, String(Date.now()));
    return false;
  } catch {
    // Stockage indisponible : pas de garde-fou possible, on affiche l'erreur
    return true;
  }
}

function forgetLoginRetry(): void {
  try {
    window.sessionStorage.removeItem(RETRY_KEY);
  } catch {
    // Stockage indisponible : rien à oublier
  }
}

function takeLoginError(): string | undefined {
  const lost = takeParam('reprise') !== undefined;
  if (lost && lostLoginTwice()) return LOGIN_ERRORS.connexion;
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
  const [mfaJustEnabled] = useState(() => takeParam('info') === 'double-facteur');

  useEffect(() => {
    let active = true;
    fetchSession().then(
      (user) => {
        if (!active) return;
        if (user) forgetLoginRetry();
        setState(user ? { status: 'connected', user } : { status: 'anonymous' });
      },
      () => active && setState({ status: 'error' }),
    );
    return () => {
      active = false;
    };
  }, []);

  // Sans session : la page de connexion unique (Keycloak, US-019) s'ouvre directement, y compris
  // après une déconnexion. Seule une connexion qui vient d'échouer affiche son message.
  const directLogin = state.status === 'anonymous' && !loginError;
  useEffect(() => {
    if (directLogin) browser.assign('/auth/login');
  }, [directLogin]);

  async function onLogout() {
    try {
      await logout();
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
          // Bas de la colonne de navigation : icône seule, nom accessible « Se déconnecter »
          <Button variant="secondary" icon="logout" onClick={onLogout} title="Se déconnecter">
            <span className="ui-visually-hidden">Se déconnecter</span>
          </Button>
        }
      >
        <ConnectedPage user={user} mfaJustEnabled={mfaJustEnabled} />
      </AppShell>
    );
  }

  if (state.status === 'anonymous' && loginError) return <LoginErrorPage error={loginError} />;

  // Lecture de la session : l'ossature de la page, identique à celle du HTML pré-généré
  if (state.status === 'loading') return <LoadingShell path={path()} />;

  return (
    <PublicLayout>
      {directLogin && <p>Chargement…</p>}
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
function PublicLayout({ children }: { children: ReactNode }) {
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
      <main id="contenu" className="ui-main" tabIndex={-1}>
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
      items: [
        // US-040c : dossier d'un praticien sans smartphone, créé sur le terrain
        { href: '/dossiers-terrain', label: 'Dossiers terrain', icon: 'folder' },
        { href: '/verification-terrain', label: 'Vérification terrain', icon: 'map-pin' },
      ],
    });
  }
  if (isRegional(user)) {
    groups.push({
      heading: 'Certification',
      items: [
        { href: '/consolidation', label: 'Consolidation régionale', icon: 'layers' },
        // US-061
        { href: '/traitements', label: 'Traitements à transmettre', icon: 'flask' },
      ],
    });
  }
  if (isCommittee(user)) {
    groups.push({
      heading: 'Certification',
      items: [
        { href: '/expertise', label: 'Expertise des dossiers', icon: 'clipboard-check' },
        { href: '/traitements', label: 'Traitements à expertiser', icon: 'flask' },
      ],
    });
  }
  // Dictionnaire (US-050) : fiches plantes, tenues par la DG et le Comité scientifique ; noms
  // locaux (US-053) et voix des noms (US-071) pour tout administrateur, chaque geste selon ses
  // droits dans la langue
  const dictionary: NavGroup = {
    heading: 'Dictionnaire',
    items: [
      { href: '/noms-locaux', label: 'Noms locaux', icon: 'languages' },
      // US-071 : voix du nom des plantes et des maladies, par langue
      { href: '/voix-des-noms', label: 'Voix des noms', icon: 'mic' },
    ],
  };
  if (isDirector(user) || isCommittee(user)) {
    dictionary.items.unshift(
      { href: '/plantes', label: 'Fiches plantes', icon: 'leaf' },
      // US-052
      { href: '/maladies', label: 'Fiches maladies', icon: 'heart-pulse' },
    );
  }
  if (user.administrator) groups.push(dictionary);
  if (isDirector(user)) {
    // Pilotage de la DG : entonnoir des 6 étapes (US-048)
    groups[0]!.items.push({
      href: '/entonnoir',
      label: 'Entonnoir de certification',
      icon: 'funnel',
    });
    groups.push({
      heading: 'Certification',
      items: [
        { href: '/approbation', label: 'Approbation des dossiers', icon: 'badge-check' },
        { href: '/traitements', label: 'Traitements à certifier', icon: 'flask' },
        { href: '/rejet-definitif', label: 'Rejet définitif', icon: 'ban' },
      ],
    });
    groups.push({
      heading: 'Administration',
      items: [
        { href: '/comptes', label: 'Comptes', icon: 'users' },
        { href: '/referentiels', label: 'Référentiels', icon: 'database' },
      ],
    });
  }
  return groups;
}

// Pages de chaque profil ; tout autre profil, ou toute autre adresse, mène à l'accueil
const DIRECTOR_PAGES: Record<string, ComponentType> = {
  '/noms-locaux': LocalNamesPage,
  '/voix-des-noms': NameVoicesPage,
  '/entonnoir': FunnelPage,
  '/approbation': ApprovalPage,
  '/traitements': TreatmentsPage,
  '/rejet-definitif': RejectionPage,
  '/plantes': PlantsPage,
  '/maladies': DiseasesPage,
  '/comptes': AccountsPage,
  '/referentiels': ReferentialsPage,
};
const PREFECTORAL_PAGES: Record<string, ComponentType> = {
  '/noms-locaux': LocalNamesPage,
  '/voix-des-noms': NameVoicesPage,
  '/verification-terrain': FieldVerificationPage,
  '/dossiers-terrain': FieldDossierPage,
};
const REGIONAL_PAGES: Record<string, ComponentType> = {
  '/noms-locaux': LocalNamesPage,
  '/voix-des-noms': NameVoicesPage,
  '/consolidation': ConsolidationPage,
  '/traitements': TreatmentsPage,
};
const COMMITTEE_PAGES: Record<string, ComponentType> = {
  '/noms-locaux': LocalNamesPage,
  '/voix-des-noms': NameVoicesPage,
  '/expertise': ExpertisePage,
  '/traitements': TreatmentsPage,
  '/plantes': PlantsPage,
  '/maladies': DiseasesPage,
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
  const plant = isDirector(user) || isCommittee(user) ? PLANT_PATH.exec(path()) : null;
  if (plant) {
    return (
      <Suspense fallback={<p>Chargement…</p>}>
        <PlantPage code={plant[1]!} canValidate={isCommittee(user)} />
      </Suspense>
    );
  }
  const disease = isDirector(user) || isCommittee(user) ? DISEASE_PATH.exec(path()) : null;
  if (disease) {
    return (
      <Suspense fallback={<p>Chargement…</p>}>
        <DiseasePage code={disease[1]!} />
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
  // En attendant le morceau de la page : son en-tête, déjà affiché par l'ossature (US-017b)
  return (
    <Suspense fallback={<PageFallback path={path()} />}>
      {Page ? <Page /> : <Dashboard user={user} mfaJustEnabled={mfaJustEnabled} />}
    </Suspense>
  );
}

// Connexion impossible (refonte de l'authentification) : seul écran de l'application avant
// Keycloak, quand une connexion vient d'échouer ; sinon Keycloak s'ouvre directement. Le message
// et un bouton pour réessayer, sans répéter les garanties (affichées par Keycloak).
function LoginErrorPage({ error }: { error: string }) {
  return (
    <PublicLayout>
      <PageHeader title="Connexion impossible" />
      <Alert tone="error">{error}</Alert>
      <div className="ui-form__actions">
        <ButtonLink variant="primary" href="/auth/login">
          Réessayer la connexion
        </ButtonLink>
      </div>
    </PublicLayout>
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
