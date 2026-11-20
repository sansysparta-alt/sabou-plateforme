import type {
  AdminIndicators,
  PrefectoralReportContent,
  RegionalReportContent,
  ReportDelays,
} from '@sabou/types';

// Modèle neutre d'un document exporté (US-091) : le PDF et le XLSX sont produits à partir du
// même modèle, donc toujours concordants. Les données viennent de la photographie gardée en
// base (rapport_export.contenu) : un export se régénère à l'identique.

export type Cell = string | number | null;

export type Section =
  | { kind: 'figures'; heading: string; rows: [label: string, value: Cell][] }
  | { kind: 'table'; heading: string; columns: string[]; rows: Cell[][]; empty: string }
  | { kind: 'text'; heading: string; text: string };

export interface ReportDocument {
  title: string;
  subtitle: string;
  // Lignes d'en-tête : zone, période, auteur, état…
  meta: [label: string, value: string][];
  sections: Section[];
  // Horodatage de la photographie (ISO 8601, UTC) : date du document, à l'identique à chaque
  // régénération
  generatedAt: string;
}

// Mention portée par chaque document (CdC : la plateforme informe, elle ne prescrit pas)
export const DOCUMENT_NOTICE = 'SABOU informe, il ne prescrit pas.';

const dateTime = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'long',
  timeStyle: 'short',
  timeZone: 'Africa/Conakry',
});
const day = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long', timeZone: 'Africa/Conakry' });
const monthFormat = new Intl.DateTimeFormat('fr-FR', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatDay = (iso: string) => day.format(new Date(iso));
// « 2026-10-01 » → « octobre 2026 »
export const formatMonth = (isoDay: string) => monthFormat.format(new Date(`${isoDay}T12:00:00Z`));

const percent = (part: number, total: number) =>
  total === 0 ? '0 %' : `${Math.round((part / total) * 100)} %`;

// ---------------------------------------------------------------------------------------------
// Tableau de bord (US-090) : mêmes indicateurs et mêmes libellés que l'écran
// ---------------------------------------------------------------------------------------------
const PROFILES: Record<AdminIndicators['profil'], string> = {
  dg: 'Direction Générale',
  regional: 'Administration régionale',
  prefectoral: 'Administration préfectorale',
  scientifique: 'Comité scientifique',
};

function dashboardSections(i: AdminIndicators): Section[] {
  switch (i.profil) {
    case 'dg':
      return [
        {
          kind: 'figures',
          heading: 'Chiffres clés',
          rows: [
            ['Praticiens certifiés', i.certifies],
            ['Traitements certifiés', i.traitements],
            ['Plantes validées par le Comité', i.plantes],
            ['Certificats actifs, non expirés', i.certificats],
          ],
        },
        {
          kind: 'table',
          heading: 'Certifiés par région',
          columns: ['Région', 'Praticiens certifiés'],
          rows: i.parRegion.map((r) => [r.region, r.certifies]),
          empty: 'Aucune région active.',
        },
        {
          kind: 'table',
          heading: 'Statut du registre',
          columns: ['Statut', 'Praticiens'],
          rows: [
            ['Certifiés', i.registre.certifies],
            ['En attente', i.registre.enAttente],
            ['Suspendus', i.registre.suspendus],
            ['Rejetés', i.registre.rejetes],
          ],
          empty: '',
        },
      ];
    case 'regional':
      return [
        {
          kind: 'figures',
          heading: 'Chiffres clés',
          rows: [
            ['Praticiens inscrits dans la région', i.praticiens],
            ['Dossiers consolidés, 12 derniers mois', i.consolides],
            ['Litiges non résolus', i.litiges],
            [
              'Couverture (préfectures avec un praticien certifié)',
              `${percent(i.couverture.couvertes, i.couverture.prefectures)} (${i.couverture.couvertes} sur ${i.couverture.prefectures})`,
            ],
            ['Dossiers à consolider', i.aConsolider],
          ],
        },
        {
          kind: 'table',
          heading: 'Dossiers par préfecture',
          columns: [
            'Préfecture',
            'À vérifier sur le terrain',
            'À consolider',
            'Consolidés (12 mois)',
          ],
          rows: i.parPrefecture.map((p) => [p.prefecture, p.aValider, p.aConsolider, p.consolides]),
          empty: 'Aucune préfecture active dans la région.',
        },
        {
          kind: 'table',
          heading: `Alertes territoriales ouvertes (${i.alertes.total}, les plus récentes)`,
          columns: ['Date', 'Préfecture', 'Détail', 'État'],
          rows: i.alertes.dernieres.map((a) => [
            formatDay(a.le),
            a.prefecture ?? 'Toute la région',
            a.description,
            { nouvelle: 'Nouvelle', accusee: 'Reçue', relancee: 'Relancée' }[a.statut],
          ]),
          empty: 'Aucune alerte ouverte dans la région.',
        },
      ];
    case 'prefectoral':
      return [
        {
          kind: 'figures',
          heading: 'Chiffres clés',
          rows: [
            ['Praticiens enregistrés', i.enregistres],
            ['Praticiens certifiés', i.certifies],
            ['En attente de certification', i.enAttente],
            ['Recettes numérisées par un agent', i.recettesNumerisees],
          ],
        },
        {
          kind: 'table',
          heading: 'Répartition par spécialité',
          columns: ['Spécialité', 'Praticiens'],
          rows: i.parSpecialite.map((s) => [s.specialite, s.praticiens]),
          empty: 'Aucun praticien enregistré.',
        },
        {
          kind: 'table',
          heading: `Dossiers à valider (${i.aValider.total}, les plus anciens)`,
          columns: ['Dossier', 'Praticien', 'À l’étape 2 depuis le'],
          rows: i.aValider.dossiers.map((d) => [d.dossier, d.praticien, formatDay(d.depuis)]),
          empty: 'Aucun dossier n’attend la vérification terrain.',
        },
      ];
    case 'scientifique':
      return [
        {
          kind: 'figures',
          heading: 'Chiffres clés',
          rows: [
            ['Traitements expertisés, 12 derniers mois', i.expertises],
            ['Traitements à expertiser', i.enAttente],
            ['Plantes validées', i.plantes],
            ['Plantes en revue', i.plantesEnRevue],
            ['Signalements ouverts', i.alertes],
            ['dont graves', i.alertesGraves],
          ],
        },
        {
          kind: 'table',
          heading: 'Pathologies les plus traitées',
          columns: ['Maladie', 'Traitements certifiés'],
          rows: i.topPathologies.map((p) => [p.maladie, p.traitements]),
          empty: 'Aucun traitement certifié.',
        },
        {
          kind: 'table',
          heading: `File d’expertise (${i.file.total}, les plus anciens)`,
          columns: ['Traitement', 'Intitulé', 'Maladie', 'Transmis le'],
          rows: i.file.traitements.map((t) => [
            t.code,
            t.titre,
            t.maladie,
            t.depuis ? formatDay(t.depuis) : 'Date inconnue',
          ]),
          empty: 'Aucun traitement n’attend l’expertise.',
        },
      ];
  }
}

export interface DashboardSnapshot {
  zone: string;
  indicateurs: AdminIndicators;
}

export function dashboardDocument(
  snapshot: DashboardSnapshot,
  author: string,
  generatedAt: string,
): ReportDocument {
  return {
    title: `Tableau de bord · ${snapshot.zone}`,
    subtitle: PROFILES[snapshot.indicateurs.profil],
    meta: [
      ['Zone', snapshot.zone],
      ['Exporté par', author],
      ['Chiffres du', formatDateTime(generatedAt)],
    ],
    sections: dashboardSections(snapshot.indicateurs),
    generatedAt,
  };
}

// ---------------------------------------------------------------------------------------------
// Rapport mensuel (UC-36, R-MOD-09)
// ---------------------------------------------------------------------------------------------
export interface MonthlyReportSnapshot {
  niveau: 'prefectoral' | 'regional';
  mois: string;
  version: number;
  statut: 'brouillon' | 'envoye' | 'renvoye';
  zone: string;
  region: string;
  auteur: string;
  calculeLe: string;
  envoyeLe: string | null;
  renvoiMotif: string | null;
  contenu: PrefectoralReportContent | RegionalReportContent;
  commentaire: string | null;
}

const STATUS = { brouillon: 'Brouillon, non envoyé', envoye: 'Envoyé', renvoye: 'Renvoyé' };

function delays(heading: string, d: ReportDelays): Section {
  return {
    kind: 'figures',
    heading,
    rows: [
      ['Décisions prises', d.passages],
      ['dont validées', d.valides],
      ['dont renvoyées', d.renvoyes],
      ['Délai moyen (jours)', d.moyenneJours === null ? 'Aucune décision' : d.moyenneJours],
      [`Au-delà de l’objectif de ${d.objectifJours} jours`, d.horsDelai],
    ],
  };
}

function blocked(content: {
  anomalies: { dossiersBloques: { dossier: string; etape: number; depuis: string }[] };
}): Section {
  return {
    kind: 'table',
    heading: 'Dossiers sans décision depuis plus de 15 jours',
    columns: ['Dossier', 'Étape', 'Depuis le'],
    rows: content.anomalies.dossiersBloques.map((d) => [
      d.dossier,
      `${d.etape} sur 6`,
      formatDay(d.depuis),
    ]),
    empty: 'Aucun dossier bloqué.',
  };
}

function prefectoralSections(c: PrefectoralReportContent): Section[] {
  return [
    {
      kind: 'figures',
      heading: 'Activité du mois',
      rows: [
        ['Nouveaux praticiens', c.activite.nouveauxPraticiens],
        ['Dossiers soumis', c.activite.dossiersSoumis],
        ['Visites réalisées', c.activite.visitesRealisees],
        ['Recettes numérisées', c.activite.recettesNumerisees],
        ['Praticiens publiés', c.activite.praticiensPublies],
      ],
    },
    delays('Délais de la vérification sur le terrain (étape 2)', c.delais),
    {
      kind: 'figures',
      heading: 'Anomalies',
      rows: [
        ['Dossiers bloqués', c.anomalies.dossiersBloques.length],
        ['Alertes territoriales ouvertes en fin de mois', c.anomalies.alertesOuvertes],
      ],
    },
    blocked(c),
    {
      kind: 'figures',
      heading: 'Registre préfectoral',
      rows: [
        ['Praticiens enregistrés', c.registre.enregistres],
        ['Praticiens certifiés', c.registre.certifies],
        ['En attente de certification', c.registre.enAttente],
      ],
    },
  ];
}

const RECEIVED = { recu: 'Reçu', renvoye: 'Renvoyé', manquant: 'Manquant' };

function regionalSections(c: RegionalReportContent): Section[] {
  return [
    {
      kind: 'figures',
      heading: 'Activité du mois',
      rows: [
        ['Litiges ouverts', c.activite.litigesOuverts],
        ['Litiges résolus', c.activite.litigesResolus],
        ['Traitements transmis au Comité', c.activite.traitementsTransmis],
        [
          'Couverture (préfectures avec un praticien certifié)',
          `${percent(c.couverture.couvertes, c.couverture.prefectures)} (${c.couverture.couvertes} sur ${c.couverture.prefectures})`,
        ],
      ],
    },
    delays('Délais de la consolidation (étape 3)', c.delais),
    {
      kind: 'figures',
      heading: 'Anomalies',
      rows: [
        ['Dossiers bloqués', c.anomalies.dossiersBloques.length],
        ['Alertes territoriales ouvertes en fin de mois', c.anomalies.alertesOuvertes],
        ['Rapports préfectoraux manquants', c.anomalies.rapportsManquants],
      ],
    },
    blocked(c),
    {
      kind: 'table',
      heading: 'Rapports des préfectures',
      columns: [
        'Préfecture',
        'Rapport',
        'Dossiers soumis',
        'Visites réalisées',
        'Délai moyen étape 2 (jours)',
        'Commentaire',
      ],
      rows: c.prefectures.map((p) => [
        p.prefecture,
        p.version ? `${RECEIVED[p.rapport]} (version ${p.version})` : RECEIVED[p.rapport],
        p.activite?.dossiersSoumis ?? null,
        p.activite?.visitesRealisees ?? null,
        p.delais?.moyenneJours ?? null,
        p.commentaire,
      ]),
      empty: 'Aucune préfecture active dans la région.',
    },
  ];
}

export function monthlyReportDocument(
  snapshot: MonthlyReportSnapshot,
  generatedAt: string,
): ReportDocument {
  const level = snapshot.niveau === 'prefectoral' ? 'préfectoral' : 'régional';
  const meta: [string, string][] = [
    [snapshot.niveau === 'prefectoral' ? 'Préfecture' : 'Région', snapshot.zone],
    ['Mois', formatMonth(snapshot.mois)],
    ['Rédigé par', snapshot.auteur],
    ['Version', String(snapshot.version)],
    ['État', STATUS[snapshot.statut]],
    ['Chiffres calculés le', formatDateTime(snapshot.calculeLe)],
  ];
  if (snapshot.envoyeLe) meta.push(['Envoyé le', formatDateTime(snapshot.envoyeLe)]);
  if (snapshot.renvoiMotif) meta.push(['Motif du renvoi', snapshot.renvoiMotif]);
  const sections =
    snapshot.niveau === 'prefectoral'
      ? prefectoralSections(snapshot.contenu as PrefectoralReportContent)
      : regionalSections(snapshot.contenu as RegionalReportContent);
  sections.push({
    kind: 'text',
    heading: 'Commentaire',
    text: snapshot.commentaire ?? 'Aucun commentaire.',
  });
  return {
    title: `Rapport mensuel ${level} · ${snapshot.zone} · ${formatMonth(snapshot.mois)}`,
    subtitle:
      snapshot.niveau === 'prefectoral'
        ? `Envoyé à l’administration régionale de ${snapshot.region}`
        : 'Envoyé à la Direction Générale',
    meta,
    sections,
    generatedAt,
  };
}
