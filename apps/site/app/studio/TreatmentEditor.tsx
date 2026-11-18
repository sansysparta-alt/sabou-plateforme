'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type {
  SectionType,
  StudioReferentials,
  TreatmentDetail,
  TreatmentFieldsInput,
  Visibility,
} from '@sabou/types';
import forms from '../Forms.module.css';
import { loginHref } from '../links';
import styles from './Studio.module.css';
import {
  GAP_LABELS,
  STATUS_LABELS,
  VISIBILITY_LABELS,
  WAITING_LABELS,
  accessMessage,
  studioApi,
  type ApiResult,
} from './studio-api';

interface PlantRow {
  key: number;
  plante: string;
  partie: string;
}
interface Form {
  maladie: string;
  titreFr: string;
  titreEn: string;
  cycleDureeJours: string;
  cyclePrisesParJour: string;
  cyclePauseJours: string;
  plantes: PlantRow[];
  sections: Partial<Record<SectionType, { fr: string; en: string }>>;
  contreIndications: string[];
  consentement: boolean;
  visibilite: Visibility | '';
}

type State =
  | { name: 'loading' }
  | { name: 'anonymous' }
  | { name: 'error'; message: string }
  | { name: 'ready'; refs: StudioReferentials; treatment: TreatmentDetail | null };

let nextKey = 1;
const EMPTY: Form = {
  maladie: '',
  titreFr: '',
  titreEn: '',
  cycleDureeJours: '',
  cyclePrisesParJour: '',
  cyclePauseJours: '',
  plantes: [{ key: nextKey++, plante: '', partie: '' }],
  sections: {},
  contreIndications: [],
  consentement: false,
  visibilite: '',
};

function toForm(t: TreatmentDetail): Form {
  const number = (value: number | null) => (value === null ? '' : String(value));
  return {
    maladie: t.maladie.code,
    titreFr: t.titreFr,
    titreEn: t.titreEn ?? '',
    cycleDureeJours: number(t.cycleDureeJours),
    cyclePrisesParJour: number(t.cyclePrisesParJour),
    cyclePauseJours: number(t.cyclePauseJours),
    plantes:
      t.plantes.length > 0
        ? t.plantes.map((p) => ({ key: nextKey++, plante: p.plante, partie: p.partie ?? '' }))
        : [{ key: nextKey++, plante: '', partie: '' }],
    sections: Object.fromEntries(
      t.sections.map((s) => [s.type, { fr: s.texteFr, en: s.texteEn ?? '' }]),
    ),
    contreIndications: t.contreIndications.map((c) => c.code),
    consentement: t.consentementLe !== null,
    visibilite: t.visibilite ?? '',
  };
}

// Nombre saisi : vide = non renseigné ; sinon un entier, que l'API contrôle (bornes)
const integer = (value: string): number | null => {
  const trimmed = value.trim();
  return trimmed === '' ? null : Number(trimmed);
};

function toFields(form: Form, refs: StudioReferentials): TreatmentFieldsInput {
  return {
    maladie: form.maladie,
    titreFr: form.titreFr,
    titreEn: form.titreEn,
    cycleDureeJours: integer(form.cycleDureeJours),
    cyclePrisesParJour: integer(form.cyclePrisesParJour),
    cyclePauseJours: integer(form.cyclePauseJours),
    plantes: form.plantes
      .filter((p) => p.plante !== '')
      .map((p) => ({ plante: p.plante, partie: p.partie })),
    sections: refs.sections
      .filter((s) => (form.sections[s.code]?.fr ?? '').trim() !== '')
      .map((s) => ({
        type: s.code,
        texteFr: form.sections[s.code]!.fr,
        texteEn: form.sections[s.code]!.en,
      })),
    contreIndications: form.contreIndications,
    consentement: form.consentement,
    visibilite: form.consentement && form.visibilite ? form.visibilite : null,
  };
}

// Création et modification d'un traitement au Studio web (US-060, UC-21) : maladie, plantes
// ordonnées avec la partie utilisée, cycle, 4 sections obligatoires et la conservation, en
// français (anglais facultatif) ; consentement et niveau de visibilité avant la soumission.
interface FieldErrors {
  maladie?: string;
  titreFr?: string;
  visibilite?: string;
}
const FIELD_ORDER: (keyof FieldErrors)[] = ['maladie', 'titreFr', 'visibilite'];
// Champ qui reçoit le focus : pour la visibilité, le premier bouton radio
const FIELD_IDS: Record<keyof FieldErrors, string> = {
  maladie: 'maladie',
  titreFr: 'titre-fr',
  visibilite: 'visibilite-premier',
};

