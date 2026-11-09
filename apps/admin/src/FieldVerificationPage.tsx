import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Alert, Badge, Button, PageHeader, TextAreaField } from '@sabou/ui';
import type { FieldVerificationItem } from '@sabou/types';
import { ApiError } from './accounts-api';
import { decideDossier, listFieldVerification } from './certification-api';

// Défini ici plutôt qu'importé de @sabou/types : l'application n'en importe que des types,
// pour ne pas embarquer zod dans le paquet téléchargé (réseau 3G)
const MOTIF_MAX_LENGTH = 1000;

const message = (error: unknown) =>
  error instanceof ApiError ? error.message : 'Une erreur est survenue.';

const date = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { dateStyle: 'long' });

// Vérification terrain par l'admin préfectoral (US-042, UC-31) : dossiers de sa préfecture
// à l'étape 2, validation après la visite, ou rejet motivé qui renvoie le dossier au praticien
export function FieldVerificationPage() {
  const [dossiers, setDossiers] = useState<FieldVerificationItem[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [loadingMore, setLoadingMore] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    listFieldVerification().then(
      (page) => {
        setDossiers(page.elements);
        setNext(page.suivant);
      },
      (error: unknown) => setLoadError(message(error)),
    );
  }, []);

  async function loadMore() {
    if (!next) return;
    setLoadingMore(true);
    try {
      const page = await listFieldVerification(next);
      setDossiers((current) => [...(current ?? []), ...page.elements]);
      setNext(page.suivant);
    } catch (error) {
      setLoadError(message(error));
    } finally {
      setLoadingMore(false);
    }
  }

  // Dossier décidé : il quitte la liste ; le focus revient au titre de la liste, pour ne pas
  // le perdre avec l'élément retiré (clavier, lecteurs d'écran)
  function onDecided(code: string, text: string) {
    setDossiers((current) => (current ?? []).filter((dossier) => dossier.code !== code));
    setNotice(text);
    heading.current?.focus();
  }

  return (
    <>
      <PageHeader
        title="Vérification terrain"
        lead="Dossiers soumis dans votre préfecture, en attente de votre décision. Délai cible : 3 jours par dossier."
      />
      {loadError && <Alert tone="error">{loadError}</Alert>}
      <p role="status" className="ui-live-status">
        {notice}
      </p>
      {dossiers === null && !loadError && <p>Chargement…</p>}
      {dossiers !== null && (
        <section aria-labelledby="dossiers-title">
          <h2 id="dossiers-title" ref={heading} tabIndex={-1}>
            Dossiers à vérifier
          </h2>
          {dossiers.length === 0 && <p>Aucun dossier en attente de vérification.</p>}
          {dossiers.length > 0 && (
            <ul className="ui-stack">
              {dossiers.map((dossier) => (
                <DossierItem key={dossier.code} dossier={dossier} onDecided={onDecided} />
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

function DossierItem({
  dossier,
  onDecided,
}: {
  dossier: FieldVerificationItem;
  onDecided: (code: string, notice: string) => void;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [rejecting, setRejecting] = useState(false);
  const [motif, setMotif] = useState('');
  const [motifError, setMotifError] = useState<string>();
  const motifField = useRef<HTMLTextAreaElement>(null);
  const rejectButton = useRef<HTMLButtonElement>(null);
  // Un dossier initial exige toujours une visite ; un renouvellement, selon le risque (R-QR-07)
  const canValidate = dossier.visiteRealisee || !dossier.visiteRequise;
  const label = `${dossier.code}, ${dossier.praticienNom}`;

  useEffect(() => {
    if (rejecting) motifField.current?.focus();
  }, [rejecting]);

  async function decide(decision: 'valide' | 'rejete', done: string) {
    setBusy(true);
    setError(undefined);
    try {
      await decideDossier(dossier.code, {
        etape: 2,
        decision,
        ...(decision === 'rejete' ? { motif: motif.trim() } : {}),
      });
      onDecided(dossier.code, done);
    } catch (failure) {
      setError(message(failure));
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
    void decide('rejete', `Dossier ${dossier.code} rejeté : il revient au praticien.`);
  }

  function cancelReject() {
    setRejecting(false);
    setMotif('');
    setMotifError(undefined);
    // Le bouton « Rejeter » réapparaît : le focus y revient
    setTimeout(() => rejectButton.current?.focus());
  }

  return (
    <li className="ui-card ui-card--plain">
      <h3>
        {dossier.code} · {dossier.praticienNom}
      </h3>
      <dl className="ui-facts">
        <dt>Praticien</dt>
        <dd>{dossier.praticien}</dd>
        <dt>Spécialité</dt>
        <dd>{dossier.specialite}</dd>
        <dt>Type</dt>
        <dd>{dossier.type === 'initial' ? 'Première certification' : 'Renouvellement'}</dd>
        <dt>Soumis le</dt>
        <dd>{date(dossier.soumisLe)}</dd>
        <dt>Visite sur place</dt>
        <dd>
          {dossier.visiteRealisee ? (
            <Badge tone="success">Réalisée, compte rendu signé</Badge>
          ) : dossier.visiteRequise ? (
            <Badge tone="warning">À réaliser</Badge>
          ) : (
            <Badge tone="neutral">Non requise</Badge>
          )}
        </dd>
      </dl>
      {error && <Alert tone="error">{error}</Alert>}
      {!canValidate && !rejecting && (
        <p className="ui-muted">
          La validation sera possible une fois la visite réalisée et son compte rendu signé.
        </p>
      )}
      {!rejecting && (
        <div className="ui-form__actions">
          {canValidate && (
            <Button
              variant="primary"
              icon="success"
              disabled={busy}
              onClick={() =>
                decide(
                  'valide',
                  `Dossier ${dossier.code} validé : il passe à la consolidation régionale.`,
                )
              }
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
          <h4 id={`${id}-rejet`}>Rejeter le dossier {dossier.code}</h4>
          <TextAreaField
            ref={motifField}
            label="Motif du rejet"
            hint="Le dossier revient au praticien. Le motif est conservé dans l’historique du dossier."
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
    </li>
  );
}
