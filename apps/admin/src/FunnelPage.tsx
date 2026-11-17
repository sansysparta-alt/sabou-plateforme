import { useEffect, useState } from 'react';
import { Alert, Badge, DataTable, PageHeader, type Column } from '@sabou/ui';
import type { BlockedDossier, CertificationFunnel, FunnelStep } from '@sabou/types';
import { ApiError } from './accounts-api';
import { fetchFunnel } from './certification-api';

// Entonnoir des 6 étapes et dossiers bloqués (US-048, UC-67, R-CER-07) : écran de la DG, en
// lecture seule. Deux tableaux plutôt qu'un graphique : lisibles au lecteur d'écran et sur
// un petit téléphone, sans bibliothèque de plus.

// Ce qui se passe à chaque étape (CdC §4)
const STEPS: Record<number, string> = {
  1: 'Dépôt du dossier',
  2: 'Vérification terrain',
  3: 'Consolidation régionale',
  4: 'Expertise du Comité',
  5: 'Approbation de la DG',
  6: 'Publication',
};

const decimal = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
const days = (n: number) => `${decimal.format(n)} j`;
const dateFormat = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeZone: 'UTC' });

type Load =
  | { status: 'loading' }
  | { status: 'ready'; data: CertificationFunnel }
  | { status: 'error'; message: string };

function errorMessage(error: Error): string {
  if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
    return 'L’entonnoir est réservé à la Direction Générale, connectée avec son double facteur.';
  }
  return 'L’entonnoir ne peut pas être affiché pour le moment. Réessayez dans un instant.';
}

function stepColumns(target: number): Column<FunnelStep>[] {
  return [
    {
      key: 'etape',
      header: 'Étape',
      render: (s) => `${s.etape}. ${STEPS[s.etape] ?? ''}`,
    },
    { key: 'enCours', header: 'En cours', numeric: true, render: (s) => s.enCours },
    {
      key: 'bloques',
      header: 'Bloqués',
      numeric: true,
      render: (s) => (s.bloques > 0 ? <Badge tone="error">{s.bloques}</Badge> : 0),
    },
    {
      key: 'delai',
      header: 'Délai moyen',
      numeric: true,
      render: (s) =>
        s.delaiMoyenJours === null ? (
          <span className="ui-muted">—</span>
        ) : s.delaiMoyenJours > target ? (
          <Badge tone="warning">{days(s.delaiMoyenJours)}</Badge>
        ) : (
          days(s.delaiMoyenJours)
        ),
    },
    { key: 'passages', header: 'Dossiers sortis', numeric: true, render: (s) => s.passages },
  ];
}

const blockedColumns: Column<BlockedDossier>[] = [
  { key: 'dossier', header: 'Dossier', render: (d) => d.dossier },
  { key: 'praticien', header: 'Praticien', render: (d) => `${d.nom} (${d.praticien})` },
  { key: 'etape', header: 'Étape', render: (d) => `${d.etape}. ${STEPS[d.etape] ?? ''}` },
  { key: 'zone', header: 'Zone', render: (d) => `${d.prefecture}, ${d.region}` },
  {
    key: 'jours',
    header: 'Sans décision depuis',
    numeric: true,
    render: (d) => (
      <>
        {days(d.jours)}{' '}
        <span className="ui-muted">(le {dateFormat.format(new Date(d.depuis))})</span>
      </>
    ),
  },
];

export function FunnelPage() {
  const [load, setLoad] = useState<Load>({ status: 'loading' });

  useEffect(() => {
    let active = true;
    fetchFunnel().then(
      (data) => active && setLoad({ status: 'ready', data }),
      (error: Error) => active && setLoad({ status: 'error', message: errorMessage(error) }),
    );
    return () => {
      active = false;
    };
  }, []);

  const data = load.status === 'ready' ? load.data : null;

  return (
    <>
      <PageHeader
        title="Entonnoir de certification"
        lead="Dossiers en cours à chaque étape, délais et dossiers bloqués, au niveau national."
      />
      {load.status === 'error' && <Alert tone="error">{load.message}</Alert>}
      <section className="ui-section" aria-labelledby="etapes" aria-busy={!data}>
        <h2 id="etapes">Les 6 étapes</h2>
        {data ? (
          <>
            <p className="ui-muted">
              Délai cible : {data.delaiCibleJours} jours par étape. Délai moyen calculé sur les
              dossiers sortis de l’étape au cours des 12 derniers mois.
            </p>
            <DataTable
              caption="Dossiers par étape et délai moyen"
              captionHidden
              columns={stepColumns(data.delaiCibleJours)}
              rows={data.etapes}
              rowKey={(s) => s.etape}
            />
          </>
        ) : (
          load.status === 'loading' && <p>Chargement…</p>
        )}
      </section>
      <section className="ui-section" aria-labelledby="bloques" aria-busy={!data}>
        <h2 id="bloques">Dossiers bloqués</h2>
        {data && (
          <>
            <p className="ui-muted">
              {data.bloques.total === 0
                ? `Aucun dossier sans décision depuis plus de ${data.seuilBlocageJours} jours.`
                : `${data.bloques.total} dossier${data.bloques.total > 1 ? 's' : ''} sans décision depuis plus de ${data.seuilBlocageJours} jours, du plus ancien au plus récent${data.bloques.total > data.bloques.dossiers.length ? ` ; les ${data.bloques.dossiers.length} plus anciens sont affichés` : ''}.`}
            </p>
            {data.bloques.total > 0 && (
              <DataTable
                caption="Dossiers bloqués"
                captionHidden
                columns={blockedColumns}
                rows={data.bloques.dossiers}
                rowKey={(d) => d.dossier}
              />
            )}
          </>
        )}
      </section>
    </>
  );
}
