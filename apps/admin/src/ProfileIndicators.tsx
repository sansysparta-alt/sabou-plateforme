import type {
  AdminIndicators,
  DirectorIndicators,
  PrefectoralIndicators,
  RegionalIndicators,
  ScientificIndicators,
} from '@sabou/types';
import { StatCard } from '@sabou/ui';

// Tuiles de chiffres clés du tableau de bord de chaque profil (US-090, CdC §6.2 à §6.5). Les
// chiffres sont ceux de la zone du compte (fonction SQL tableau_de_bord(), règles RLS). Les
// indicateurs dont la donnée n'existe pas encore (revenus, vues, écoutes) ne sont pas affichés
// (05 §2.90). Graphiques et listes : ProfileDetails.tsx, morceau chargé à part.

export type IndicatorProfile = AdminIndicators['profil'];

// Valeur affichée pendant le chargement (lue « points de suspension »)
const PENDING = '…';

const percentFormat = new Intl.NumberFormat('fr-FR', {
  style: 'percent',
  maximumFractionDigits: 0,
});
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
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Admin régional (§6.3)
// ---------------------------------------------------------------------------------------------
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
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Admin préfectoral (§6.4)
// ---------------------------------------------------------------------------------------------
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
    </>
  );
}

// ---------------------------------------------------------------------------------------------
// Comité scientifique (§6.5)
// ---------------------------------------------------------------------------------------------
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
    </>
  );
}

// Tuiles du profil ; avant l'arrivée des chiffres, la grille du profil attendu s'affiche
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
