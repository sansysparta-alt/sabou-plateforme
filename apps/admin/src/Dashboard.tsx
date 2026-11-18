import { useEffect, useState } from 'react';
import type { DashboardDecision, DashboardEvent, DashboardSummary, SmsFailure } from '@sabou/types';
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

// SMS non remis au praticien après tous les essais (US-031) : la DG peut le prévenir autrement
const SMS_FAILURE_COLUMNS: Column<SmsFailure>[] = [
  { key: 'le', header: 'Date', render: (f) => dateFormat.format(new Date(f.le)) },
  { key: 'objet', header: 'Dossier', render: (f) => f.objet },
  { key: 'destinataire', header: 'Praticien', render: (f) => f.destinataire },
  { key: 'raison', header: 'Raison', render: (f) => f.raison },
];

// Valeur affichée pendant le chargement des chiffres (lue « points de suspension »)
const PENDING = '…';

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
      <PageHeader
        title={`Bonjour, ${user.name}`}
        lead={`${profileLabel(user)}${zone}`}
        // Accès directs de la DG (maquette v1.3 : actions à droite du titre, US-019)
        actions={
          isDirector(user) ? (
            <div className="ui-form__actions">
              <ButtonLink variant="secondary" href="/comptes" icon="users">
                Gérer les comptes
              </ButtonLink>
              <ButtonLink variant="secondary" href="/referentiels" icon="database">
                Gérer les référentiels
              </ButtonLink>
            </div>
          ) : undefined
        }
      />
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
          {load.status === 'error' ? (
            <Alert tone="error">{load.message}</Alert>
          ) : (
            // Grille affichée dès le départ, valeurs « … » en attendant : rien ne se décale à
            // l'arrivée des chiffres (CLS mesuré par Lighthouse)
            <div className="ui-grid ui-grid--stats">
              <StatCard
                label="Praticiens"
                value={data?.praticiens ?? PENDING}
                detail="Inscrits dans la zone"
              />
              <StatCard
                label="Dossiers soumis"
                value={data?.dossiersSoumis ?? PENDING}
                detail="En cours de certification"
              />
              <StatCard
                label="Comptes"
                value={data?.comptes ?? PENDING}
                detail="Administrateurs actifs de la zone"
              />
              <StatCard
                label="Spécialités"
                value={data?.specialites ?? PENDING}
                detail="Référentiel de la DG"
              />
              {/* Carte présente dès le départ pour la DG : rien ne se décale (CLS) */}
              {isDirector(user) && (
                <StatCard
                  label="SMS non remis"
                  value={data?.smsNonRemis?.total ?? PENDING}
                  detail="Après 4 essais d’envoi"
                />
              )}
            </div>
          )}
        </section>
      )}
      {/* En dernier : sa hauteur dépend des données, elle ne pousse donc aucun autre bloc */}
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
      {isDirector(user) && data?.smsNonRemis && data.smsNonRemis.total > 0 && (
        <section className="ui-section" aria-labelledby="sms-non-remis">
          <h2 id="sms-non-remis">SMS non remis</h2>
          <p>
            Ces praticiens n’ont pas reçu le SMS de l’étape de leur dossier. Prévenez-les par un
            autre moyen et vérifiez leur numéro.
          </p>
          <DataTable
            caption="Derniers SMS non remis"
            captionHidden
            columns={SMS_FAILURE_COLUMNS}
            rows={data.smsNonRemis.derniers}
            rowKey={(f) => `${f.objet}-${f.le}`}
            paginate={{ key: 'sms-non-remis', noun: ['SMS', 'SMS'] }}
            empty=""
          />
        </section>
      )}
    </>
  );
}
