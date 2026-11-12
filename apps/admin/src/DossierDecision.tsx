import { useEffect, useId, useRef, useState, type ComponentType, type FormEvent } from 'react';
import { Alert, Button, PageHeader, TextAreaField } from '@sabou/ui';
import type { ZonePage } from '@sabou/types';
import { ApiError } from './accounts-api';
import { decideDossier } from './certification-api';

// Éléments communs aux écrans de décision du workflow de certification (US-042 à l'étape 2,
// US-043 à l'étape 3) : file des dossiers de la zone, puis valider ou rejeter avec motif.

// Défini ici plutôt qu'importé de @sabou/types : l'application n'en importe que des types,
// pour ne pas embarquer zod dans le paquet téléchargé (réseau 3G)
const MOTIF_MAX_LENGTH = 1000;

const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : 'Une erreur est survenue.';

export const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { dateStyle: 'long' });

export type OnDecided = (code: string, notice: string) => void;

// Page d'une file de dossiers à décider : titre, annonce des décisions (lecteurs d'écran),
// liste paginée. Chaque page fournit l'affichage d'un dossier. Un dossier décidé quitte la
// file ; le focus revient au titre de la liste, pour ne pas le perdre avec l'élément retiré
// (clavier, lecteurs d'écran).
export function DossierQueuePage<T extends { code: string }>({
  title,
  lead,
  listTitle,
  empty,
  load,
  item: Item,
}: {
  title: string;
  lead: string;
  listTitle: string;
  empty: string;
  load: (after?: string) => Promise<ZonePage<T>>;
  item: ComponentType<{ dossier: T; onDecided: OnDecided }>;
}) {
  const [dossiers, setDossiers] = useState<T[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [loadingMore, setLoadingMore] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    load().then(
      (page) => {
        setDossiers(page.elements);
        setNext(page.suivant);
      },
      (error: unknown) => setLoadError(errorMessage(error)),
    );
    // `load` est une fonction du module certification-api, stable : un seul chargement
  }, [load]);

  async function loadMore() {
    if (!next) return;
    setLoadingMore(true);
    try {
      const page = await load(next);
      setDossiers((current) => [...(current ?? []), ...page.elements]);
      setNext(page.suivant);
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoadingMore(false);
    }
  }

  function onDecided(code: string, text: string) {
    setDossiers((current) => (current ?? []).filter((dossier) => dossier.code !== code));
    setNotice(text);
    heading.current?.focus();
  }

  return (
    <>
      <PageHeader title={title} lead={lead} />
      {loadError && <Alert tone="error">{loadError}</Alert>}
      <p role="status" className="ui-live-status">
        {notice}
      </p>
      {dossiers === null && !loadError && <p>Chargement…</p>}
      {dossiers !== null && (
        <section aria-labelledby="dossiers-title">
          <h2 id="dossiers-title" ref={heading} tabIndex={-1}>
            {listTitle}
          </h2>
          {dossiers.length === 0 && <p>{empty}</p>}
          {dossiers.length > 0 && (
            <ul className="ui-stack">
              {dossiers.map((dossier) => (
                <Item key={dossier.code} dossier={dossier} onDecided={onDecided} />
              ))}
            </ul>
          )}
          {next && (
            <div>
              <Button variant="secondary" disabled={loadingMore} onClick={loadMore}>
                Afficher les dossiers suivants
              </Button>
            </div>
          )}
        </section>
      )}
    </>
  );
}

// Valider, ou rejeter avec un motif obligatoire (R-CER-03). L'étape vue à l'écran est
// envoyée : si le dossier a bougé entre-temps, l'API refuse (05 §2.31).
export function DecisionActions({
  code,
  label,
  etape,
  canValidate,
  blockedReason,
  validatedNotice,
  rejectedNotice,
  rejectHint,
  onDecided,
}: {
  code: string;
  // Nom accessible du dossier, ajouté aux boutons répétés dans la liste
  label: string;
  etape: 2 | 3 | 4 | 5;
  canValidate: boolean;
  // Raison affichée quand la validation n'est pas encore possible
  blockedReason?: string;
  validatedNotice: string;
  rejectedNotice: string;
  rejectHint: string;
  onDecided: OnDecided;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [rejecting, setRejecting] = useState(false);
  const [motif, setMotif] = useState('');
  const [motifError, setMotifError] = useState<string>();
  const motifField = useRef<HTMLTextAreaElement>(null);
  const rejectButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (rejecting) motifField.current?.focus();
  }, [rejecting]);

  async function decide(decision: 'valide' | 'rejete', done: string) {
    setBusy(true);
    setError(undefined);
    try {
      await decideDossier(code, {
        etape,
        decision,
        ...(decision === 'rejete' ? { motif: motif.trim() } : {}),
      });
      onDecided(code, done);
    } catch (failure) {
      setError(errorMessage(failure));
      setBusy(false);
    }
  }

  function onReject(event: FormEvent) {
    event.preventDefault();
    if (!motif.trim()) {
      setMotifError('Indiquez le motif du rejet.');
      motifField.current?.focus();
      return;
    }
    setMotifError(undefined);
    void decide('rejete', rejectedNotice);
  }

  function cancelReject() {
    setRejecting(false);
    setMotif('');
    setMotifError(undefined);
    // Le bouton « Rejeter » réapparaît : le focus y revient
    setTimeout(() => rejectButton.current?.focus());
  }

  return (
    <>
      {error && <Alert tone="error">{error}</Alert>}
      {!canValidate && !rejecting && blockedReason && <p className="ui-muted">{blockedReason}</p>}
      {!rejecting && (
        <div className="ui-form__actions">
          {canValidate && (
            <Button
              variant="primary"
              icon="success"
              disabled={busy}
              onClick={() => decide('valide', validatedNotice)}
            >
              Valider <span className="ui-visually-hidden">le dossier {label}</span>
            </Button>
          )}
          <Button
            ref={rejectButton}
            variant="secondary"
            disabled={busy}
            onClick={() => setRejecting(true)}
          >
            Rejeter <span className="ui-visually-hidden">le dossier {label}</span>
          </Button>
        </div>
      )}
      {rejecting && (
        <form className="ui-form" onSubmit={onReject} noValidate aria-labelledby={`${id}-rejet`}>
          <h4 id={`${id}-rejet`}>Rejeter le dossier {code}</h4>
          <TextAreaField
            ref={motifField}
            label="Motif du rejet"
            hint={rejectHint}
            error={motifError}
            value={motif}
            maxLength={MOTIF_MAX_LENGTH}
            required
            onChange={(event) => setMotif(event.target.value)}
          />
          <div className="ui-form__actions">
            <Button type="submit" variant="danger" disabled={busy}>
              Confirmer le rejet
            </Button>
            <Button variant="tertiary" disabled={busy} onClick={cancelReject}>
              Annuler
            </Button>
          </div>
        </form>
      )}
    </>
  );
}
