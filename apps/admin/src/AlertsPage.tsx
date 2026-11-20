import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Alert, Badge, Button, PageHeader, SelectField, TextAreaField } from '@sabou/ui';
import type { AlertReferentials, TerritorialAlert } from '@sabou/types';
import { ApiError, call } from './accounts-api';
import { ALERT_STATUS, ALERT_TYPE } from './alert-labels';
import { DossierRow } from './DossierDecision';
import { PAGE_HEADERS } from './page-headers';

// Alertes territoriales (US-102, UC-44, R-MOD-04 ; 05 §2.89) : dossiers bloqués et déserts
// thérapeutiques détectés automatiquement, hausses de pathologie déclarées par le préfectoral
// ou la DG ; accusé de réception, relance des responsables, clôture motivée. Libellés dans
// alert-labels.ts (partagés avec le tableau de bord) : l'application n'importe que des types
// de @sabou/types (réseau 3G).

export type AlertRole = 'regional' | 'dg' | 'prefectoral';

const TEXT_MAX_LENGTH = 1000;
export const ALERTS_PATH = '/api/alertes';

const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : 'Une erreur est survenue.';

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });

const TYPE = ALERT_TYPE;
const STATUS = ALERT_STATUS;

export function RegionalAlertsPage() {
  return <AlertsPage role="regional" />;
}
export function DirectorAlertsPage() {
  return <AlertsPage role="dg" />;
}
export function PrefectoralAlertsPage() {
  return <AlertsPage role="prefectoral" />;
}

function AlertsPage({ role }: { role: AlertRole }) {
  const [items, setItems] = useState<TerritorialAlert[] | null>(null);
  const [loadError, setLoadError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const heading = useRef<HTMLHeadingElement>(null);

  const load = () =>
    call<TerritorialAlert[]>(ALERTS_PATH).then(setItems, (error: unknown) =>
      setLoadError(errorMessage(error)),
    );

  useEffect(() => {
    void load();
  }, []);

  function done(text: string) {
    setNotice(text);
    heading.current?.focus();
    void load();
  }

  return (
    <>
      <PageHeader {...PAGE_HEADERS['/alertes']} />
      {loadError && <Alert tone="error">{loadError}</Alert>}
      <p role="status" className="ui-live-status">
        {notice}
      </p>
      {role !== 'regional' && <DeclareForm onDone={done} />}
      {items === null && !loadError && <p>Chargement…</p>}
      {items !== null && (
        <section className="ui-section" aria-labelledby="alertes-titre">
          <div className="ui-list-title">
            <h2 id="alertes-titre" ref={heading} tabIndex={-1}>
              Alertes ouvertes
            </h2>
            <span className="ui-tabs__count">
              {items.length}
              <span className="ui-visually-hidden"> {items.length > 1 ? 'alertes' : 'alerte'}</span>
            </span>
          </div>
          {items.length === 0 && <p>Aucune alerte ouverte.</p>}
          {items.length > 0 && (
            <ul className="ui-dossiers">
              {items.map((item) => (
                <AlertRow key={item.id} item={item} role={role} onDone={done} />
              ))}
            </ul>
          )}
        </section>
      )}
    </>
  );
}

function AlertRow({
  item,
  role,
  onDone,
}: {
  item: TerritorialAlert;
  role: AlertRole;
  onDone: (text: string) => void;
}) {
  const status = STATUS[item.statut];
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const where = item.prefecture ?? item.region;

  async function act(path: string, text: (body: unknown) => string, body?: unknown) {
    setBusy(true);
    setError(undefined);
    try {
      const result = await call<unknown>(`${ALERTS_PATH}/${item.id}/${path}`, body ?? {});
      onDone(text(result));
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <DossierRow
      code={`AL-${item.id}`}
      name={`${TYPE[item.type]} · ${where}`}
      meta={
        <>
          <Badge tone={status.tone}>{status.label}</Badge> · signalée le {dateTime(item.creeLe)}
          {item.relances > 0 && ` · relancée ${item.relances} fois`}
        </>
      }
    >
      <dl className="ui-facts">
        <dt>Territoire</dt>
        <dd>
          {item.prefecture ? `${item.prefecture} · ` : ''}région de {item.region}
        </dd>
        {item.maladie && (
          <>
            <dt>Maladie</dt>
            <dd>{item.maladie}</dd>
          </>
        )}
        {item.dossier && (
          <>
            <dt>Dossier</dt>
            <dd>{item.dossier}</dd>
          </>
        )}
        <dt>Constat</dt>
        <dd>{item.description}</dd>
        {item.accuseeLe && (
          <>
            <dt>Accusé de réception</dt>
            <dd>{dateTime(item.accuseeLe)}</dd>
          </>
        )}
        {item.relanceeLe && (
          <>
            <dt>Dernière relance</dt>
            <dd>{dateTime(item.relanceeLe)}</dd>
          </>
        )}
      </dl>
      {error && <Alert tone="error">{error}</Alert>}
      <div className="ui-form__actions">
        {item.statut !== 'accusee' && (
          <Button
            disabled={busy}
            onClick={() =>
              act('accuse', () => `Accusé de réception donné pour l’alerte AL-${item.id}.`)
            }
          >
            Accuser réception <span className="ui-visually-hidden">de l’alerte AL-{item.id}</span>
          </Button>
        )}
        {role !== 'prefectoral' && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              act('relance', (result) => {
                const n = (result as { prevenus: number }).prevenus;
                return `Alerte AL-${item.id} relancée : ${n} responsable${n > 1 ? 's' : ''} prévenu${n > 1 ? 's' : ''} dans l’application.`;
              })
            }
          >
            Relancer <span className="ui-visually-hidden">l’alerte AL-{item.id}</span>
          </Button>
        )}
      </div>
      {role !== 'prefectoral' && <CloseForm id={item.id} onDone={onDone} />}
    </DossierRow>
  );
}

