import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Alert, Badge, Button, PageHeader, SelectField, TextAreaField } from '@sabou/ui';
import type {
  HealthReportDecision,
  HealthReportItem,
  HealthReportSeverity,
  SuspendedTreatment,
} from '@sabou/types';
import { ApiError } from './accounts-api';
import { DossierQueuePage, DossierRow, type OnDecided } from './DossierDecision';
import {
  decideHealthReport,
  liftSuspension,
  listHealthReports,
  listSuspendedTreatments,
} from './health-reports-api';
import { PAGE_HEADERS } from './page-headers';
import { QUEUES } from './queues';

// Signalements de danger et d'effets indésirables (US-100, UC-54, R-SAN-03) : file du Comité
// scientifique (graves en tête, délai cible 24 h), décision motivée ; traitements suspendus
// et levée de la suspension. Libellés définis ici : l'application n'importe que des types de
// @sabou/types (réseau 3G).

const MOTIF_MAX_LENGTH = 1000;

const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : 'Une erreur est survenue.';

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });

const TYPE: Record<HealthReportItem['type'], string> = {
  danger: 'Danger',
  effet_indesirable: 'Effet indésirable',
};

const SEVERITY: Record<
  HealthReportSeverity,
  { label: string; tone: 'error' | 'warning' | 'neutral' }
> = {
  grave: { label: 'Grave', tone: 'error' },
  moyenne: { label: 'Moyenne', tone: 'warning' },
  faible: { label: 'Faible', tone: 'neutral' },
};

const OBJECT_STATUS: Record<string, string> = {
  certifiee: 'certifié, en ligne',
  suspendue: 'suspendu',
  retiree: 'retiré',
  brouillon: 'en révision chez le praticien',
  validee: 'validée, en ligne',
  en_revue: 'en revue par le Comité',
};

// Décisions proposées selon l'objet : une plante ne se suspend ni ne se retire (elle revient
// à la revue du Comité) ; un traitement déjà retiré ne change plus
const DECISIONS: { value: HealthReportDecision; label: string; hint: string }[] = [
  {
    value: 'aucune_action',
    label: 'Aucune action',
    hint: 'Le signalement est clos ; rien ne change en ligne.',
  },
  {
    value: 'revision',
    label: 'Révision',
    hint: 'Le traitement quitte le site et revient au praticien en brouillon (SMS avec le motif) ; il refait ensuite tout le circuit. Une plante revient à la revue du Comité.',
  },
  {
    value: 'suspension',
    label: 'Suspension',
    hint: 'Le traitement quitte le site immédiatement. Le Comité pourra lever la suspension, avec un motif, dans « Traitements suspendus ».',
  },
  {
    value: 'retrait',
    label: 'Retrait définitif',
    hint: 'Le traitement quitte le site définitivement ; il ne pourra plus revenir.',
  },
];

function decisionsFor(report: HealthReportItem) {
  if (report.objetType !== 'recette') {
    return DECISIONS.filter((d) => d.value === 'aucune_action' || d.value === 'revision');
  }
  if (report.objetStatut === 'retiree' || report.objetStatut === 'brouillon') {
    return DECISIONS.filter((d) => d.value === 'aucune_action');
  }
  return DECISIONS;
}

export function HealthReportsPage() {
  return (
    <DossierQueuePage
      {...PAGE_HEADERS['/signalements']}
      listTitle="Signalements à traiter"
      empty="Aucun signalement en attente."
      queue={QUEUES.healthReports}
      load={listHealthReports}
      item={HealthReportItemRow}
      words={{
        one: 'signalement',
        many: 'signalements',
        searchLabel: 'Rechercher un signalement',
        placeholder: 'Référence (SIG-00001), code ou nom du traitement ou de la plante',
        none: 'Aucun signalement ne correspond.',
      }}
    />
  );
}

