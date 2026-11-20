import type { ReactNode } from 'react';
import type {
  AdminIndicators,
  DashboardAlert,
  DirectorIndicators,
  PrefectoralIndicators,
  RegionalIndicators,
  ScientificIndicators,
} from '@sabou/types';
import {
  Badge,
  BarList,
  ButtonLink,
  Card,
  DataTable,
  StatCard,
  StatusRing,
  type Column,
} from '@sabou/ui';
import { ALERT_STATUS, ALERT_TYPE } from './alert-labels';

// Indicateurs du tableau de bord de chaque profil (US-090, CdC §6.2 à §6.5). Les chiffres sont
// ceux de la zone du compte (fonction SQL tableau_de_bord(), règles RLS). Les indicateurs dont
// la donnée n'existe pas encore (revenus, vues, écoutes) ne sont pas affichés (05 §2.90).

export type IndicatorProfile = AdminIndicators['profil'];

// Valeur affichée pendant le chargement (lue « points de suspension »)
const PENDING = '…';

const percentFormat = new Intl.NumberFormat('fr-FR', {
  style: 'percent',
  maximumFractionDigits: 0,
});
// Heure de Conakry (UTC), quel que soit le fuseau du poste
const dateFormat = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeZone: 'Africa/Conakry',
});
const date = (iso: string | null) => (iso ? dateFormat.format(new Date(iso)) : 'Date inconnue');

// Tuiles de chiffres clés : la grille est la même avant et après le chargement (CLS)
export interface Tile {
  label: string;
  value: number | string | undefined;
  detail: string;
}

function Tiles({ tiles }: { tiles: Tile[] }) {
  return (
    <div className="ui-grid ui-grid--stats">
      {tiles.map((t) => (
        <StatCard key={t.label} label={t.label} value={t.value ?? PENDING} detail={t.detail} />
      ))}
    </div>
  );
}

// Lien vers l'écran de travail correspondant, sous un tableau du tableau de bord
function More({ href, children }: { href: string; children: ReactNode }) {
  return (
    <ButtonLink variant="secondary" href={href}>
      {children}
    </ButtonLink>
  );
}