function CloseForm({ id, onDone }: { id: number; onDone: (text: string) => void }) {
  const titleId = useId();
  const [motif, setMotif] = useState('');
  const [motifError, setMotifError] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!motif.trim()) {
      setMotifError('Indiquez le motif de la clôture.');
      return field.current?.focus();
    }
    setMotifError(undefined);
    setBusy(true);
    setError(undefined);
    try {
      await call<void>(`${ALERTS_PATH}/${id}/cloture`, { motif: motif.trim() });
      onDone(`Alerte AL-${id} close.`);
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  return (
    <section className="ui-decision" aria-labelledby={titleId}>
      <h4 id={titleId} className="ui-decision__title">
        Clôture
      </h4>
      {error && <Alert tone="error">{error}</Alert>}
      <form className="ui-form" onSubmit={onSubmit} noValidate>
        <TextAreaField
          ref={field}
          label="Motif de la clôture"
          hint="Ce qui a été fait. Les dossiers bloqués et les déserts se closent aussi d’eux-mêmes une fois résolus."
          error={motifError}
          value={motif}
          maxLength={TEXT_MAX_LENGTH}
          required
          onChange={(event) => setMotif(event.target.value)}
        />
        <div className="ui-form__actions">
          <Button type="submit" disabled={busy}>
            Clore l’alerte <span className="ui-visually-hidden">AL-{id}</span>
          </Button>
        </div>
      </form>
    </section>
  );
}

// Hausse de pathologie : préfectoral (sa préfecture) ou DG
function DeclareForm({ onDone }: { onDone: (text: string) => void }) {
  const titleId = useId();
  const [refs, setRefs] = useState<AlertReferentials>();
  const [prefecture, setPrefecture] = useState('');
  const [maladie, setMaladie] = useState('');
  const [description, setDescription] = useState('');
  const [errors, setErrors] = useState<{
    prefecture?: string;
    maladie?: string;
    description?: string;
  }>({});
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    call<AlertReferentials>(`${ALERTS_PATH}/referentiels`).then(
      (r) => {
        setRefs(r);
        if (r.prefectures.length === 1) setPrefecture(String(r.prefectures[0]!.id));
      },
      (failure: unknown) => setError(errorMessage(failure)),
    );
  }, []);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const next = {
      ...(prefecture ? {} : { prefecture: 'Choisissez la préfecture.' }),
      ...(maladie ? {} : { maladie: 'Choisissez la maladie.' }),
      ...(description.trim() ? {} : { description: 'Décrivez la hausse constatée.' }),
    };
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setBusy(true);
    setError(undefined);
    try {
      await call<{ id: number }>(ALERTS_PATH, {
        prefectureId: Number(prefecture),
        maladie,
        description: description.trim(),
      });
      setDescription('');
      setMaladie('');
      onDone('Hausse de pathologie déclarée : le régional la voit dans ses alertes.');
    } catch (failure) {
      setError(errorMessage(failure));
    }
    setBusy(false);
  }

  return (
    <section className="ui-section" aria-labelledby={titleId}>
      <h2 id={titleId}>Déclarer une hausse de pathologie</h2>
      {error && <Alert tone="error">{error}</Alert>}
      <form className="ui-form" onSubmit={onSubmit} noValidate>
        <SelectField
          label="Préfecture"
          error={errors.prefecture}
          value={prefecture}
          required
          onChange={(event) => setPrefecture(event.target.value)}
        >
          <option value="">Choisir…</option>
          {refs?.prefectures.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nom}
            </option>
          ))}
        </SelectField>
        <SelectField
          label="Maladie"
          error={errors.maladie}
          value={maladie}
          required
          onChange={(event) => setMaladie(event.target.value)}
        >
          <option value="">Choisir…</option>
          {refs?.maladies.map((m) => (
            <option key={m.code} value={m.code}>
              {m.nomFr}
            </option>
          ))}
        </SelectField>
        <TextAreaField
          label="Ce qui est constaté"
          hint="Nombre de cas, période, localités : ce qui permet au régional de réagir."
          error={errors.description}
          value={description}
          maxLength={TEXT_MAX_LENGTH}
          required
          onChange={(event) => setDescription(event.target.value)}
        />
        <div className="ui-form__actions">
          <Button type="submit" disabled={busy}>
            Déclarer l’alerte
          </Button>
        </div>
      </form>
    </section>
  );
}