function HealthReportItemRow({
  dossier: report,
  onDecided,
}: {
  dossier: HealthReportItem;
  onDecided: OnDecided;
}) {
  const severity = SEVERITY[report.gravite];
  return (
    <DossierRow
      code={report.code}
      name={`${report.objetCode} · ${report.objetNom}`}
      meta={
        <>
          <Badge tone={severity.tone}>{severity.label}</Badge> {TYPE[report.type]} · reçu le{' '}
          {dateTime(report.recuLe)}
          {report.enRetard && (
            <>
              {' '}
              <Badge tone="error">Délai de 24 h dépassé</Badge>
            </>
          )}
        </>
      }
    >
      {report.echeance && (
        <Alert tone={report.enRetard ? 'error' : 'warning'} title="Signalement grave">
          {report.enRetard ? 'Délai cible dépassé depuis le ' : 'À traiter avant le '}
          {dateTime(report.echeance)}.
        </Alert>
      )}
      <dl className="ui-facts">
        <dt>Objet</dt>
        <dd>
          {report.objetType === 'plante' ? 'Plante' : 'Traitement'} {report.objetCode},{' '}
          {report.objetNom} ({OBJECT_STATUS[report.objetStatut] ?? report.objetStatut})
        </dd>
        {report.praticienNom && (
          <>
            <dt>Praticien</dt>
            <dd>
              {report.praticienNom}
              {report.prefecture ? ` · ${report.prefecture}` : ''}
            </dd>
          </>
        )}
        <dt>Contact de l’auteur</dt>
        <dd>{report.contact ?? 'Aucun (signalement anonyme)'}</dd>
      </dl>
      <h4>Ce qui est signalé</h4>
      <p className="ui-prose">{report.description}</p>
      <ReportDecision report={report} onDecided={onDecided} />
    </DossierRow>
  );
}

