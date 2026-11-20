import type { ReactNode } from 'react';
import type {
  AdminIndicators,
  DashboardAlert,
  DirectorIndicators,
  PrefectoralIndicators,
  RegionalIndicators,
  ScientificIndicators,
} from '@sabou/types';
import { Badge, BarList, ButtonLink, Card, DataTable, StatusRing, type Column } from '@sabou/ui';
import { ALERT_STATUS, ALERT_TYPE } from './alert-labels';

// Graphiques et listes du tableau de bord de chaque profil (US-090, CdC §6.2 à §6.5). Morceau
// chargé à part, en parallèle des chiffres : il n'apparaît qu'avec eux, et l'accueil (tuiles,
// en-tête) s'affiche plus tôt en 3G (LCP).

// Heure de Conakry (UTC), quel que soit le poste
const dateFormat = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeZone: 'Africa/Conakry',
});
const date = (iso: string | null) => (iso ? dateFormat.format(new Date(iso)) : 'Date inconnue');

// Lien vers l'écran de travail correspondant, en tête d'une liste du tableau de bord
function More({ href, children }: { href: string; children: ReactNode }) {
  return (
    <ButtonLink variant="secondary" href={href}>
      {children}
    </ButtonLink>
  );
}

function Director({ data }: { data: DirectorIndicators }) {
  return (
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
  );
}

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

function Regional({ data }: { data: RegionalIndicators }) {
  return (
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
  );
}

const TO_VALIDATE_COLUMNS: Column<PrefectoralIndicators['aValider']['dossiers'][number]>[] = [
  { key: 'dossier', header: 'Dossier', render: (d) => d.dossier },
  { key: 'praticien', header: 'Praticien', render: (d) => d.praticien },
  { key: 'depuis', header: 'À l’étape 2 depuis le', render: (d) => date(d.depuis) },
];

function Prefectoral({ data }: { data: PrefectoralIndicators }) {
  return (
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
  );
}

const QUEUE_COLUMNS: Column<ScientificIndicators['file']['traitements'][number]>[] = [
  { key: 'code', header: 'Traitement', render: (t) => t.code },
  { key: 'titre', header: 'Intitulé', render: (t) => t.titre },
  { key: 'maladie', header: 'Maladie', render: (t) => t.maladie },
  { key: 'depuis', header: 'Transmis le', render: (t) => date(t.depuis) },
];

function Scientific({ data }: { data: ScientificIndicators }) {
  return (
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
  );
}

export function ProfileDetails({ data }: { data: AdminIndicators }) {
  switch (data.profil) {
    case 'dg':
      return <Director data={data} />;
    case 'regional':
      return <Regional data={data} />;
    case 'prefectoral':
      return <Prefectoral data={data} />;
    case 'scientifique':
      return <Scientific data={data} />;
  }
}
