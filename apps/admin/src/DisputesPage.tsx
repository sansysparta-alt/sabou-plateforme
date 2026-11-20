import { useId, useRef, useState, type FormEvent } from 'react';
import { Alert, Badge, Button, FileButton, SelectField, TextAreaField } from '@sabou/ui';
import type {
  DisputeDetail,
  DisputeIssue,
  DisputeOpinion,
  DisputeStatus,
  DisputeSummary,
} from '@sabou/types';
import { ApiError } from './accounts-api';
import {
  DossierQueuePage,
  DossierRow,
  longDate,
  type Announce,
  type OnDecided,
} from './DossierDecision';
import {
  addDisputePiece,
  decideDispute,
  disputePieceUrl,
  fetchDispute,
  giveDisputeOpinion,
  listDisputes,
  sendDisputeMessage,
} from './disputes-api';
import { PAGE_HEADERS } from './page-headers';
import { QUEUES } from './queues';

// Litiges et recours (US-101, UC-43, R-MOD-01, R-CER-04 ; 05 §2.88). Le régional instruit
// (échanges, pièces), arbitre les litiges ordinaires et rend un avis motivé sur les recours ;
// la DG décide des recours après cet avis. Libellés définis ici : l'application n'importe que
// des types de @sabou/types (réseau 3G).

export type DisputeRole = 'regional' | 'dg';

const TEXT_MAX_LENGTH = 2000;
const ACCEPT = 'image/jpeg,image/png,application/pdf';

const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : 'Une erreur est survenue.';

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });

const STATUS: Record<DisputeStatus, { label: string; tone: 'warning' | 'neutral' | 'success' }> = {
  ouvert: { label: 'Ouvert', tone: 'warning' },
  en_arbitrage: { label: 'En arbitrage', tone: 'neutral' },
  avis_rendu: { label: 'Avis rendu, décision de la DG', tone: 'neutral' },
  resolu: { label: 'Résolu', tone: 'success' },
};

const AUTHOR = {
  praticien: 'Praticien',
  regional: 'Administration régionale',
  dg: 'Direction Générale',
};

const OPINION: Record<DisputeOpinion, string> = {
  favorable: 'Favorable au recours',
  defavorable: 'Défavorable au recours',
};

const MIME: Record<string, string> = {
  'image/jpeg': 'Photo',
  'image/png': 'Image',
  'application/pdf': 'Document PDF',
};

export function RegionalDisputesPage() {
  return <DisputesPage role="regional" />;
}

export function DirectorDisputesPage() {
  return <DisputesPage role="dg" />;
}

function DisputesPage({ role }: { role: DisputeRole }) {
  return (
    <DossierQueuePage
      {...PAGE_HEADERS['/litiges']}
      listTitle={role === 'dg' ? 'Recours en cours' : 'Litiges à arbitrer'}
      empty={role === 'dg' ? 'Aucun recours en cours.' : 'Aucun litige en cours.'}
      queue={QUEUES.disputes}
      load={listDisputes}
      item={({ dossier, onDecided, announce }) => (
        <DisputeRow dispute={dossier} role={role} onDecided={onDecided} announce={announce} />
      )}
      words={{
        one: 'litige',
        many: 'litiges',
        searchLabel: 'Rechercher un litige',
        placeholder: 'Code (LT-00001), nom du praticien ou objet',
        none: 'Aucun litige ne correspond.',
      }}
    />
  );
}