// ---------------------------------------------------------------------------------------------
// Direction Générale (§6.2)
// ---------------------------------------------------------------------------------------------
function Director({ data, extra }: { data: DirectorIndicators | null; extra: Tile[] }) {
  return (
    <>
      <Tiles
        tiles={[
          { label: 'Certifiés', value: data?.certifies, detail: 'Praticiens certifiés' },
          { label: 'Traitements', value: data?.traitements, detail: 'Traitements certifiés' },
          { label: 'Plantes', value: data?.plantes, detail: 'Validées par le Comité' },
          { label: 'Certificats', value: data?.certificats, detail: 'Actifs, non expirés' },
          ...extra,
        ]}
      />
      {data && (
        <div className="ui-grid ui-grid--wide">
          <Card headingLevel={3} title="Certifiés par région">
            <BarList
              caption="Praticiens certifiés par région"
              labelHeader="Région"
              valueHeader="Praticiens certifiés"
              rows={data.parRegion.map((r) => ({ label: r.region, value: r.certifies }))}
              empty="Aucune région active."
            />
          </Card>
          <Card headingLevel={3} title="Statut du registre">
            <StatusRing
              noun="praticiens"
              segments={[
                { label: 'Certifiés', value: data.registre.certifies, tone: 'success' },
                { label: 'En attente', value: data.registre.enAttente, tone: 'pending' },
                { label: 'Suspendus', value: data.registre.suspendus, tone: 'neutral' },
                { label: 'Rejetés', value: data.registre.rejetes, tone: 'error' },
              ]}
            />
          </Card>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Admin régional (§6.3)
// ---------------------------------------------------------------------------------------------
const PREFECTURE_COLUMNS: Column<RegionalIndicators['parPrefecture'][number]>[] = [
  { key: 'prefecture', header: 'Préfecture', render: (p) => p.prefecture },
  {
    key: 'aValider',
    header: 'À vérifier sur le terrain',
    render: (p) => p.aValider,
    numeric: true,
  },
  { key: 'aConsolider', header: 'À consolider', render: (p) => p.aConsolider, numeric: true },
  { key: 'consolides', header: 'Consolidés (12 mois)', render: (p) => p.consolides, numeric: true },
];

const ALERT_COLUMNS: Column<DashboardAlert>[] = [
  { key: 'le', header: 'Date', render: (a) => date(a.le) },
  { key: 'type', header: 'Alerte', render: (a) => ALERT_TYPE[a.type] },
  { key: 'prefecture', header: 'Préfecture', render: (a) => a.prefecture ?? 'Toute la région' },
  { key: 'description', header: 'Détail', render: (a) => a.description },
  {
    key: 'statut',
    header: 'État',
    render: (a) => <Badge tone={ALERT_STATUS[a.statut].tone}>{ALERT_STATUS[a.statut].label}</Badge>,
  },
];

function coverage(data: RegionalIndicators | null): Pick<Tile, 'value' | 'detail'> {
  if (!data) return { value: undefined, detail: 'Préfectures avec un praticien certifié' };
  const { prefectures, couvertes } = data.couverture;
  return {
    value: percentFormat.format(prefectures === 0 ? 0 : couvertes / prefectures),
    detail: `${couvertes} préfecture${couvertes > 1 ? 's' : ''} sur ${prefectures} avec un praticien certifié`,
  };
}

function Regional({ data }: { data: RegionalIndicators | null }) {
  return (
    <>
      <Tiles
        tiles={[
          { label: 'Praticiens', value: data?.praticiens, detail: 'Inscrits dans la région' },
          { label: 'Consolidés', value: data?.consolides, detail: 'Dossiers, 12 derniers mois' },
          { label: 'Litiges', value: data?.litiges, detail: 'Non résolus' },
          { label: 'Couverture', ...coverage(data) },
          { label: 'À consolider', value: data?.aConsolider, detail: 'Dossiers à l’étape 3' },
        ]}
      />
      {data && (
        <>
          <Card headingLevel={3} title="Dossiers par préfecture">
            <DataTable
              caption="Dossiers par préfecture"
              captionHidden
              columns={PREFECTURE_COLUMNS}
              rows={data.parPrefecture}
              rowKey={(p) => p.prefecture}
              paginate={{ key: 'accueil-prefectures', noun: ['préfecture', 'préfectures'] }}
              empty="Aucune préfecture active dans la région."
            />
          </Card>
          <Card
            headingLevel={3}
            title={`Alertes territoriales (${data.alertes.total})`}
            actions={<More href="/alertes">Toutes les alertes</More>}
          >
            <DataTable
              caption="Alertes territoriales ouvertes les plus récentes"
              captionHidden
              columns={ALERT_COLUMNS}
              rows={data.alertes.dernieres}
              rowKey={(a) => a.id}
              empty="Aucune alerte ouverte dans la région."
            />
          </Card>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Admin préfectoral (§6.4)
// ---------------------------------------------------------------------------------------------
const TO_VALIDATE_COLUMNS: Column<PrefectoralIndicators['aValider']['dossiers'][number]>[] = [
  { key: 'dossier', header: 'Dossier', render: (d) => d.dossier },
  { key: 'praticien', header: 'Praticien', render: (d) => d.praticien },
  { key: 'depuis', header: 'À l’étape 2 depuis le', render: (d) => date(d.depuis) },
];

function Prefectoral({ data }: { data: PrefectoralIndicators | null }) {
  return (
    <>
      <Tiles
        tiles={[
          { label: 'Enregistrés', value: data?.enregistres, detail: 'Praticiens de la préfecture' },
          { label: 'Certifiés', value: data?.certifies, detail: 'Praticiens certifiés' },
          { label: 'En attente', value: data?.enAttente, detail: 'Pas encore certifiés' },
          {
            label: 'Recettes numérisées',
            value: data?.recettesNumerisees,
            detail: 'Saisies par un agent de terrain',
          },
        ]}
      />
      {data && (
        <div className="ui-grid ui-grid--wide">
          <Card headingLevel={3} title="Répartition par spécialité">
            <BarList
              caption="Praticiens par spécialité"
              labelHeader="Spécialité"
              valueHeader="Praticiens"
              rows={data.parSpecialite.map((s) => ({ label: s.specialite, value: s.praticiens }))}
              empty="Aucun praticien enregistré dans la préfecture."
            />
          </Card>
          <Card
            headingLevel={3}
            title={`Dossiers à valider (${data.aValider.total})`}
            actions={<More href="/verification-terrain">Tous les dossiers à valider</More>}
          >
            <DataTable
              caption="Dossiers à valider, les plus anciens d’abord"
              captionHidden
              columns={TO_VALIDATE_COLUMNS}
              rows={data.aValider.dossiers}
              rowKey={(d) => d.dossier}
              empty="Aucun dossier n’attend la vérification terrain."
            />
          </Card>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Comité scientifique (§6.5)
// ---------------------------------------------------------------------------------------------
const QUEUE_COLUMNS: Column<ScientificIndicators['file']['traitements'][number]>[] = [
  { key: 'code', header: 'Traitement', render: (t) => t.code },
  { key: 'titre', header: 'Intitulé', render: (t) => t.titre },
  { key: 'maladie', header: 'Maladie', render: (t) => t.maladie },
  { key: 'depuis', header: 'Transmis le', render: (t) => date(t.depuis) },
];

function Scientific({ data }: { data: ScientificIndicators | null }) {
  return (
    <>
      <Tiles
        tiles={[
          { label: 'Expertisés', value: data?.expertises, detail: 'Traitements, 12 derniers mois' },
          { label: 'En attente', value: data?.enAttente, detail: 'Traitements à expertiser' },
          {
            label: 'Plantes',
            value: data?.plantes,
            detail: data ? `Validées ; ${data.plantesEnRevue} en revue` : 'Validées',
          },
          {
            label: 'Alertes',
            value: data?.alertes,
            detail: data
              ? `Signalements ouverts, dont ${data.alertesGraves} graves`
              : 'Signalements ouverts',
          },
        ]}
      />
      {data && (
        <div className="ui-grid ui-grid--wide">
          <Card headingLevel={3} title="Pathologies les plus traitées">
            <BarList
              caption="Maladies qui ont le plus de traitements certifiés"
              labelHeader="Maladie"
              valueHeader="Traitements certifiés"
              rows={data.topPathologies.map((p) => ({ label: p.maladie, value: p.traitements }))}
              empty="Aucun traitement certifié pour l’instant."
            />
          </Card>
          <Card
            headingLevel={3}
            title={`File d’expertise (${data.file.total})`}
            actions={<More href="/traitements">Toute la file d’expertise</More>}
          >
            <DataTable
              caption="Traitements à expertiser, les plus anciens d’abord"
              captionHidden
              columns={QUEUE_COLUMNS}
              rows={data.file.traitements}
              rowKey={(t) => t.code}
              empty="Aucun traitement n’attend l’expertise."
            />
          </Card>
        </div>
      )}
    </>
  );
}

// Indicateurs du profil ; avant l'arrivée des chiffres, la grille du profil attendu s'affiche
// avec des valeurs « … ». Un profil inattendu (réponse d'un autre rôle) n'affiche rien.
// extra : tuiles propres à la DG hors indicateurs du profil (SMS non remis, US-031)
export function ProfileIndicators({
  profile,
  data,
  extra = [],
}: {
  profile: IndicatorProfile;
  data: AdminIndicators | null;
  extra?: Tile[];
}) {
  const own = data && data.profil === profile ? data : null;
  if (data && !own) return null;
  switch (profile) {
    case 'dg':
      return <Director data={own as DirectorIndicators | null} extra={extra} />;
    case 'regional':
      return <Regional data={own as RegionalIndicators | null} />;
    case 'prefectoral':
      return <Prefectoral data={own as PrefectoralIndicators | null} />;
    case 'scientifique':
      return <Scientific data={own as ScientificIndicators | null} />;
  }
}
