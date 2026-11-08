import { useEffect, useState } from 'react';
import type { DashboardDecision, DashboardEvent, DashboardSummary } from '@sabou/types';
import {
  Alert,
  Badge,
  ButtonLink,
  Card,
  DataTable,
  PageHeader,
  StatCard,
  type Column,
} from '@sabou/ui';
import { ApiError, call } from './accounts-api';
import { isDirector, profileLabel, type SessionUser } from './session';

// Tableau de bord d'accueil (US-016) : chiffres de la zone, activité récente, fonctions à venir

export const fetchDashboard = () => call<DashboardSummary>('/api/tableau-de-bord');

const DECISIONS: Record<DashboardDecision, string> = {
  soumis: 'Dossier soumis',
  valide: 'Étape validée',
  rejete: 'Renvoyé à l’étape précédente',
  rejet_definitif: 'Rejet définitif',
  publie: 'Praticien publié',
};

// Heure de Conakry (UTC), quel que soit le fuseau du poste
const dateFormat = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Conakry',
});

const ACTIVITY_COLUMNS: Column<DashboardEvent>[] = [
  { key: 'le', header: 'Date', render: (e) => dateFormat.format(new Date(e.le)) },
  { key: 'dossier', header: 'Dossier', render: (e) => e.dossier },
  { key: 'praticien', header: 'Praticien', render: (e) => e.praticienNom },
  { key: 'decision', header: 'Événement', render: (e) => DECISIONS[e.decision] },
  { key: 'etape', header: 'Étape', render: (e) => `${e.etape} sur 6`, numeric: true },
];

// Fonctions annoncées, d'après le plan des sprints (07_Backlog_Sprints.md)
const UPCOMING: [label: string, sprint: string][] = [
  ['Circuit de certification : validation terrain, consolidation, expertise', 'Sprint 2'],
  ['Approbation par la DG et certificat signé', 'Sprint 3'],
  ['Dictionnaire Impérial des plantes', 'Sprint 4'],
  ['Traitements et leur circuit de validation', 'Sprint 5'],
  ['Tableaux de bord et rapports par profil', 'Sprint 9'],
];

// Refus de l'API (compte sans zone active en base) : message en clair, jamais celui de l'API
function errorMessage(error: Error): string {
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
    return 'Les chiffres de votre zone ne peuvent pas être affichés : votre compte n’est rattaché à aucune zone active. Contactez la Direction Générale.';
  }
  return error.message;
}

type Load =
  | { status: 'loading' }
  | { status: 'ready'; data: DashboardSummary }
  | { status: 'error'; message: string };

export function Dashboard({
  user,
  mfaJustEnabled,
}: {
  user: SessionUser;
  mfaJustEnabled: boolean;
}) {
  // Les chiffres sont réservés aux administrateurs connectés avec leur second facteur
  const canRead = user.administrator && user.secondFactor;
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  useEffect(() => {
    if (!canRead) return;
    let active = true;
    fetchDashboard().then(
      (data) => active && setLoad({ status: 'ready', data }),
      (error: Error) => active && setLoad({ status: 'error', message: errorMessage(error) }),
    );
    return () => {
      active = false;
    };
  }, [canRead]);

  const data = load.status === 'ready' ? load.data : null;
  const zone = data ? ` · ${data.zone}` : '';

  return (
    <>
      <PageHeader title={`Bonjour, ${user.name}`} lead={`${profileLabel(user)}${zone}`} />
      {user.secondFactor && (
        <p className="ui-muted">
          <Badge tone="success">Double facteur actif</Badge> Votre connexion est protégée par un
          code à usage unique.
        </p>
      )}
      {mfaJustEnabled && (
        <Alert tone="success" title="Double facteur activé">
          Le code de votre application vous sera demandé à chaque connexion.
        </Alert>
      )}
      {!user.secondFactor && !mfaJustEnabled && (
        <Card
          title="Protégez votre compte"
          actions={
            <ButtonLink variant="primary" href="/auth/login?action=configure-totp" icon="shield">
              Activer le double facteur
            </ButtonLink>
          }
        >
          <p>
            Le double facteur demande, en plus du mot de passe, un code affiché par une application
            de votre téléphone. Il est facultatif pour votre profil, mais recommandé.
          </p>
        </Card>
      )}
      {canRead && (
        <section className="ui-section" aria-labelledby="chiffres" aria-busy={!data}>
          <h2 id="chiffres">Chiffres de votre zone</h2>
          {load.status === 'error' && <Alert tone="error">{load.message}</Alert>}
          {load.status === 'loading' && <p className="ui-muted">Chargement…</p>}
          {data && (
            <div className="ui-grid">
              <StatCard label="Praticiens" value={data.praticiens} detail="Inscrits dans la zone" />
              <StatCard
                label="Dossiers soumis"
                value={data.dossiersSoumis}
                detail="En cours de certification"
              />
              <StatCard
                label="Comptes"
                value={data.comptes}
                detail="Administrateurs actifs de la zone"
              />
              <StatCard
                label="Spécialités"
                value={data.specialites}
                detail="Référentiel de la DG"
              />
              <StatCard label="Certificats émis" value={null} upcoming="Sprint 3" />
            </div>
          )}
        </section>
      )}
      {data && (
        <section className="ui-section" aria-labelledby="activite">
          <h2 id="activite">Activité récente</h2>
          <DataTable
            caption="Dernières étapes des dossiers de la zone"
            captionHidden
            columns={ACTIVITY_COLUMNS}
            rows={data.activite}
            rowKey={(e) => `${e.dossier}-${e.le}-${e.decision}`}
            empty="Aucun dossier n’a encore changé d’étape dans votre zone."
          />
        </section>
      )}
      {isDirector(user) && (
        <Card
          title="Gestion"
          actions={
            <>
              <ButtonLink variant="secondary" href="/comptes" icon="users">
                Gérer les comptes
              </ButtonLink>
              <ButtonLink variant="secondary" href="/referentiels" icon="book">
                Gérer les référentiels
              </ButtonLink>
            </>
          }
        >
          <p>Invitez les administrateurs et tenez à jour les listes de référence.</p>
        </Card>
      )}
      <Card title="À venir">
        <ul className="ui-list">
          {UPCOMING.map(([label, sprint]) => (
            <li key={label}>
              {label} <span className="ui-muted">({sprint})</span>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}
