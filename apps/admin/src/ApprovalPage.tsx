import { useState } from 'react';
import { Alert, Badge, Button } from '@sabou/ui';
import type { ApprovalItem } from '@sabou/types';
import { ApiError } from './accounts-api';
import { approveDossier, listApproval } from './certification-api';
import { QUEUES } from './queues';
import {
  DecisionActions,
  DossierQueuePage,
  DossierRow,
  longDate,
  type OnDecided,
} from './DossierDecision';

// Approbation par la Direction Générale (US-045, UC-60) : dossiers expertisés par le Comité
// (étape 5). Approuver émet le certificat signé (12 mois) ; rejeter renvoie au Comité.
export function ApprovalPage() {
  return (
    <DossierQueuePage
      title="Approbation des dossiers"
      lead="Dossiers expertisés par le Comité scientifique. L’approbation émet le certificat signé, valable 12 mois."
      listTitle="Dossiers à approuver"
      empty="Aucun dossier en attente d’approbation."
      queue={QUEUES.approval}
      load={listApproval}
      item={DossierItem}
    />
  );
}

export const certificatePath = (numero: string) => `/certificats/${encodeURIComponent(numero)}`;

function DossierItem({ dossier, onDecided }: { dossier: ApprovalItem; onDecided: OnDecided }) {
  const label = `${dossier.code}, ${dossier.praticienNom}`;
  return (
    <DossierRow
      code={dossier.code}
      name={dossier.praticienNom}
      meta={`${dossier.prefecture} · ${dossier.specialite} · expertisé le ${longDate(dossier.expertiseLe)}`}
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
        <dt>Expertisé le</dt>
        <dd>{longDate(dossier.expertiseLe)}</dd>
        <dt>Visite sur place</dt>
        <dd>
          {dossier.visiteRealisee ? (
            <Badge tone="success">Réalisée, compte rendu signé</Badge>
          ) : (
            <Badge tone="neutral">Aucune visite enregistrée</Badge>
          )}
        </dd>
        {dossier.certificatActuel && (
          <>
            <dt>Certificat actuel</dt>
            <dd>{dossier.certificatActuel} (passera « expiré » à l’émission du nouveau)</dd>
          </>
        )}
      </dl>
      <ApproveAction code={dossier.code} label={label} />
      <DecisionActions
        code={dossier.code}
        label={label}
        etape={5}
        canValidate={false}
        validatedNotice=""
        rejectedNotice={`Dossier ${dossier.code} rejeté : il revient au Comité scientifique.`}
        rejectHint="Le dossier revient au Comité scientifique. Le motif est conservé dans l’historique du dossier."
        onDecided={onDecided}
      />
    </DossierRow>
  );
}

const SIGNER_UNAVAILABLE =
  'Le service de signature est indisponible : aucun certificat n’a été émis. Réessayez dans quelques minutes.';

// Une fois le certificat émis, la page à imprimer s'ouvre (décision du 12 novembre 2026)
function ApproveAction({ code, label }: { code: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function approve() {
    setBusy(true);
    setError(undefined);
    try {
      const result = await approveDossier(code);
      window.location.assign(certificatePath(result.certificat));
    } catch (failure) {
      // 503 = coffre de signature indisponible : le client masque les messages 5xx, l'écran
      // rassure la DG sur l'essentiel (rien n'a été émis)
      setError(
        failure instanceof ApiError
          ? failure.status === 503
            ? SIGNER_UNAVAILABLE
            : failure.message
          : 'Une erreur est survenue.',
      );
      setBusy(false);
    }
  }

  return (
    <>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="ui-form__actions">
        <Button variant="primary" icon="success" disabled={busy} onClick={approve}>
          {busy ? 'Signature en cours… ' : 'Approuver et émettre le certificat '}
          <span className="ui-visually-hidden">du dossier {label}</span>
        </Button>
      </div>
    </>
  );
}
