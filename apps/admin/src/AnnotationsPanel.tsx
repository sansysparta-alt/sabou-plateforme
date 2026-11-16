import { useEffect, useId, useState, type FormEvent } from 'react';
import { Alert, Badge, Button, TextAreaField, type BadgeTone } from '@sabou/ui';
import type { Annotation, AnnotationOpinion, AnnotationTarget } from '@sabou/types';
import { ApiError } from './accounts-api';
import { addAnnotation, listAnnotations } from './annotations-api';

// Défini ici plutôt qu'importé de @sabou/types : l'application n'en importe que des types,
// pour ne pas embarquer zod dans le paquet téléchargé (réseau 3G)
const OPINIONS: Record<AnnotationOpinion, { label: string; tone: BadgeTone }> = {
  favorable: { label: 'Favorable', tone: 'success' },
  reserve: { label: 'Réserve', tone: 'warning' },
  defavorable: { label: 'Défavorable', tone: 'error' },
};
const MAX_LENGTH = 2000;

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });

// Annotations du Comité scientifique sur un traitement ou une plante (US-064, UC-51) :
// historique daté des avis, lu par le Comité et la DG ; formulaire pour le seul Comité.
// Une annotation ne se modifie ni ne s'efface. Repliées par défaut et lues à la première
// ouverture : une file de 10 traitements ne fait pas 10 demandes de plus en 3G.
export function AnnotationsPanel({
  type,
  code,
  canAnnotate,
}: {
  type: AnnotationTarget;
  code: string;
  canAnnotate: boolean;
}) {
  const id = useId();
  const [items, setItems] = useState<Annotation[] | null>(null);
  const [loadError, setLoadError] = useState<string>();
  const [avis, setAvis] = useState<AnnotationOpinion | ''>('');
  const [contenu, setContenu] = useState('');
  const [formError, setFormError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    if (!opened) return;
    let current = true;
    listAnnotations(type, code).then(
      (list) => current && setItems(list),
      (error: unknown) =>
        current &&
        setLoadError(error instanceof ApiError ? error.message : 'Annotations indisponibles.'),
    );
    return () => {
      current = false;
    };
  }, [opened, type, code]);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!avis || !contenu.trim()) {
      setFormError('Choisissez un avis et rédigez l’annotation.');
      return;
    }
    setBusy(true);
    setFormError(undefined);
    try {
      setItems(await addAnnotation({ type, code, avis, contenu: contenu.trim() }));
      setAvis('');
      setContenu('');
      setNotice('Annotation enregistrée.');
    } catch (error) {
      setFormError(error instanceof ApiError ? error.message : 'Une erreur est survenue.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <details
      className="ui-annotations"
      onToggle={(event) => event.currentTarget.open && setOpened(true)}
    >
      <summary className="ui-annotations__summary">
        <h4 id={`${id}-titre`}>Annotations du Comité scientifique</h4>
      </summary>
      {opened && items === null && !loadError && <p>Chargement…</p>}
      {loadError && <Alert tone="error">{loadError}</Alert>}
      <p role="status" className="ui-live-status">
        {notice}
      </p>
      {items !== null && items.length === 0 && <p className="ui-muted">Aucune annotation.</p>}
      {items !== null && items.length > 0 && (
        <ol className="ui-annotations__list">
          {items.map((a) => (
            <li key={a.id}>
              <p>
                {a.avis ? (
                  <Badge tone={OPINIONS[a.avis].tone}>{OPINIONS[a.avis].label}</Badge>
                ) : (
                  <Badge tone="neutral">Sans avis</Badge>
                )}{' '}
                <span className="ui-muted">
                  {a.auteur}, le {dateTime(a.le)}
                </span>
              </p>
              <p>{a.contenu}</p>
            </li>
          ))}
        </ol>
      )}
      {canAnnotate && (
        <form className="ui-form" onSubmit={onSubmit} noValidate aria-labelledby={`${id}-ajout`}>
          <h5 id={`${id}-ajout`}>Ajouter une annotation</h5>
          {formError && <Alert tone="error">{formError}</Alert>}
          <fieldset className="ui-fieldset">
            <legend className="ui-fieldset__legend">Avis</legend>
            {(Object.keys(OPINIONS) as AnnotationOpinion[]).map((value) => (
              <label key={value} className="ui-choice">
                <input
                  type="radio"
                  name={`${id}-avis`}
                  value={value}
                  checked={avis === value}
                  onChange={() => setAvis(value)}
                />
                {OPINIONS[value].label}
              </label>
            ))}
          </fieldset>
          <TextAreaField
            label="Annotation"
            hint="Annotation botanique ou avis motivé. Elle ne pourra plus être modifiée."
            value={contenu}
            maxLength={MAX_LENGTH}
            required
            onChange={(event) => setContenu(event.target.value)}
          />
          <div className="ui-form__actions">
            <Button type="submit" variant="primary" disabled={busy}>
              Enregistrer l’annotation
            </Button>
          </div>
        </form>
      )}
    </details>
  );
}
