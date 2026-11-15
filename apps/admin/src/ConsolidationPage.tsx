import { Badge } from '@sabou/ui';
import type { ConsolidationItem } from '@sabou/types';
import { listConsolidation } from './certification-api';
import {
  DecisionActions,
  DossierQueuePage,
  DossierRow,
  longDate,
  type OnDecided,
} from './DossierDecision';

// Consolidation par l'admin régional (US-043, UC-40) : dossiers de sa région vérifiés sur le
// terrain (étape 3), transmis au Comité scientifique, ou renvoyés avec motif au préfectoral
export function ConsolidationPage() {
  return (
    <DossierQueuePage
      title="Consolidation régionale"
      lead="Dossiers de votre région vérifiés sur le terrain, en attente de votre décision. Délai cible : 3 jours par dossier."
      listTitle="Dossiers à consolider"
      empty="Aucun dossier en attente de consolidation."
      load={listConsolidation}
      item={DossierItem}
    />
  );
}

function DossierItem({ dossier, onDecided }: { dossier: ConsolidationItem; onDecided: OnDecided }) {
  return (
    <DossierRow
      code={dossier.code}
      name={dossier.praticienNom}
      meta={`${dossier.prefecture} · ${dossier.specialite} · vérifié le ${longDate(dossier.verifieLe)}`}
    >
      <dl className="ui-facts">
        <dt>Praticien</dt>
        <dd>{dossier.praticien}</dd>
        <dt>Spécialité</dt>
        <dd>{dossier.specialite}</dd>
        <dt>Préfecture</dt>
        <dd>{dossier.prefecture}</dd>
        <dt>Type</dt>
        <dd>{dossier.type === 'initial' ? 'Première certification' : 'Renouvellement'}</dd>
        <dt>Vérifié sur le terrain le</dt>
        <dd>{longDate(dossier.verifieLe)}</dd>
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
        etape={3}
        canValidate
        validatedNotice={`Dossier ${dossier.code} validé : il passe à l’expertise du Comité scientifique.`}
        rejectedNotice={`Dossier ${dossier.code} rejeté : il revient à la vérification terrain.`}
        rejectHint="Le dossier revient à l’admin préfectoral pour une nouvelle vérification terrain. Le motif est conservé dans l’historique du dossier."
        onDecided={onDecided}
      />
    </DossierRow>
  );
}
