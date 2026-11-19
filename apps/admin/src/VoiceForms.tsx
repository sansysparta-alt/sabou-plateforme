import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, SelectField, TextAreaField, TextField } from '@sabou/ui';
import type { NameVoiceStatus } from '@sabou/types';

// Formulaires communs aux voix (noms, US-071 ; sections des traitements, US-072 à US-075) :
// enregistrer une voix avec le consentement de la personne qui parle (R-LNG-11), renvoyer une
// voix avec un motif.

// Défini ici plutôt qu'importé de @sabou/types : l'application n'en importe que des types
const MOTIF_MAX_LENGTH = 500;

// Libellé et couleur de chaque statut de voix (R-LNG-10)
export const STATUS: Record<
  NameVoiceStatus,
  [label: string, tone: 'neutral' | 'warning' | 'success']
> = {
  brouillon: ['Brouillon', 'neutral'],
  traduit: ['Traduit', 'neutral'],
  valide: ['Validé', 'warning'],
  publie: ['Publié', 'success'],
};

export function RecordForm({
  title,
  hint,
  busy,
  onCancel,
  onSubmit,
}: {
  title: string;
  hint: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (file: File, consent: boolean) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState<'' | 'oui' | 'non'>('');
  const [errors, setErrors] = useState<{ file?: string; consent?: string }>({});
  const fileField = useRef<HTMLInputElement>(null);
  const consentField = useRef<HTMLSelectElement>(null);

  useEffect(() => fileField.current?.focus(), []);

  function submit(event: FormEvent) {
    event.preventDefault();
    const found = {
      file: file ? undefined : 'Choisissez l’enregistrement.',
      consent: consent ? undefined : 'Indiquez si la personne qui parle consent à la publication.',
    };
    setErrors(found);
    if (found.file) return fileField.current?.focus();
    if (found.consent) return consentField.current?.focus();
    onSubmit(file!, consent === 'oui');
  }

  return (
    <form className="ui-form" noValidate onSubmit={submit} aria-labelledby="enregistrer-titre">
      <h3 id="enregistrer-titre">{title}</h3>
      <TextField
        ref={fileField}
        label="Enregistrement"
        hint={hint}
        type="file"
        accept="audio/*"
        error={errors.file}
        aria-required="true"
        onChange={(event) => setFile(event.target.files?.[0] ?? null)}
      />
      <SelectField
        ref={consentField}
        label="Consentement de la personne qui parle"
        value={consent}
        error={errors.consent}
        aria-required="true"
        onChange={(event) => setConsent(event.target.value as '' | 'oui' | 'non')}
      >
        <option value="">Choisir…</option>
        <option value="oui">Elle consent à la publication de sa voix</option>
        <option value="non">Elle ne consent pas (la voix ne pourra pas être publiée)</option>
      </SelectField>
      <div className="ui-form__actions">
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Traitement de la voix…' : 'Enregistrer la voix'}
        </Button>
        <Button variant="tertiary" disabled={busy} onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  );
}

export function SendBackForm({
  title,
  busy,
  onCancel,
  onSubmit,
}: {
  title: string;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (motif: string) => void;
}) {
  const [motif, setMotif] = useState('');
  const [error, setError] = useState<string>();
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => field.current?.focus(), []);

  function submit(event: FormEvent) {
    event.preventDefault();
    const text = motif.trim();
    if (!text) {
      setError('Saisissez le motif du renvoi.');
      return field.current?.focus();
    }
    onSubmit(text);
  }

  return (
    <form className="ui-form" noValidate onSubmit={submit} aria-labelledby="renvoi-titre">
      <h3 id="renvoi-titre">{title}</h3>
      <TextAreaField
        ref={field}
        label="Motif du renvoi"
        hint="Il est montré à la personne qui a enregistré la voix."
        value={motif}
        maxLength={MOTIF_MAX_LENGTH}
        error={error}
        aria-required="true"
        onChange={(event) => setMotif(event.target.value)}
      />
      <div className="ui-form__actions">
        <Button type="submit" variant="danger" disabled={busy}>
          Confirmer le renvoi
        </Button>
        <Button variant="tertiary" disabled={busy} onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  );
}
