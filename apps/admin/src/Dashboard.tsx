import { useEffect, useState } from 'react';
import type { DashboardDecision, DashboardEvent, DashboardSummary, SmsFailure } from '@sabou/types';
import { Alert, Badge, ButtonLink, Card, DataTable, PageHeader, type Column } from '@sabou/ui';
import { ApiError, call } from './accounts-api';
import { ExportButtons } from './ExportButtons';
import { ProfileIndicators, type IndicatorProfile } from './ProfileIndicators';
import {
  isCommittee,
  isDirector,
  isPrefectoral,
  isRegional,
  profileLabel,
  type SessionUser,
} from './session';

// Tableau de bord d'accueil (US-016, US-090) : indicateurs du profil dans sa zone (CdC §6.2 à
// §6.5), activité récente ; SMS non remis pour la DG

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

// Profil dont les indicateurs sont attendus, connu dès la session : la grille s'affiche avant
// l'arrivée des chiffres (rien ne se décale, CLS)
function indicatorProfile(user: SessionUser): IndicatorProfile | null {
  if (isDirector(user)) return 'dg';
  if (isRegional(user)) return 'regional';
  if (isPrefectoral(user)) return 'prefectoral';
  if (isCommittee(user)) return 'scientifique';
  return null;
}

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
  const profile = indicatorProfile(user);
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
          {/* US-091 : export des chiffres affichés, gardé dans l'historique des exports */}
          {profile && (
            <ExportButtons
              subject="le tableau de bord"
              request={(format) => ({ type: 'tableau_de_bord', format })}
            />
          )}
          {load.status === 'error' ? (
            <Alert tone="error">{load.message}</Alert>
          ) : (
            profile && (
              <ProfileIndicators
                profile={profile}
                data={data?.indicateurs ?? null}
                // Tuile présente dès le départ pour la DG : rien ne se décale (CLS)
                extra={
                  isDirector(user)
                    ? [
                        {
                          label: 'SMS non remis',
                          value: data?.smsNonRemis?.total,
                          detail: 'Après 4 essais d’envoi',
                        },
                      ]
                    : []
                }
              />
            )
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
