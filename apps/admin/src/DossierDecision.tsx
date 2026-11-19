import { useEffect, useId, useRef, useState, type ComponentType, type FormEvent } from 'react';
import {
  Alert,
  Button,
  ListToolbar,
  PageHeader,
  Pagination,
  SearchBox,
  TextAreaField,
  useDebounced,
  usePageSize,
} from '@sabou/ui';
import type { ZonePage } from '@sabou/types';
import { ApiError } from './accounts-api';
import { decideDossier } from './certification-api';
import { queueKey, type QueuePath } from './queues';

// Éléments communs aux écrans de décision du workflow de certification (US-042 à l'étape 2,
// US-043 à l'étape 3, US-044 à l'étape 4) : file des dossiers de la zone, puis valider ou rejeter avec motif.

// Défini ici plutôt qu'importé de @sabou/types : l'application n'en importe que des types,
// pour ne pas embarquer zod dans le paquet téléchargé (réseau 3G)
const MOTIF_MAX_LENGTH = 1000;

const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : 'Une erreur est survenue.';

export const longDate = (iso: string) =>
  new Date(iso).toLocaleDateString('fr-FR', { dateStyle: 'long' });

export type OnDecided = (code: string, notice: string) => void;
// Annonce un changement sans retirer le dossier (visite planifiée, compte rendu signé)
export type Announce = (notice: string) => void;

// Page d'une file de dossiers à décider : titre, annonce des décisions (lecteurs d'écran),
// liste paginée par l'API (US-019b : pagination commune, taille de page mémorisée par file).
// Chaque page fournit l'affichage d'un dossier. Un dossier décidé quitte la file aussitôt, puis
// la page est relue pour la compléter ; le focus revient au titre de la liste, pour ne pas le
// perdre avec l'élément retiré (clavier, lecteurs d'écran).
// Libellés propres aux éléments de la file (dossiers par défaut, traitements pour US-061)
export interface QueueWords {
  one: string;
  many: string;
  searchLabel: string;
  placeholder: string;
  none: string;
}
const DOSSIER_WORDS: QueueWords = {
  one: 'dossier',
  many: 'dossiers',
  searchLabel: 'Rechercher un dossier',
  placeholder: 'Code du dossier (DS-2001) ou nom du praticien',
  none: 'Aucun dossier ne correspond.',
};