export default function TreatmentEditor({ code }: { code: string | null }) {
  const [state, setState] = useState<State>({ name: 'loading' });
  const [form, setForm] = useState<Form>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Erreurs de saisie, chacune sous son champ (WCAG 3.3.1) ; le message en tête reste aux refus
  // du serveur et à la liste de ce qui manque avant la soumission
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      studioApi.referentials(),
      code ? studioApi.detail(code) : Promise.resolve(null),
    ]).then(([refs, detail]) => {
      if (!active) return;
      const failed = [refs, detail].find(
        (r): r is Extract<ApiResult<unknown>, { ok: false }> => r !== null && !r.ok,
      );
      if (failed) {
        if (failed.status === 401) setState({ name: 'anonymous' });
        else
          setState({
            name: 'error',
            message:
              accessMessage(failed.status) ??
              failed.message ??
              'Ce traitement ne peut pas être affiché. Rechargez la page.',
          });
        return;
      }
      const treatment = detail?.ok ? detail.data : null;
      if (treatment) setForm(toForm(treatment));
      setState({ name: 'ready', refs: (refs as { data: StudioReferentials }).data, treatment });
    });
    return () => {
      active = false;
    };
  }, [code]);

  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  if (state.name === 'loading') return <p role="status">Chargement…</p>;
  if (state.name === 'anonymous') {
    return (
      <>
        <p>Connectez-vous avec votre compte de praticien pour ouvrir le Studio.</p>
        <div className={forms.actions}>
          <a className={forms.link} href={loginHref(undefined, '/studio')}>
            Se connecter
          </a>
        </div>
      </>
    );
  }
  if (state.name === 'error') {
    return (
      <p className={forms.error} role="alert">
        {state.message}
      </p>
    );
  }

  const { refs, treatment } = state;
  if (treatment && treatment.statut !== 'brouillon') return <ReadOnly treatment={treatment} />;

  const update = (change: Partial<Form>) => {
    setForm((current) => ({ ...current, ...change }));
    // Une saisie efface l'erreur du champ corrigé
    setFieldErrors((current) => {
      const rest = { ...current };
      for (const key of Object.keys(change)) delete rest[key as keyof FieldErrors];
      return rest;
    });
  };
  const invalid = (key: keyof FieldErrors, help?: string) => ({
    'aria-invalid': fieldErrors[key] ? true : undefined,
    'aria-describedby':
      [help, fieldErrors[key] ? `${key}-erreur` : undefined].filter(Boolean).join(' ') || undefined,
  });
  const fieldError = (key: keyof FieldErrors) =>
    fieldErrors[key] ? (
      <p id={`${key}-erreur`} className={forms.error}>
        {fieldErrors[key]}
      </p>
    ) : null;
  const setPlant = (key: number, change: Partial<PlantRow>) =>
    update({ plantes: form.plantes.map((p) => (p.key === key ? { ...p, ...change } : p)) });
  const movePlant = (index: number, step: -1 | 1) => {
    const plantes = [...form.plantes];
    [plantes[index], plantes[index + step]] = [plantes[index + step]!, plantes[index]!];
    update({ plantes });
  };
  const setSection = (type: SectionType, change: Partial<{ fr: string; en: string }>) =>
    update({
      sections: { ...form.sections, [type]: { fr: '', en: '', ...form.sections[type], ...change } },
    });

  function fail(result: Extract<ApiResult<unknown>, { ok: false }>) {
    if (result.status === 401) {
      setState({ name: 'anonymous' });
      return;
    }
    if (result.gaps && result.gaps.length > 0) {
      setError(
        `Avant de soumettre, complétez : ${result.gaps.map((g) => GAP_LABELS[g]).join(' ; ')}.`,
      );
      return;
    }
    setError(
      accessMessage(result.status) ?? result.message ?? 'Enregistrement impossible. Réessayez.',
    );
  }

  // Enregistre le brouillon ; renvoie le traitement à jour, ou null en cas d'échec
  async function save(): Promise<TreatmentDetail | null> {
    setError(null);
    setNotice(null);
    const found: FieldErrors = {};
    if (!form.maladie) found.maladie = 'Choisissez la maladie soignée.';
    if (form.titreFr.trim() === '') found.titreFr = 'Donnez un titre au traitement.';
    if (form.consentement && !form.visibilite) {
      found.visibilite = 'Choisissez le niveau de visibilité.';
    }
    setFieldErrors(found);
    const first = FIELD_ORDER.find((key) => found[key]);
    if (first) {
      document.getElementById(FIELD_IDS[first])?.focus();
      return null;
    }
    const fields = toFields(form, refs);
    const result = treatment
      ? await studioApi.update(treatment.code, treatment.modifieLe, fields)
      : await studioApi.create(fields);
    if (!result.ok) {
      fail(result);
      return null;
    }
    setState({ name: 'ready', refs, treatment: result.data });
    setForm(toForm(result.data));
    if (!treatment) window.history.replaceState(null, '', `?code=${result.data.code}`);
    return result.data;
  }

  async function onSave(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    const saved = await save();
    if (saved) setNotice(`Brouillon ${saved.code} enregistré.`);
    setBusy(false);
  }

  async function onSubmit() {
    if (busy) return;
    setBusy(true);
    const saved = await save();
    if (saved) {
      if (saved.manques.length > 0) {
        setError(
          `Avant de soumettre, complétez : ${saved.manques.map((g) => GAP_LABELS[g]).join(' ; ')}.`,
        );
      } else {
        const result = await studioApi.submit(saved.code);
        if (result.ok) setState({ name: 'ready', refs, treatment: result.data });
        else fail(result);
      }
    }
    setBusy(false);
  }

  const plantName = new Map(refs.plantes.map((p) => [p.code, p]));
  // Liste active, plus celles que le traitement a déjà et qui ont été désactivées depuis
  const contraindications = [
    ...refs.contreIndications,
    ...(treatment?.contreIndications ?? []).filter(
      (c) => !refs.contreIndications.some((r) => r.code === c.code),
    ),
  ];
  const chosen = new Set(form.plantes.map((p) => p.plante));

  return (
    <>
      <h1>{treatment ? treatment.titreFr : 'Nouveau traitement'}</h1>
      {treatment && (
        <p className={forms.help}>
          {treatment.code} · {STATUS_LABELS[treatment.statut]}
        </p>
      )}
      {treatment?.dernierMotif && (
        <div className={styles.motif}>
          <strong>Renvoyé pour correction :</strong> {treatment.dernierMotif}
        </div>
      )}
      <div ref={errorRef} tabIndex={-1} className={styles.alertSlot}>
        {error && (
          <p className={forms.error} role="alert">
            {error}
          </p>
        )}
      </div>
      <p role="status" className={notice ? forms.notice : styles.empty}>
        {notice}
      </p>

      <form className={forms.form} onSubmit={(e) => void onSave(e)} noValidate>
        <div className={forms.field}>
          <label className={forms.label} htmlFor="maladie">
            Maladie soignée
          </label>
          <select
            id="maladie"
            className={forms.input}
            value={form.maladie}
            {...invalid('maladie')}
            onChange={(e) => update({ maladie: e.target.value })}
          >
            <option value="">Choisir…</option>
            {refs.maladies.map((m) => (
              <option key={m.code} value={m.code}>
                {m.nomFr}
              </option>
            ))}
          </select>
          {fieldError('maladie')}
        </div>
        <div className={forms.field}>
          <label className={forms.label} htmlFor="titre-fr">
            Titre du traitement
          </label>
          <input
            id="titre-fr"
            className={forms.input}
            maxLength={150}
            value={form.titreFr}
            {...invalid('titreFr')}
            onChange={(e) => update({ titreFr: e.target.value })}
          />
          {fieldError('titreFr')}
        </div>
        <div className={forms.field}>
          <label className={forms.label} htmlFor="titre-en">
            Titre en anglais (facultatif)
          </label>
          <input
            id="titre-en"
            className={forms.input}
            lang="en"
            maxLength={150}
            value={form.titreEn}
            onChange={(e) => update({ titreEn: e.target.value })}
          />
        </div>

        <fieldset className={styles.group}>
          <legend className={forms.label}>Plantes, dans l’ordre de la préparation</legend>
          <ol className={styles.plants}>
            {form.plantes.map((row, index) => {
              const name = plantName.get(row.plante)?.nomFr ?? `plante ${index + 1}`;
              const pending = row.plante && plantName.get(row.plante)?.validee === false;
              return (
                <li key={row.key} className={styles.plant}>
                  <div className={forms.field}>
                    <label className={forms.label} htmlFor={`plante-${row.key}`}>
                      Plante {index + 1}
                    </label>
                    <select
                      id={`plante-${row.key}`}
                      className={forms.input}
                      value={row.plante}
                      aria-describedby={pending ? `plante-${row.key}-revue` : undefined}
                      onChange={(e) => setPlant(row.key, { plante: e.target.value })}
                    >
                      <option value="">Choisir…</option>
                      {refs.plantes
                        .filter((p) => p.code === row.plante || !chosen.has(p.code))
                        .map((p) => (
                          <option key={p.code} value={p.code}>
                            {p.nomFr} ({p.nomScientifique})
                          </option>
                        ))}
                    </select>
                    {pending && (
                      <p id={`plante-${row.key}-revue`} className={forms.help}>
                        En revue par le Comité : le traitement ne sera certifié qu’après sa
                        validation.
                      </p>
                    )}
                  </div>
                  <div className={forms.field}>
                    <label className={forms.label} htmlFor={`partie-${row.key}`}>
                      Partie utilisée
                    </label>
                    <input
                      id={`partie-${row.key}`}
                      className={forms.input}
                      placeholder="feuilles, écorce, racine…"
                      maxLength={100}
                      value={row.partie}
                      onChange={(e) => setPlant(row.key, { partie: e.target.value })}
                    />
                  </div>
                  <div className={styles.rowActions}>
                    <button
                      type="button"
                      className={forms.secondary}
                      disabled={index === 0}
                      aria-label={`Monter ${name}`}
                      onClick={() => movePlant(index, -1)}
                    >
                      Monter
                    </button>
                    <button
                      type="button"
                      className={forms.secondary}
                      disabled={index === form.plantes.length - 1}
                      aria-label={`Descendre ${name}`}
                      onClick={() => movePlant(index, 1)}
                    >
                      Descendre
                    </button>
                    <button
                      type="button"
                      className={forms.secondary}
                      disabled={form.plantes.length === 1}
                      aria-label={`Retirer ${name}`}
                      onClick={() =>
                        update({ plantes: form.plantes.filter((p) => p.key !== row.key) })
                      }
                    >
                      Retirer
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
          {form.plantes.length < 15 && (
            <button
              type="button"
              className={forms.secondary}
              onClick={() =>
                update({ plantes: [...form.plantes, { key: nextKey++, plante: '', partie: '' }] })
              }
            >
              + Ajouter une plante
            </button>
          )}
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={forms.label}>Cycle de traitement</legend>
          <div className={styles.cycle}>
            {(
              [
                ['cycleDureeJours', 'Durée (jours)'],
                ['cyclePrisesParJour', 'Prises par jour'],
                ['cyclePauseJours', 'Pause (jours, facultatif)'],
              ] as const
            ).map(([field, label]) => (
              <div key={field} className={forms.field}>
                <label className={forms.label} htmlFor={field}>
                  {label}
                </label>
                <input
                  id={field}
                  className={forms.input}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={form[field]}
                  onChange={(e) => update({ [field]: e.target.value.replace(/\D/g, '') })}
                />
              </div>
            ))}
          </div>
        </fieldset>

        {refs.sections.map((section) => (
          <fieldset key={section.code} className={styles.group}>
            <legend className={forms.label}>
              {section.libelleFr} {section.obligatoire ? '' : '(facultatif)'}
            </legend>
            <div className={forms.field}>
              <label htmlFor={`section-${section.code}`}>
                Texte en français<span className={styles.sr}> — {section.libelleFr}</span>
              </label>
              <textarea
                id={`section-${section.code}`}
                className={`${forms.input} ${styles.text}`}
                maxLength={4000}
                value={form.sections[section.code]?.fr ?? ''}
                onChange={(e) => setSection(section.code, { fr: e.target.value })}
              />
            </div>
            <details className={styles.english}>
              <summary>Texte en anglais (facultatif)</summary>
              <div className={forms.field}>
                <label htmlFor={`section-${section.code}-en`}>
                  Texte en anglais<span className={styles.sr}> — {section.libelleFr}</span>
                </label>
                <textarea
                  id={`section-${section.code}-en`}
                  lang="en"
                  className={`${forms.input} ${styles.text}`}
                  maxLength={4000}
                  value={form.sections[section.code]?.en ?? ''}
                  onChange={(e) => setSection(section.code, { en: e.target.value })}
                />
              </div>
            </details>
          </fieldset>
        ))}

        <fieldset className={styles.group}>
          <legend className={forms.label}>Contre-indications</legend>
          <p className={forms.help}>
            Cochez les personnes à qui ce traitement est déconseillé : elles seront affichées en
            alerte sur la page du traitement.
          </p>
          {contraindications.map((c) => (
            <label key={c.code} className={forms.choice}>
              <input
                type="checkbox"
                checked={form.contreIndications.includes(c.code)}
                onChange={(e) =>
                  update({
                    contreIndications: e.target.checked
                      ? [...form.contreIndications, c.code]
                      : form.contreIndications.filter((code) => code !== c.code),
                  })
                }
              />
              {c.libelleFr}
            </label>
          ))}
        </fieldset>

        <fieldset className={styles.group}>
          <legend className={forms.label}>Consentement et visibilité</legend>
          <label className={forms.choice}>
            <input
              type="checkbox"
              checked={form.consentement}
              onChange={(e) => update({ consentement: e.target.checked })}
            />
            J’accepte que ce traitement soit examiné par SABOU puis, une fois certifié, publié selon
            le niveau de visibilité choisi.
          </label>
          <fieldset
            className={forms.choices}
            disabled={!form.consentement}
            {...invalid('visibilite')}
          >
            <legend>Niveau de visibilité</legend>
            {(Object.keys(VISIBILITY_LABELS) as Visibility[]).map((v, index) => (
              <label key={v} className={forms.choice}>
                <input
                  id={index === 0 ? FIELD_IDS.visibilite : undefined}
                  type="radio"
                  name="visibilite"
                  value={v}
                  checked={form.visibilite === v}
                  onChange={() => update({ visibilite: v })}
                />
                <span>
                  <strong>{VISIBILITY_LABELS[v].label}</strong> — {VISIBILITY_LABELS[v].help}
                </span>
              </label>
            ))}
            {fieldError('visibilite')}
          </fieldset>
        </fieldset>

        {treatment && treatment.manques.length > 0 && (
          <p className={forms.help}>
            Avant de soumettre : {treatment.manques.map((g) => GAP_LABELS[g]).join(' ; ')}.
          </p>
        )}
        <div className={forms.actions}>
          <button type="submit" className={forms.button} aria-disabled={busy}>
            Enregistrer le brouillon
          </button>
          <button
            type="button"
            className={forms.button}
            aria-disabled={busy}
            onClick={() => void onSubmit()}
          >
            Soumettre pour certification
          </button>
        </div>
      </form>
    </>
  );
}

// Traitement soumis : il ne se modifie plus, son avancement s'affiche
function ReadOnly({ treatment }: { treatment: TreatmentDetail }) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), []);
  return (
    <>
      <h1 ref={headingRef} tabIndex={-1} className={forms.heading}>
        {treatment.titreFr}
      </h1>
      <p className={styles.status} data-status={treatment.statut}>
        {STATUS_LABELS[treatment.statut]}
      </p>
      {treatment.statut === 'soumise' && (
        <p className={forms.notice}>
          Votre traitement est soumis à l’administration régionale.
          {treatment.dossier &&
            ` Il est joint à votre dossier de certification ${treatment.dossier} et sera certifié avec lui.`}
        </p>
      )}
      {treatment.attenteRaison && (
        <p className={styles.waiting}>{WAITING_LABELS[treatment.attenteRaison]}</p>
      )}
      <Contraindications items={treatment.contreIndications} />
      <dl className={styles.summary}>
        <dt>Maladie</dt>
        <dd>{treatment.maladie.nomFr}</dd>
        <dt>Plantes</dt>
        <dd>
          <ol>
            {treatment.plantes.map((p) => (
              <li key={p.plante}>
                {p.nomFr}
                {p.partie ? ` — ${p.partie}` : ''}
              </li>
            ))}
          </ol>
        </dd>
        <dt>Cycle</dt>
        <dd>
          {treatment.cycleDureeJours} jours, {treatment.cyclePrisesParJour} prise(s) par jour
          {treatment.cyclePauseJours ? `, pause de ${treatment.cyclePauseJours} jours` : ''}
        </dd>
        <dt>Visibilité</dt>
        <dd>{treatment.visibilite ? VISIBILITY_LABELS[treatment.visibilite].label : '—'}</dd>
      </dl>
    </>
  );
}

// US-063 : contre-indications affichées en alerte
function Contraindications({ items }: { items: { code: string; libelleFr: string }[] }) {
  if (items.length === 0) return null;
  return (
    <div className={styles.alert} role="note" aria-label="Contre-indications">
      <strong>Déconseillé :</strong> {items.map((c) => c.libelleFr).join(', ')}.
    </div>
  );
}
