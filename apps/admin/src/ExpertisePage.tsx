import { Badge } from '@sabou/ui';
import type { ExpertiseItem } from '@sabou/types';
import { listExpertise } from './certification-api';
import { QUEUES } from './queues';
import {
  DecisionActions,
  DossierQueuePage,
  DossierRow,
  longDate,
  type OnDecided,
} from './DossierDecision';
import { PAGE_HEADERS } from './page-headers';

// Expertise par le Comité scientifique (US-044, UC-50) : dossiers consolidés de toutes les
// régions (étape 4), transmis à la DG pour approbation, ou renvoyés avec motif au régional
export function ExpertisePage() {
  return (
    <DossierQueuePage
      {...PAGE_HEADERS['/expertise']}
      listTitle="Dossiers à expertiser"
      empty="Aucun dossier en attente d’expertise."
      queue={QUEUES.expertise}
      load={listExpertise}
      item={DossierItem}
    />
  );
}

function DossierItem({ dossier, onDecided }: { dossier: ExpertiseItem; onDecided: OnDecided }) {
  return (
    <DossierRow
      code={dossier.code}
      name={dossier.praticienNom}
      meta={`${dossier.prefecture} · ${dossier.specialite} · consolidé le ${longDate(dossier.consolideLe)}`}
    >
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
    </DossierRow>
  );
}
