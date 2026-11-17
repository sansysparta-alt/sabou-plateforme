import { Alert, Badge } from '@sabou/ui';
import type {
  CertificationBlocker,
  DecidableStatus,
  TreatmentQueueItem,
  Visibility,
} from '@sabou/types';
import {
  DecisionActions,
  DossierQueuePage,
  DossierRow,
  longDate,
  type OnDecided,
} from './DossierDecision';
import { PAGE_HEADERS } from './page-headers';
import { QUEUES } from './queues';
import { decideTreatment, listTreatments } from './treatments-api';

// Ce que fait chaque acteur, selon le statut du traitement (R-REC-07). Défini ici plutôt
// qu'importé de @sabou/types : l'application n'en importe que des types (réseau 3G).
const STEPS: Record<
  DecidableStatus,
  { action: string; advanced: string; returned: string; returnHint: string }
> = {
  soumise: {
    action: 'Transmettre au Comité',
    advanced: 'transmis au Comité scientifique',
    returned: 'renvoyé au praticien pour correction',
    returnHint:
      'Le traitement revient au praticien, en brouillon, pour correction. Le motif est conservé dans son historique et visible dans son Studio.',
  },
  transmise: {
    action: 'Expertiser',
    advanced: 'expertisé : il passe à la certification de la Direction Générale',
    returned: 'renvoyé à l’administration régionale',
    returnHint:
      'Le traitement revient à l’administration régionale. Le motif est conservé dans son historique.',
  },
  expertisee: {
    action: 'Certifier',
    advanced: 'certifié',
    returned: 'renvoyé au Comité scientifique',
    returnHint:
      'Le traitement revient au Comité scientifique. Le motif est conservé dans son historique.',
  },
};

// US-062 : ce qui empêche encore la certification, rédigé pour la DG
const BLOCKERS: Record<CertificationBlocker, string> = {
  plante: 'le traitement n’a aucune plante',
  plante_en_revue: 'une plante n’est pas encore validée par le Comité scientifique',
  sections: 'une section obligatoire manque',
  cycle: 'le cycle (durée et prises par jour) n’est pas renseigné',
  certificat: 'le praticien n’a pas de certificat actif',
  quota: 'la formule gratuite du praticien est limitée à 3 traitements certifiés',
};

function blockedReason(treatment: TreatmentQueueItem): string | undefined {
  if (treatment.blocages.length === 0) return undefined;
  const reasons = treatment.blocages.map((b) => BLOCKERS[b]).join(' ; ');
  const later =
    treatment.blocages.length === 1 && treatment.blocages[0] === 'certificat' && treatment.dossier
      ? ` Il sera certifié à la publication du dossier ${treatment.dossier}.`
      : '';
  return `Certification impossible pour l’instant : ${reasons}.${later}`;
}

const VISIBILITY: Record<Visibility, string> = {
  publique: 'Publique',
  restreinte: 'Restreinte (comptes connectés)',
  privee: 'Privée',
};

// Traitements qui attendent la décision du compte connecté (US-061, UC-42, UC-51, UC-62) :
// transmission par le régional de la région du praticien, expertise par le Comité,
// certification par la DG ; ou renvoi à l'étape précédente avec un motif
export function TreatmentsPage() {
  return (
    <DossierQueuePage
      {...PAGE_HEADERS['/traitements']}
      listTitle="Traitements à décider"
      empty="Aucun traitement n’attend votre décision."
      queue={QUEUES.treatments}
      load={listTreatments}
      item={TreatmentItem}
      words={{
        one: 'traitement',
        many: 'traitements',
        searchLabel: 'Rechercher un traitement',
        placeholder: 'Code (REC-0001), titre ou nom du praticien',
        none: 'Aucun traitement ne correspond.',
      }}
    />
  );
}

function TreatmentItem({
  dossier: treatment,
  onDecided,
}: {
  dossier: TreatmentQueueItem;
  onDecided: OnDecided;
}) {
  const step = STEPS[treatment.statut];
  return (
    <DossierRow
      code={treatment.code}
      name={treatment.titreFr}
      meta={`${treatment.praticienNom} · ${treatment.prefecture} · ${treatment.maladie} · depuis le ${longDate(treatment.depuisLe)}`}
    >
      {treatment.contreIndications.length > 0 && (
        <Alert tone="warning" title="Contre-indications">
          Déconseillé : {treatment.contreIndications.join(', ')}.
        </Alert>
      )}
      {treatment.dernierMotif && (
        <p className="ui-muted">
          <strong>Dernier renvoi :</strong> {treatment.dernierMotif}
        </p>
      )}
      <dl className="ui-facts">
        <dt>Praticien</dt>
        <dd>
          {treatment.praticienNom} ({treatment.praticien})
        </dd>
        <dt>Maladie</dt>
        <dd>{treatment.maladie}</dd>
        <dt>Cycle</dt>
        <dd>
          {treatment.cycleDureeJours} jours, {treatment.cyclePrisesParJour} prise(s) par jour
          {treatment.cyclePauseJours ? `, pause de ${treatment.cyclePauseJours} jours` : ''}
        </dd>
        <dt>Visibilité</dt>
        <dd>{VISIBILITY[treatment.visibilite]}</dd>
        <dt>Dossier de certification</dt>
        <dd>{treatment.dossier ?? 'Praticien déjà certifié'}</dd>
      </dl>
      <h4>Plantes, dans l’ordre</h4>
      <ol>
        {treatment.plantes.map((plant) => (
          <li key={plant.nomScientifique}>
            {plant.nomFr} (<i>{plant.nomScientifique}</i>){plant.partie ? ` — ${plant.partie}` : ''}{' '}
            {!plant.validee && <Badge tone="warning">En revue par le Comité</Badge>}
          </li>
        ))}
      </ol>
      {treatment.sections.map((section) => (
        <section key={section.type} aria-label={section.libelleFr}>
          <h4>{section.libelleFr}</h4>
          <p className="ui-prose">{section.texteFr}</p>
          {section.texteEn && (
            <p lang="en" className="ui-muted">
              {section.texteEn}
            </p>
          )}
        </section>
      ))}
      <DecisionActions
        code={treatment.code}
        label={`${treatment.code}, ${treatment.titreFr}`}
        noun="traitement"
        validateLabel={step.action}
        canValidate={treatment.blocages.length === 0}
        blockedReason={blockedReason(treatment)}
        validatedNotice={`Traitement ${treatment.code} ${step.advanced}.`}
        rejectedNotice={`Traitement ${treatment.code} ${step.returned}.`}
        rejectHint={step.returnHint}
        submit={(decision, motif) =>
          decideTreatment(
            treatment.code,
            treatment.statut,
            decision === 'valide' ? 'avance' : 'renvoi',
            motif,
          )
        }
        onDecided={onDecided}
      />
    </DossierRow>
  );
}
