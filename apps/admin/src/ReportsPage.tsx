import { Fragment, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type {
  ExportEntry,
  MonthlyReport,
  MonthlyReportList,
  MonthlyReportSummary,
  PrefectoralReportContent,
  RegionalReportContent,
  ReportDelays,
  ReportStatus,
} from '@sabou/types';
import { REPORT_COMMENT_MAX_LENGTH, REPORT_MOTIF_MAX_LENGTH } from '@sabou/types';
import {
  Alert,
  Badge,
  Button,
  Card,
  DataTable,
  PageHeader,
  SelectField,
  TextAreaField,
  type BadgeTone,
  type Column,
} from '@sabou/ui';
import { ApiError } from './accounts-api';
import { ExportButtons } from './ExportButtons';
import { PAGE_HEADERS } from './page-headers';
import {
  commentReport,
  exportFileUrl,
  fetchExports,
  fetchReport,
  fetchReports,
  prepareReport,
  returnReport,
  sendReport,
} from './reports-api';

// Rapports mensuels et historique des exports (US-091, UC-36, UC-67, R-MOD-09 ; 05 §2.91).
// Préfectoral : rédige et envoie son rapport au régional. Régional : reçoit ceux de ses
// préfectures (peut les renvoyer avec un motif), rédige le sien et l'envoie à la DG. DG :
// reçoit les rapports régionaux. Tous : historique des exports de leur zone.

export type ReportsRole = 'dg' | 'regional' | 'prefectoral' | 'scientifique';

const STATUS: Record<ReportStatus, { label: string; tone: BadgeTone }> = {
  brouillon: { label: 'Brouillon', tone: 'neutral' },
  envoye: { label: 'Envoyé', tone: 'success' },
  renvoye: { label: 'Renvoyé', tone: 'warning' },
};

const monthFormat = new Intl.DateTimeFormat('fr-FR', {
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
// « 2026-10-01 » → « octobre 2026 »
export const monthLabel = (isoDay: string) => monthFormat.format(new Date(`${isoDay}T12:00:00Z`));
const dateTime = new Intl.DateTimeFormat('fr-FR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Conakry',
});
const when = (iso: string | null) => (iso ? dateTime.format(new Date(iso)) : '—');

const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : 'Une erreur est survenue.';

export function ReportsPage({ role }: { role: ReportsRole }) {
  const [list, setList] = useState<MonthlyReportList | null>(null);
  const [exports, setExports] = useState<ExportEntry[] | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  // Relecture du rapport ouvert après une action (envoi, renvoi)
  const [revision, setRevision] = useState(0);
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();

  // Relecture des listes : incrémenter ce compteur
  const [listVersion, setListVersion] = useState(0);
  const reload = () => setListVersion((n) => n + 1);

  useEffect(() => {
    let active = true;
    // Même lecture pour tous les profils (préchargée au démarrage, US-017) ; pour le Comité,
    // les listes sont vides
    Promise.all([fetchReports(), fetchExports()]).then(
      ([reports, history]) => {
        if (!active) return;
        setList(reports);
        setExports(history);
        setError(undefined);
      },
      (failure: unknown) => active && setError(errorMessage(failure)),
    );
    return () => {
      active = false;
    };
  }, [listVersion]);

  const done = (text: string) => {
    setStatus(text);
    setRevision((n) => n + 1);
    reload();
  };

  const header = PAGE_HEADERS['/rapports'];
  return (
    <>
      <PageHeader title={header.title} lead={header.lead} />
      <p role="status" className="ui-live-status">
        {status}
      </p>
      {error && <Alert tone="error">{error}</Alert>}
      {list?.peutRediger && (
        <PrepareForm
          months={list.moisPossibles}
          role={role}
          onPrepared={(id) => {
            setSelected(id);
            reload();
          }}
        />
      )}
      {list && (role === 'prefectoral' || role === 'regional') && (
        <ReportTable
          title="Mes rapports"
          rows={list.miens}
          withZone={false}
          empty="Aucun rapport rédigé pour l’instant."
          onOpen={setSelected}
        />
      )}
      {list && (role === 'regional' || role === 'dg') && (
        <ReportTable
          title={
            role === 'regional' ? 'Rapports reçus des préfectures' : 'Rapports reçus des régions'
          }
          rows={list.recus}
          withZone
          empty="Aucun rapport reçu pour l’instant."
          onOpen={setSelected}
        />
      )}
      {selected !== null && (
        <ReportDetail
          key={`${selected}-${revision}`}
          id={selected}
          onClose={() => setSelected(null)}
          onOpen={setSelected}
          onDone={done}
        />
      )}
      <ExportHistory rows={exports} />
    </>
  );
}

function PrepareForm({
  months,
  role,
  onPrepared,
}: {
  months: string[];
  role: ReportsRole;
  onPrepared: (id: number) => void;
}) {
  const [month, setMonth] = useState(months[0] ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      onPrepared((await prepareReport(month)).id);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Rédiger un rapport mensuel">
      <p>
        Le rapport est prérempli avec les chiffres de votre zone pour le mois choisi. Ajoutez votre
        commentaire, puis envoyez-le{' '}
        {role === 'prefectoral' ? 'à l’administration régionale' : 'à la Direction Générale'}. Une
        fois envoyé, il ne change plus.
      </p>
      {error && <Alert tone="error">{error}</Alert>}
      <form className="ui-form" onSubmit={onSubmit} noValidate>
        <SelectField
          label="Mois"
          value={month}
          required
          onChange={(event) => setMonth(event.target.value)}
        >
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
            </option>
          ))}
        </SelectField>
        <div className="ui-form__actions">
          <Button type="submit" disabled={busy || !month}>
            Préparer le rapport
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ReportTable({
  title,
  rows,
  withZone,
  empty,
  onOpen,
}: {
  title: string;
  rows: MonthlyReportSummary[];
  withZone: boolean;
  empty: string;
  onOpen: (id: number) => void;
}) {
  const columns: Column<MonthlyReportSummary>[] = [
    ...(withZone
      ? [{ key: 'zone', header: 'Zone', render: (r: MonthlyReportSummary) => r.zone }]
      : []),
    { key: 'mois', header: 'Mois', render: (r) => monthLabel(r.mois) },
    { key: 'version', header: 'Version', render: (r) => r.version, numeric: true },
    {
      key: 'statut',
      header: 'État',
      render: (r) => <Badge tone={STATUS[r.statut].tone}>{STATUS[r.statut].label}</Badge>,
    },
    { key: 'envoye', header: 'Envoyé le', render: (r) => when(r.envoyeLe) },
    {
      key: 'ouvrir',
      header: 'Action',
      render: (r) => (
        <Button variant="secondary" onClick={() => onOpen(r.id)}>
          Ouvrir{' '}
          <span className="ui-visually-hidden">
            le rapport {r.zone} de {monthLabel(r.mois)}
          </span>
        </Button>
      ),
    },
  ];
  return (
    <section className="ui-section" aria-label={title}>
      <h2>{title}</h2>
      <DataTable
        caption={title}
        captionHidden
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        paginate={{
          key: `rapports-${withZone ? 'recus' : 'miens'}`,
          noun: ['rapport', 'rapports'],
        }}
        empty={empty}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Détail d'un rapport
// ---------------------------------------------------------------------------------------------
function ReportDetail({
  id,
  onClose,
  onOpen,
  onDone,
}: {
  id: number;
  onClose: () => void;
  onOpen: (id: number) => void;
  onDone: (text: string) => void;
}) {
  const [report, setReport] = useState<MonthlyReport | null>(null);
  const [error, setError] = useState<string>();
  const heading = useRef<HTMLHeadingElement>(null);

  // Relecture du rapport (après l'enregistrement du commentaire) : incrémenter ce compteur
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    fetchReport(id).then(
      (data) => active && setReport(data),
      (failure: unknown) => active && setError(errorMessage(failure)),
    );
    return () => {
      active = false;
    };
  }, [id, version]);

  // Le détail s'ouvre sous les listes : le focus y est porté pour le clavier et les lecteurs
  useEffect(() => {
    if (report) heading.current?.focus();
  }, [report]);

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!report) return <p aria-busy="true">Chargement du rapport…</p>;
  const level = report.niveau === 'prefectoral' ? 'préfectoral' : 'régional';
  const recipient =
    report.niveau === 'prefectoral' ? 'l’administration régionale' : 'la Direction Générale';

  return (
    <article className="ui-card" aria-labelledby={`rapport-${id}`}>
      <div className="ui-card__header">
        <h2 id={`rapport-${id}`} className="ui-card__title" tabIndex={-1} ref={heading}>
          Rapport {level} · {report.zone} · {monthLabel(report.mois)}
        </h2>
        <Button variant="secondary" onClick={onClose}>
          Fermer <span className="ui-visually-hidden">le rapport</span>
        </Button>
      </div>
      <div className="ui-card__body">
        <p>
          <Badge tone={STATUS[report.statut].tone}>{STATUS[report.statut].label}</Badge> Version{' '}
          {report.version}, rédigée par {report.auteur}. Chiffres calculés le{' '}
          {when(report.calculeLe)}
          {report.envoyeLe && `, envoyé le ${when(report.envoyeLe)}`}.
        </p>
        {report.renvoiMotif && (
          <Alert tone="warning" title="Renvoyé pour correction">
            {report.renvoiMotif}
          </Alert>
        )}
        {report.niveau === 'prefectoral' ? (
          <PrefectoralContent content={report.contenu as PrefectoralReportContent} />
        ) : (
          <RegionalContent content={report.contenu as RegionalReportContent} />
        )}
        {report.peutModifier ? (
          <CommentForm
            report={report}
            recipient={recipient}
            onSaved={() => setVersion((n) => n + 1)}
            onSent={() => onDone(`Rapport de ${monthLabel(report.mois)} envoyé à ${recipient}.`)}
          />
        ) : (
          <section aria-labelledby={`commentaire-${id}`}>
            <h3 id={`commentaire-${id}`}>Commentaire</h3>
            <p className="ui-prewrap">{report.commentaire ?? 'Aucun commentaire.'}</p>
          </section>
        )}
        {report.peutRenvoyer && (
          <ReturnForm
            id={report.id}
            onDone={() => onDone(`Rapport de ${report.zone} renvoyé avec votre motif.`)}
          />
        )}
        {report.versions.length > 0 && (
          <section aria-labelledby={`versions-${id}`}>
            <h3 id={`versions-${id}`}>Versions précédentes</h3>
            <ul className="ui-list">
              {report.versions.map((v) => (
                <li key={v.id}>
                  <Button variant="secondary" onClick={() => onOpen(v.id)}>
                    Version {v.version}
                  </Button>{' '}
                  renvoyée le {when(v.renvoyeLe)} : {v.renvoiMotif}
                </li>
              ))}
            </ul>
          </section>
        )}
        <ExportButtons
          subject={`le rapport ${report.zone} de ${monthLabel(report.mois)}`}
          request={(format) => ({ type: 'rapport_mensuel', format, rapport: report.id })}
        />
      </div>
    </article>
  );
}