function DisputeRow({
  dispute,
  role,
  onDecided,
  announce,
}: {
  dispute: DisputeSummary;
  role: DisputeRole;
  onDecided: OnDecided;
  announce: Announce;
}) {
  const [detail, setDetail] = useState<DisputeDetail>();
  const [loadError, setLoadError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const status = STATUS[dispute.statut];

  // Détail chargé à l'ouverture seulement (réseau 3G), rechargé après chaque action
  const load = () =>
    fetchDispute(dispute.code).then(setDetail, (error: unknown) =>
      setLoadError(errorMessage(error)),
    );
  const done = (text: string) => {
    setNotice(text);
    announce(text);
    return load();
  };

  return (
    <DossierRow
      code={dispute.code}
      name={`${dispute.praticienNom} · ${dispute.objet}`}
      notice={notice}
      onOpen={load}
      meta={
        <>
          <Badge tone={dispute.type === 'recours' ? 'error' : 'neutral'}>
            {dispute.type === 'recours' ? 'Recours' : 'Litige'}
          </Badge>{' '}
          <Badge tone={status.tone}>{status.label}</Badge> · {dispute.prefecture} · ouvert le{' '}
          {dateTime(dispute.ouvertLe)}
        </>
      }
    >
      {loadError && <Alert tone="error">{loadError}</Alert>}
      {!detail && !loadError && <p>Chargement du litige…</p>}
      {detail && (
        <>
          <dl className="ui-facts">
            <dt>Praticien</dt>
            <dd>
              {detail.praticienNom} ({detail.praticien}) · {detail.prefecture}
            </dd>
            <dt>Objet</dt>
            <dd>{detail.objet}</dd>
            {detail.type === 'recours' && (
              <>
                <dt>Rejet contesté</dt>
                <dd>{detail.rejetMotif ?? '—'}</dd>
                <dt>Recours possible jusqu’au</dt>
                <dd>{detail.recoursJusquau ? longDate(detail.recoursJusquau) : '—'}</dd>
              </>
            )}
            {detail.avis && detail.avisSens && (
              <>
                <dt>Avis du régional</dt>
                <dd>
                  {OPINION[detail.avisSens]} : {detail.avis}
                </dd>
              </>
            )}
          </dl>
          <Exchanges detail={detail} onDone={done} />
          {role === 'regional' &&
            detail.type === 'recours' &&
            (detail.statut === 'ouvert' || detail.statut === 'en_arbitrage') && (
              <OpinionForm
                code={detail.code}
                onDone={(text) => {
                  onDecided(detail.code, text);
                }}
              />
            )}
          {((role === 'regional' &&
            detail.type === 'autre' &&
            (detail.statut === 'ouvert' || detail.statut === 'en_arbitrage')) ||
            (role === 'dg' && detail.type === 'recours' && detail.statut === 'avis_rendu')) && (
            <DecisionForm detail={detail} onDecided={onDecided} />
          )}
        </>
      )}
    </DossierRow>
  );
}

// Échanges et pièces : lecture, message, dépôt d'une pièce
function Exchanges({
  detail,
  onDone,
}: {
  detail: DisputeDetail;
  onDone: (text: string) => Promise<void>;
}) {
  const id = useId();
  const [text, setText] = useState('');
  const [error, setError] = useState<string>();
  const [fieldError, setFieldError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim()) {
      setFieldError('Écrivez votre message.');
      return field.current?.focus();
    }
    setFieldError(undefined);
    setBusy(true);
    setError(undefined);
    try {
      await sendDisputeMessage(detail.code, text.trim());
      setText('');
      await onDone('Message envoyé ; le praticien est prévenu par SMS.');
    } catch (failure) {
      setError(errorMessage(failure));
    }
    setBusy(false);
  }

  async function deposit(file: File) {
    setBusy(true);
    setError(undefined);
    try {
      await addDisputePiece(detail.code, file);
      await onDone('Pièce jointe au litige.');
    } catch (failure) {
      setError(errorMessage(failure));
    }
    setBusy(false);
  }

  return (
    <section aria-labelledby={`${id}-echanges`}>
      <h4 id={`${id}-echanges`}>Échanges</h4>
      <ol className="ui-thread">
        {detail.messages.map((message) => (
          <li key={message.id}>
            <p className="ui-thread__meta">
              <strong>{AUTHOR[message.auteur]}</strong> · {message.auteurNom} ·{' '}
              {dateTime(message.le)}
            </p>
            <p className="ui-prose">{message.contenu}</p>
          </li>
        ))}
      </ol>
      <h4>Pièces</h4>
      {detail.pieces.length === 0 ? (
        <p>Aucune pièce jointe.</p>
      ) : (
        <ul>
          {detail.pieces.map((piece) => (
            <li key={piece.id}>
              <a href={disputePieceUrl(detail.code, piece.id)} download>
                {MIME[piece.mime] ?? 'Fichier'} n° {piece.id}
              </a>{' '}
              · {piece.parPraticien ? 'déposée par le praticien' : 'déposée par l’administration'} ·{' '}
              {Math.ceil(piece.taille / 1024)} Ko · {dateTime(piece.deposeLe)}
            </li>
          ))}
        </ul>
      )}
      {error && <Alert tone="error">{error}</Alert>}
      {detail.statut !== 'resolu' && (
        <form className="ui-form" onSubmit={onSubmit} noValidate>
          <TextAreaField
            ref={field}
            label="Votre message au praticien"
            hint="Le praticien est prévenu par SMS et lit le message dans son application."
            error={fieldError}
            value={text}
            maxLength={TEXT_MAX_LENGTH}
            required
            onChange={(event) => setText(event.target.value)}
          />
          <div className="ui-form__actions">
            <Button type="submit" disabled={busy}>
              Envoyer le message
            </Button>
            <FileButton
              accept={ACCEPT}
              disabled={busy}
              onFile={deposit}
              describedBy={`${id}-formats`}
            >
              Joindre une pièce
            </FileButton>
          </div>
          <p id={`${id}-formats`} className="ui-field__hint">
            Photo JPEG ou PNG, ou document PDF, 5 Mo au plus ; dix pièces au plus par litige.
          </p>
        </form>
      )}
    </section>
  );
}

