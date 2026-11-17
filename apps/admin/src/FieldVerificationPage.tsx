import { useState } from 'react';
import { Badge } from '@sabou/ui';
import type { FieldVerificationItem } from '@sabou/types';
import { listFieldVerification } from './certification-api';
import { QUEUES } from './queues';
import {
  DecisionActions,
  DossierQueuePage,
  longDate,
  type Announce,
  type OnDecided,
  DossierRow,
} from './DossierDecision';
import { FieldVisitPanel } from './FieldVisitPanel';

// Vérification terrain par l'admin préfectoral (US-042, UC-31) : dossiers de sa préfecture
// à l'étape 2, visite planifiée puis réalisée avec compte rendu signé (US-041, UC-30),
// validation après la visite, ou rejet motivé qui renvoie le dossier au praticien
export function FieldVerificationPage() {
  return (
    <DossierQueuePage
      title="Vérification terrain"
      lead="Dossiers soumis dans votre préfecture, en attente de votre décision. Délai cible : 3 jours par dossier."
      listTitle="Dossiers à vérifier"
      empty="Aucun dossier en attente de vérification."
      queue={QUEUES.fieldVerification}
      load={listFieldVerification}
      item={DossierItem}
    />
  );
}

function DossierItem({
  dossier,
  onDecided,
  announce,
}: {
  dossier: FieldVerificationItem;
  onDecided: OnDecided;
  announce: Announce;
}) {
  // Une visite enregistrée sur cet écran rend la validation possible sans recharger la liste
  const [visitDone, setVisitDone] = useState(dossier.visiteRealisee);
  return (
    <DossierRow
      code={dossier.code}
      name={dossier.praticienNom}
      meta={
        <>
          {dossier.specialite} · soumis le {longDate(dossier.soumisLe)}{' '}
          {visitDone ? (
            <Badge tone="success">Visite faite</Badge>
          ) : dossier.visiteRequise ? (
            <Badge tone="warning">Visite attendue</Badge>
          ) : null}
        </>
      }
    >
      <dl className="ui-facts">
        <dt>Praticien</dt>
        <dd>{dossier.praticien}</dd>
        <dt>Spécialité</dt>
        <dd>{dossier.specialite}</dd>
        <dt>Type</dt>
        <dd>{dossier.type === 'initial' ? 'Première certification' : 'Renouvellement'}</dd>
        <dt>Soumis le</dt>
        <dd>{longDate(dossier.soumisLe)}</dd>
        <dt>Visite sur place</dt>
        <dd>
          {visitDone ? (
            <Badge tone="success">Réalisée, compte rendu signé</Badge>
          ) : dossier.visiteRequise ? (
            <Badge tone="warning">À réaliser</Badge>
          ) : (
            <Badge tone="neutral">Non requise</Badge>
          )}
        </dd>
      </dl>
      {(dossier.visiteRequise || dossier.visite) && (
        <FieldVisitPanel
          code={dossier.code}
          visit={dossier.visite}
          announce={announce}
          onChange={(visit) => setVisitDone((done) => done || visit.statut === 'realisee')}
        />
      )}
      <DecisionActions
        code={dossier.code}
        label={`${dossier.code}, ${dossier.praticienNom}`}
        etape={2}
        // Un dossier initial exige toujours une visite ; un renouvellement, selon le risque (R-QR-07)
        canValidate={visitDone || !dossier.visiteRequise}
        blockedReason="La validation sera possible une fois la visite réalisée et son compte rendu signé."
        validatedNotice={`Dossier ${dossier.code} validé : il passe à la consolidation régionale.`}
        rejectedNotice={`Dossier ${dossier.code} rejeté : il revient au praticien.`}
        rejectHint="Le dossier revient au praticien. Le motif est conservé dans l’historique du dossier."
        onDecided={onDecided}
      />
    </DossierRow>
  );
}
