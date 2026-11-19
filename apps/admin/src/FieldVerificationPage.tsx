import { useState } from 'react';
import { Alert, Badge } from '@sabou/ui';
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
import { PAGE_HEADERS } from './page-headers';

// Vérification terrain par l'admin préfectoral (US-042, UC-31) : dossiers de sa préfecture
// à l'étape 2, visite planifiée puis réalisée avec compte rendu signé (US-041, UC-30),
// validation après la visite, ou rejet motivé qui renvoie le dossier au praticien
export function FieldVerificationPage() {
  return (
    <DossierQueuePage
      {...PAGE_HEADERS['/verification-terrain']}
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
  // Messages des actions faites dans le panneau : dits dans le panneau et sur la page
  const [notice, setNotice] = useState('');
  const say: Announce = (text) => {
    setNotice(text);
    announce(text);
  };
  // Séparation des tâches (US-040c, US-040d) : l'auteur d'un dossier terrain ne le vérifie pas ;
  // un agent désigné par le régional est seul à le vérifier. On le dit d'emblée, sans
  // proposer de décision que la base refuserait.
  const notMine = dossier.auteur
    ? 'Vous avez créé ce dossier terrain : un autre agent le vérifie (séparation des tâches). Il est visible ici pour suivi.'
    : dossier.verificateur && !dossier.verificateurEstMoi
      ? `La vérification de ce dossier est confiée à ${dossier.verificateur}, désigné par l’admin régional. Il est visible ici pour suivi.`
      : undefined;
  const showVisit = !notMine && (dossier.visiteRequise || dossier.visite !== null);
  return (
    <DossierRow
      code={dossier.code}
      name={dossier.praticienNom}
      notice={notice}
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
        {dossier.verificateur && (
          <>
            <dt>Vérification confiée à</dt>
            <dd>{dossier.verificateur} (désigné par l’admin régional)</dd>
          </>
        )}
        {/* La visite a son propre bloc quand il est affiché : pas de doublon ici */}
        {!showVisit && (
          <>
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
          </>
        )}
      </dl>
      {notMine && <Alert tone="info">{notMine}</Alert>}
      {showVisit && (
        <FieldVisitPanel
          code={dossier.code}
          visit={dossier.visite}
          announce={say}
          onChange={(visit) => setVisitDone((done) => done || visit.statut === 'realisee')}
        />
      )}
      {!notMine && (
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
      )}
    </DossierRow>
  );
}
