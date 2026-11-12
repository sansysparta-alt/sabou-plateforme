import { Badge } from '@sabou/ui';
import type { ExpertiseItem } from '@sabou/types';
import { listExpertise } from './certification-api';
import { DecisionActions, DossierQueuePage, longDate, type OnDecided } from './DossierDecision';

// Expertise par le Comité scientifique (US-044, UC-50) : dossiers consolidés de toutes les
// régions (étape 4), transmis à la DG pour approbation, ou renvoyés avec motif au régional
export function ExpertisePage() {
  return (
    <DossierQueuePage
      title="Expertise des dossiers"
      lead="Dossiers consolidés par les régions, en attente de l’avis du Comité scientifique. Délai cible : 3 jours par dossier."
      listTitle="Dossiers à expertiser"
      empty="Aucun dossier en attente d’expertise."
      load={listExpertise}
      item={DossierItem}
    />
  );
}

function DossierItem({ dossier, onDecided }: { dossier: ExpertiseItem; onDecided: OnDecided }) {
  return (
    <li className="ui-card ui-card--plain">
      <h3>
        {dossier.code} · {dossier.praticienNom}
      </h3>
      <dl className="ui-facts">
        <dt>Praticien</dt>
        <dd>{dossier.praticien}</dd>
        <dt>Spécialité</dt>
        <dd>{dossier.specialite}</dd>
        <dt>Zone</dt>
        <dd>
          {dossier.prefecture}, région de {dossier.region}
        </dd>
        <dt>Type</dt>
        <dd>{dossier.type === 'initial' ? 'Première certification' : 'Renouvellement'}</dd>
        <dt>Consolidé le</dt>
        <dd>{longDate(dossier.consolideLe)}</dd>
        <dt>Visite sur place</dt>
        <dd>
          {dossier.visiteRealisee ? (
            <Badge tone="success">Réalisée, compte rendu signé</Badge>
          ) : (
            <Badge tone="neutral">Aucune visite enregistrée</Badge>
          )}
        </dd>
      </dl>
      <DecisionActions
        code={dossier.code}
        label={`${dossier.code}, ${dossier.praticienNom}`}
        etape={4}
        canValidate
        validatedNotice={`Dossier ${dossier.code} validé : il passe à l’approbation de la Direction Générale.`}
        rejectedNotice={`Dossier ${dossier.code} rejeté : il revient à la consolidation régionale.`}
        rejectHint="Le dossier revient à l’admin régional. Le motif est conservé dans l’historique du dossier."
        onDecided={onDecided}
      />
    </li>
  );
}