export function DossierQueuePage<T extends { code: string }>({
  title,
  lead,
  listTitle,
  empty,
  queue,
  load,
  item: Item,
  words = DOSSIER_WORDS,
}: {
  title: string;
  lead: string;
  listTitle: string;
  empty: string;
  queue: QueuePath;
  words?: QueueWords;
  load: (page: number, size: number, q?: string) => Promise<ZonePage<T>>;
  item: ComponentType<{ dossier: T; onDecided: OnDecided; announce: Announce }>;
}) {
  const [pageSize, setPageSize] = usePageSize(queueKey(queue));
  const [page, setPage] = useState(0);
  // Recherche par code ou nom du praticien, envoyée à l'API une fois la frappe arrêtée ; une
  // nouvelle recherche ramène à la première page (calculé pendant le rendu, sans effet)
  const [query, setQuery] = useState('');
  const searched = useDebounced(query.trim());
  const [lastSearched, setLastSearched] = useState(searched);
  if (lastSearched !== searched) {
    setLastSearched(searched);
    setPage(0);
  }
  // Compteur de relectures : une décision relit la page courante
  const [reads, setReads] = useState(0);
  const [result, setResult] = useState<ZonePage<T> | null>(null);
  const [loadError, setLoadError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  // Demande en cours : sa clé diffère de celle de la dernière réponse reçue (sans état de
  // chargement modifié dans l'effet)
  const requestKey = `${page}|${pageSize}|${searched}|${reads}`;
  const [answeredKey, setAnsweredKey] = useState<string>();
  const loading = answeredKey !== requestKey;
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let current = true;
    load(page, pageSize, searched).then(
      (next) => {
        if (!current) return;
        // Page devenue vide (derniers dossiers décidés) : retour à la dernière page qui existe
        const lastPage = Math.max(0, Math.ceil(next.total / pageSize) - 1);
        if (next.elements.length === 0 && page > lastPage) {
          setPage(lastPage);
          return;
        }
        setResult(next);
        setLoadError(undefined);
        setAnsweredKey(requestKey);
      },
      (error: unknown) => {
        if (!current) return;
        setLoadError(errorMessage(error));
        setAnsweredKey(requestKey);
      },
    );
    return () => {
      current = false;
    };
    // `load` est une fonction du module certification-api, stable
  }, [load, page, pageSize, searched, reads, requestKey]);

  function onDecided(code: string, text: string) {
    setResult(
      (current) =>
        current && {
          ...current,
          elements: current.elements.filter((dossier) => dossier.code !== code),
          total: Math.max(0, current.total - 1),
        },
    );
    setNotice(text);
    heading.current?.focus();
    setReads((n) => n + 1);
  }

  // Changement de page : le focus remonte au titre de la liste, lu par les lecteurs d'écran
  function goTo(next: number) {
    setPage(next);
    heading.current?.focus();
  }

  const dossiers = result?.elements ?? [];
  const total = result?.total ?? 0;
  return (
    <>
      <PageHeader title={title} lead={lead} />
      {loadError && <Alert tone="error">{loadError}</Alert>}
      <p role="status" className="ui-live-status">
        {notice}
      </p>
      {result === null && !loadError && <p>Chargement…</p>}
      {result !== null && (
        <section className="ui-section" aria-labelledby="dossiers-title" aria-busy={loading}>
          <div className="ui-list-title">
            <h2 id="dossiers-title" ref={heading} tabIndex={-1}>
              {listTitle}
            </h2>
            <span className="ui-tabs__count">
              {total}
              <span className="ui-visually-hidden"> {total > 1 ? words.many : words.one}</span>
            </span>
          </div>
          {(total > 0 || searched) && (
            <ListToolbar>
              <SearchBox
                label={words.searchLabel}
                placeholder={words.placeholder}
                value={query}
                onChange={setQuery}
              />
            </ListToolbar>
          )}
          {total === 0 && <p>{searched ? words.none : empty}</p>}
          {/* La liste et sa pagination forment un seul bloc */}
          <div>
            {dossiers.length > 0 && (
              <ul className="ui-dossiers">
                {dossiers.map((dossier) => (
                  <Item
                    key={dossier.code}
                    dossier={dossier}
                    onDecided={onDecided}
                    announce={setNotice}
                  />
                ))}
              </ul>
            )}
            <Pagination
              total={total}
              page={page}
              pageSize={pageSize}
              onPage={goTo}
              onPageSize={(size) => {
                setPageSize(size);
                goTo(0);
              }}
              noun={[words.one, words.many]}
              label={`Pages : ${listTitle}`}
            />
          </div>
        </section>
      )}
    </>
  );
}

// Ligne de dossier repliable : composant commun (DossierRow.tsx)
export { DossierRow } from './DossierRow';

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
  submit,
  noun = 'dossier',
  validateLabel = 'Valider',
}: {
  code: string;
  // Nom accessible du dossier, ajouté aux boutons répétés dans la liste
  label: string;
  etape?: 2 | 3 | 4 | 5;
  // Envoi de la décision ; par défaut, celle d'un dossier à l'étape `etape`
  submit?: (decision: 'valide' | 'rejete', motif?: string) => Promise<unknown>;
  // Objet décidé, dans les libellés (« le dossier », « le traitement »)
  noun?: string;
  validateLabel?: string;
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
      const reason = decision === 'rejete' ? motif.trim() : undefined;
      if (submit) await submit(decision, reason);
      else
        await decideDossier(code, {
          etape: etape!,
          decision,
          ...(reason !== undefined ? { motif: reason } : {}),
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

  const decisionId = useId();
  return (
    // Zone « Décision », séparée du détail du dossier (panneau, 05 §2.76)
    <section className="ui-decision" aria-labelledby={`${decisionId}-titre`}>
      <h4 id={`${decisionId}-titre`} className="ui-decision__title">
        Décision
      </h4>
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
              {validateLabel}{' '}
              <span className="ui-visually-hidden">
                le {noun} {label}
              </span>
            </Button>
          )}
          <Button
            ref={rejectButton}
            variant="secondary"
            disabled={busy}
            onClick={() => setRejecting(true)}
          >
            Rejeter{' '}
            <span className="ui-visually-hidden">
              le {noun} {label}
            </span>
          </Button>
        </div>
      )}
      {rejecting && (
        <form className="ui-form" onSubmit={onReject} noValidate aria-labelledby={`${id}-rejet`}>
          <h4 id={`${id}-rejet`}>
            Rejeter le {noun} {code}
          </h4>
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
    </section>
  );
}