// Avis motivé du régional sur un recours : le recours passe ensuite à la DG
function OpinionForm({ code, onDone }: { code: string; onDone: (text: string) => void }) {
  const id = useId();
  const [sens, setSens] = useState<DisputeOpinion | ''>('');
  const [avis, setAvis] = useState('');
  const [errors, setErrors] = useState<{ sens?: string; avis?: string }>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const sensField = useRef<HTMLSelectElement>(null);
  const avisField = useRef<HTMLTextAreaElement>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const next = {
      ...(sens ? {} : { sens: 'Choisissez le sens de l’avis.' }),
      ...(avis.trim() ? {} : { avis: 'Motivez votre avis.' }),
    };
    setErrors(next);
    if (next.sens) return sensField.current?.focus();
    if (next.avis) return avisField.current?.focus();
    setBusy(true);
    setError(undefined);
    try {
      await giveDisputeOpinion(code, { sens: sens as DisputeOpinion, avis: avis.trim() });
      onDone(`Avis rendu sur le recours ${code} : il passe à la décision de la DG.`);
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <section className="ui-decision" aria-labelledby={`${id}-titre`}>
      <h4 id={`${id}-titre`} className="ui-decision__title">
        Avis motivé sur le recours
      </h4>
      {error && <Alert tone="error">{error}</Alert>}
      <form className="ui-form" onSubmit={onSubmit} noValidate>
        <SelectField
          ref={sensField}
          label="Sens de l’avis"
          error={errors.sens}
          value={sens}
          required
          onChange={(event) => setSens(event.target.value as DisputeOpinion | '')}
        >
          <option value="">Choisir…</option>
          <option value="favorable">{OPINION.favorable}</option>
          <option value="defavorable">{OPINION.defavorable}</option>
        </SelectField>
        <TextAreaField
          ref={avisField}
          label="Motivation"
          hint="Lue par la DG, qui décide du recours."
          error={errors.avis}
          value={avis}
          maxLength={TEXT_MAX_LENGTH}
          required
          onChange={(event) => setAvis(event.target.value)}
        />
        <div className="ui-form__actions">
          <Button type="submit" disabled={busy}>
            Rendre l’avis <span className="ui-visually-hidden">sur le recours {code}</span>
          </Button>
        </div>
      </form>
    </section>
  );
}

// Décision motivée : litige ordinaire (régional) ou recours (DG, après l'avis)
function DecisionForm({ detail, onDecided }: { detail: DisputeDetail; onDecided: OnDecided }) {
  const id = useId();
  const recourse = detail.type === 'recours';
  const [issue, setIssue] = useState<DisputeIssue | ''>('');
  const [motif, setMotif] = useState('');
  const [errors, setErrors] = useState<{ issue?: string; motif?: string }>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const issueField = useRef<HTMLSelectElement>(null);
  const motifField = useRef<HTMLTextAreaElement>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const next = {
      ...(issue ? {} : { issue: 'Choisissez la décision.' }),
      ...(motif.trim() ? {} : { motif: 'Motivez la décision.' }),
    };
    setErrors(next);
    if (next.issue) return issueField.current?.focus();
    if (next.motif) return motifField.current?.focus();
    setBusy(true);
    setError(undefined);
    try {
      const result = await decideDispute(detail.code, {
        issue: issue as DisputeIssue,
        motif: motif.trim(),
      });
      const word = issue === 'accepte' ? 'accepté' : 'refusé';
      onDecided(
        detail.code,
        `${recourse ? 'Recours' : 'Litige'} ${detail.code} ${word} ; le praticien est prévenu par SMS.` +
          (result.certificat ? ` Nouveau certificat : ${result.certificat}.` : ''),
      );
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <section className="ui-decision" aria-labelledby={`${id}-titre`}>
      <h4 id={`${id}-titre`} className="ui-decision__title">
        {recourse ? 'Décision sur le recours' : 'Décision'}
      </h4>
      {error && <Alert tone="error">{error}</Alert>}
      <form className="ui-form" onSubmit={onSubmit} noValidate>
        <SelectField
          ref={issueField}
          label="Votre décision"
          hint={
            recourse && issue === 'accepte'
              ? 'Le praticien est rétabli, ses traitements suspendus reviennent en ligne et, s’il était certifié, un nouveau certificat signé est émis (l’ancien reste révoqué).'
              : undefined
          }
          error={errors.issue}
          value={issue}
          required
          onChange={(event) => setIssue(event.target.value as DisputeIssue | '')}
        >
          <option value="">Choisir…</option>
          <option value="accepte">
            {recourse ? 'Accepter le recours' : 'Donner raison au praticien'}
          </option>
          <option value="refuse">{recourse ? 'Refuser le recours' : 'Rejeter la demande'}</option>
        </SelectField>
        <TextAreaField
          ref={motifField}
          label="Motif"
          hint="Lu par le praticien dans son application ; le SMS dit seulement la décision."
          error={errors.motif}
          value={motif}
          maxLength={TEXT_MAX_LENGTH}
          required
          onChange={(event) => setMotif(event.target.value)}
        />
        <div className="ui-form__actions">
          <Button type="submit" disabled={busy}>
            Enregistrer la décision{' '}
            <span className="ui-visually-hidden">sur le litige {detail.code}</span>
          </Button>
        </div>
      </form>
    </section>
  );
}