function Facts({ rows }: { rows: [string, string | number][] }) {
  return (
    <dl className="ui-facts">
      {rows.map(([label, value]) => (
        <Fragment key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

function Delays({ title, delays }: { title: string; delays: ReportDelays }) {
  return (
    <section>
      <h3>{title}</h3>
      <Facts
        rows={[
          ['Décisions prises', delays.passages],
          ['dont validées', delays.valides],
          ['dont renvoyées', delays.renvoyes],
          [
            'Délai moyen',
            delays.moyenneJours === null
              ? 'Aucune décision'
              : `${String(delays.moyenneJours).replace('.', ',')} jours`,
          ],
          [`Au-delà de l’objectif de ${delays.objectifJours} jours`, delays.horsDelai],
        ]}
      />
    </section>
  );
}

const BLOCKED_COLUMNS: Column<PrefectoralReportContent['anomalies']['dossiersBloques'][number]>[] =
  [
    { key: 'dossier', header: 'Dossier', render: (d) => d.dossier },
    { key: 'etape', header: 'Étape', render: (d) => `${d.etape} sur 6` },
    { key: 'depuis', header: 'Depuis le', render: (d) => when(d.depuis) },
  ];

function Blocked({ rows }: { rows: PrefectoralReportContent['anomalies']['dossiersBloques'] }) {
  return (
    <DataTable
      caption="Dossiers sans décision depuis plus de 15 jours"
      columns={BLOCKED_COLUMNS}
      rows={rows}
      rowKey={(d) => d.dossier}
      empty="Aucun dossier bloqué."
    />
  );
}

function PrefectoralContent({ content }: { content: PrefectoralReportContent }) {
  return (
    <>
      <section>
        <h3>Activité du mois</h3>
        <Facts
          rows={[
            ['Nouveaux praticiens', content.activite.nouveauxPraticiens],
            ['Dossiers soumis', content.activite.dossiersSoumis],
            ['Visites réalisées', content.activite.visitesRealisees],
            ['Recettes numérisées', content.activite.recettesNumerisees],
            ['Praticiens publiés', content.activite.praticiensPublies],
          ]}
        />
      </section>
      <Delays title="Délais de la vérification sur le terrain (étape 2)" delays={content.delais} />
      <section>
        <h3>Anomalies</h3>
        <Facts
          rows={[
            ['Alertes territoriales ouvertes en fin de mois', content.anomalies.alertesOuvertes],
          ]}
        />
        <Blocked rows={content.anomalies.dossiersBloques} />
      </section>
      <section>
        <h3>Registre préfectoral</h3>
        <Facts
          rows={[
            ['Praticiens enregistrés', content.registre.enregistres],
            ['Praticiens certifiés', content.registre.certifies],
            ['En attente de certification', content.registre.enAttente],
          ]}
        />
      </section>
    </>
  );
}

const RECEIVED = {
  recu: { label: 'Reçu', tone: 'success' },
  renvoye: { label: 'Renvoyé', tone: 'warning' },
  manquant: { label: 'Manquant', tone: 'error' },
} as const;

const PREFECTURE_COLUMNS: Column<RegionalReportContent['prefectures'][number]>[] = [
  { key: 'prefecture', header: 'Préfecture', render: (p) => p.prefecture },
  {
    key: 'rapport',
    header: 'Rapport',
    render: (p) => (
      <Badge tone={RECEIVED[p.rapport].tone}>
        {RECEIVED[p.rapport].label}
        {p.version ? ` (v${p.version})` : ''}
      </Badge>
    ),
  },
  {
    key: 'soumis',
    header: 'Dossiers soumis',
    render: (p) => p.activite?.dossiersSoumis ?? '—',
    numeric: true,
  },
  {
    key: 'visites',
    header: 'Visites',
    render: (p) => p.activite?.visitesRealisees ?? '—',
    numeric: true,
  },
  {
    key: 'delai',
    header: 'Délai moyen étape 2',
    render: (p) =>
      p.delais?.moyenneJours == null ? '—' : `${String(p.delais.moyenneJours).replace('.', ',')} j`,
    numeric: true,
  },
  { key: 'commentaire', header: 'Commentaire', render: (p) => p.commentaire ?? '—' },
];

function RegionalContent({ content }: { content: RegionalReportContent }) {
  const { couverture } = content;
  return (
    <>
      <section>
        <h3>Activité du mois</h3>
        <Facts
          rows={[
            ['Litiges ouverts', content.activite.litigesOuverts],
            ['Litiges résolus', content.activite.litigesResolus],
            ['Traitements transmis au Comité', content.activite.traitementsTransmis],
            [
              'Couverture',
              `${couverture.couvertes} préfecture${couverture.couvertes > 1 ? 's' : ''} sur ${couverture.prefectures} avec un praticien certifié`,
            ],
          ]}
        />
      </section>
      <Delays title="Délais de la consolidation (étape 3)" delays={content.delais} />
      <section>
        <h3>Anomalies</h3>
        <Facts
          rows={[
            ['Alertes territoriales ouvertes en fin de mois', content.anomalies.alertesOuvertes],
            ['Rapports préfectoraux manquants', content.anomalies.rapportsManquants],
          ]}
        />
        <Blocked rows={content.anomalies.dossiersBloques} />
      </section>
      <DataTable
        caption="Rapports des préfectures"
        columns={PREFECTURE_COLUMNS}
        rows={content.prefectures}
        rowKey={(p) => p.prefecture}
        empty="Aucune préfecture active dans la région."
      />
    </>
  );
}

function CommentForm({
  report,
  recipient,
  onSaved,
  onSent,
}: {
  report: MonthlyReport;
  recipient: string;
  onSaved: () => void;
  onSent: () => void;
}) {
  const [text, setText] = useState(report.commentaire ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState<string>();

  async function save() {
    setBusy(true);
    setError(undefined);
    try {
      await commentReport(report.id, text);
      setSaved('Commentaire enregistré.');
      onSaved();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    setBusy(true);
    setError(undefined);
    try {
      // Le commentaire saisi part avec le rapport
      if (text !== (report.commentaire ?? '')) await commentReport(report.id, text);
      await sendReport(report.id, report.calculeLe);
      onSent();
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <section className="ui-decision" aria-label="Commentaire et envoi">
      {error && <Alert tone="error">{error}</Alert>}
      <TextAreaField
        label="Commentaire"
        hint="Ce que les chiffres ne disent pas : difficultés, actions engagées, besoins."
        value={text}
        maxLength={REPORT_COMMENT_MAX_LENGTH}
        onChange={(event) => setText(event.target.value)}
      />
      <p role="status" className="ui-live-status">
        {saved}
      </p>
      <div className="ui-form__actions">
        <Button variant="secondary" disabled={busy} onClick={save}>
          Enregistrer le commentaire
        </Button>
        <Button disabled={busy} onClick={send}>
          Envoyer à {recipient}
        </Button>
      </div>
    </section>
  );
}

function ReturnForm({ id, onDone }: { id: number; onDone: () => void }) {
  const titleId = useId();
  const [motif, setMotif] = useState('');
  const [motifError, setMotifError] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!motif.trim()) {
      setMotifError('Indiquez ce qui doit être revu.');
      return field.current?.focus();
    }
    setMotifError(undefined);
    setBusy(true);
    setError(undefined);
    try {
      await returnReport(id, motif.trim());
      onDone();
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <section className="ui-decision" aria-labelledby={titleId}>
      <h3 id={titleId} className="ui-decision__title">
        Renvoyer pour correction
      </h3>
      {error && <Alert tone="error">{error}</Alert>}
      <form className="ui-form" onSubmit={onSubmit} noValidate>
        <TextAreaField
          ref={field}
          label="Motif du renvoi"
          hint="L’auteur en est prévenu et prépare une nouvelle version ; celle-ci reste lisible."
          error={motifError}
          value={motif}
          maxLength={REPORT_MOTIF_MAX_LENGTH}
          required
          onChange={(event) => setMotif(event.target.value)}
        />
        <div className="ui-form__actions">
          <Button type="submit" variant="secondary" disabled={busy}>
            Renvoyer le rapport
          </Button>
        </div>
      </form>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Historique des exports
// ---------------------------------------------------------------------------------------------
const EXPORT_COLUMNS: Column<ExportEntry>[] = [
  { key: 'le', header: 'Date', render: (e) => when(e.le) },
  { key: 'objet', header: 'Document', render: (e) => e.objet },
  { key: 'format', header: 'Format', render: (e) => e.format.toUpperCase() },
  { key: 'auteur', header: 'Exporté par', render: (e) => e.auteur },
  {
    key: 'fichier',
    header: 'Fichier',
    render: (e) => (
      <a href={exportFileUrl(e.id)}>
        Télécharger{' '}
        <span className="ui-visually-hidden">
          {e.objet} en {e.format.toUpperCase()}
        </span>
      </a>
    ),
  },
];

function ExportHistory({ rows }: { rows: ExportEntry[] | null }) {
  return (
    <section className="ui-section" aria-labelledby="historique-exports">
      <h2 id="historique-exports">Historique des exports</h2>
      <p className="ui-muted">
        Chaque export garde les chiffres du moment où il a été fait : le fichier téléchargé de
        nouveau est identique.
      </p>
      {rows === null ? (
        <p aria-busy="true">Chargement…</p>
      ) : (
        <DataTable
          caption="Historique des exports"
          captionHidden
          columns={EXPORT_COLUMNS}
          rows={rows}
          rowKey={(e) => e.id}
          paginate={{ key: 'historique-exports', noun: ['export', 'exports'] }}
          empty="Aucun export pour l’instant."
        />
      )}
    </section>
  );
}