function ReportDecision({ report, onDecided }: { report: HealthReportItem; onDecided: OnDecided }) {
  const id = useId();
  const choices = decisionsFor(report);
  const [decision, setDecision] = useState<HealthReportDecision | ''>('');
  const [motif, setMotif] = useState('');
  const [errors, setErrors] = useState<{ decision?: string; motif?: string }>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const decisionField = useRef<HTMLSelectElement>(null);
  const motifField = useRef<HTMLTextAreaElement>(null);
  const chosen = choices.find((c) => c.value === decision);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const next = {
      ...(decision ? {} : { decision: 'Choisissez une décision.' }),
      ...(motif.trim() ? {} : { motif: 'Indiquez le motif de la décision.' }),
    };
    setErrors(next);
    if (next.decision) return decisionField.current?.focus();
    if (next.motif) return motifField.current?.focus();
    setBusy(true);
    setError(undefined);
    try {
      await decideHealthReport(report.code, decision as HealthReportDecision, motif.trim());
      onDecided(
        report.code,
        `Signalement ${report.code} clos : ${chosen!.label.toLowerCase()} (${report.objetCode}).`,
      );
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <section className="ui-decision" aria-labelledby={`${id}-titre`}>
      <h4 id={`${id}-titre`} className="ui-decision__title">
        Décision
      </h4>
      {error && <Alert tone="error">{error}</Alert>}
      <form className="ui-form" onSubmit={onSubmit} noValidate>
        <SelectField
          ref={decisionField}
          label="Votre décision"
          hint={chosen?.hint}
          error={errors.decision}
          value={decision}
          required
          onChange={(event) => setDecision(event.target.value as HealthReportDecision | '')}
        >
          <option value="">Choisir…</option>
          {choices.map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </SelectField>
        <TextAreaField
          ref={motifField}
          label="Motif"
          hint="Conservé avec le signalement ; pour une révision, une suspension ou un retrait, il est aussi visible du praticien dans son Studio."
          error={errors.motif}
          value={motif}
          maxLength={MOTIF_MAX_LENGTH}
          required
          onChange={(event) => setMotif(event.target.value)}
        />
        <div className="ui-form__actions">
          <Button
            type="submit"
            variant={decision === 'suspension' || decision === 'retrait' ? 'danger' : 'primary'}
            disabled={busy}
          >
            Enregistrer la décision{' '}
            <span className="ui-visually-hidden">sur le signalement {report.code}</span>
          </Button>
        </div>
      </form>
    </section>
  );
}

// Traitements suspendus : levée par le Comité, avec un motif ; le retrait se décide depuis un
// signalement (décision « retrait ») ou par la DG
export function SuspendedTreatmentsPage() {
  const [items, setItems] = useState<SuspendedTreatment[] | null>(null);
  const [loadError, setLoadError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let current = true;
    listSuspendedTreatments().then(
      (list) => current && setItems(list),
      (error: unknown) => current && setLoadError(errorMessage(error)),
    );
    return () => {
      current = false;
    };
  }, []);

  function onLifted(code: string, text: string) {
    setItems((list) => list && list.filter((item) => item.code !== code));
    setNotice(text);
    heading.current?.focus();
  }

  return (
    <>
      <PageHeader {...PAGE_HEADERS['/traitements-suspendus']} />
      {loadError && <Alert tone="error">{loadError}</Alert>}
      <p role="status" className="ui-live-status">
        {notice}
      </p>
      {items === null && !loadError && <p>Chargement…</p>}
      {items !== null && (
        <section className="ui-section" aria-labelledby="suspendus-titre">
          <div className="ui-list-title">
            <h2 id="suspendus-titre" ref={heading} tabIndex={-1}>
              Traitements suspendus
            </h2>
            <span className="ui-tabs__count">
              {items.length}
              <span className="ui-visually-hidden">
                {' '}
                {items.length > 1 ? 'traitements' : 'traitement'}
              </span>
            </span>
          </div>
          {items.length === 0 && <p>Aucun traitement suspendu.</p>}
          {items.length > 0 && (
            <ul className="ui-dossiers">
              {items.map((item) => (
                <DossierRow
                  key={item.code}
                  code={item.code}
                  name={item.titreFr}
                  meta={`${item.praticienNom} · suspendu le ${dateTime(item.suspenduLe)}`}
                >
                  {item.motif && (
                    <p className="ui-muted">
                      <strong>Motif de la suspension :</strong> {item.motif}
                    </p>
                  )}
                  <LiftForm item={item} onLifted={onLifted} />
                </DossierRow>
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}

function LiftForm({ item, onLifted }: { item: SuspendedTreatment; onLifted: OnDecided }) {
  const id = useId();
  const [motif, setMotif] = useState('');
  const [motifError, setMotifError] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const motifField = useRef<HTMLTextAreaElement>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!motif.trim()) {
      setMotifError('Indiquez le motif de la levée.');
      motifField.current?.focus();
      return;
    }
    setMotifError(undefined);
    setBusy(true);
    setError(undefined);
    try {
      await liftSuspension(item.code, motif.trim());
      onLifted(item.code, `Suspension levée : le traitement ${item.code} est de nouveau en ligne.`);
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <section className="ui-decision" aria-labelledby={`${id}-titre`}>
      <h4 id={`${id}-titre`} className="ui-decision__title">
        Décision
      </h4>
      {error && <Alert tone="error">{error}</Alert>}
      <form className="ui-form" onSubmit={onSubmit} noValidate>
        <TextAreaField
          ref={motifField}
          label="Motif de la levée"
          hint="Le traitement revient en ligne s’il remplit toujours les conditions de certification ; le praticien reçoit un SMS."
          error={motifError}
          value={motif}
          maxLength={MOTIF_MAX_LENGTH}
          required
          onChange={(event) => setMotif(event.target.value)}
        />
        <div className="ui-form__actions">
          <Button type="submit" variant="primary" icon="success" disabled={busy}>
            Lever la suspension{' '}
            <span className="ui-visually-hidden">du traitement {item.code}</span>
          </Button>
        </div>
      </form>
    </section>
  );
}
