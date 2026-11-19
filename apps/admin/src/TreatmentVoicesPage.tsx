import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  Alert,
  Badge,
  Button,
  ListToolbar,
  PageHeader,
  SearchBox,
  TextAreaField,
  foldText,
} from '@sabou/ui';
import type {
  TreatmentVoiceEntry,
  TreatmentVoices,
  TreatmentVoiceSection,
  TreatmentVoiceTarget,
} from '@sabou/types';
import { ApiError } from './accounts-api';
import { DossierRow } from './DossierRow';
import { depositVoice } from './local-names-api';
import { PAGE_HEADERS } from './page-headers';
import {
  fetchTreatmentVoices,
  listTreatmentVoiceTargets,
  moveTreatmentVoice,
  recordTreatmentVoice,
  reviseTreatmentSection,
  treatmentPlantVoiceAudioUrl,
  treatmentVoiceAudioUrl,
} from './treatment-voices-api';
import { RecordForm, SendBackForm, STATUS } from './VoiceForms';

// Voix des sections des traitements, un écran par profil :
// - Résumés et traductions (US-075, UC-33) : le préfectoral de la préfecture du praticien
//   révise le texte français de chaque section tant que le traitement est soumis, enregistre la
//   voix locale de chaque section, puis l'envoie au régional de la langue ;
// - Atelier linguistique (US-072, UC-41) : le régional écoute les voix de ses langues, pour les
//   traitements de sa région, à côté du texte français, et les valide ou les renvoie avec un
//   motif.
// - Contrôle des effets indésirables (US-073, UC-53) : le Comité écoute, langue par langue, la
//   voix validée des effets indésirables et contre-indications et la contrôle ou la renvoie ;
//   sans ce contrôle, elle ne peut pas être publiée (R-LNG-12).
// La base contrôle chaque geste (zone, droits par langue, séparation des tâches, statut).
export type TreatmentVoicesMode = 'resumes' | 'atelier' | 'controle';
const MODE_PATH = {
  resumes: '/resumes-traductions',
  atelier: '/atelier-linguistique',
  controle: '/controle-effets',
} as const;

// Défini ici plutôt qu'importé de @sabou/types : l'application n'en importe que des types
const TEXT_MAX_LENGTH = 4000;

const TREATMENT_STATUS: Record<string, string> = {
  soumise: 'Soumis',
  transmise: 'Transmis au Comité',
  expertisee: 'Expertisé',
  certifiee: 'Certifié',
  suspendue: 'Suspendu',
};

const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : 'Une erreur est survenue.';

export function TreatmentVoicesPage({ mode = 'resumes' }: { mode?: TreatmentVoicesMode }) {
  const header = PAGE_HEADERS[MODE_PATH[mode]];
  const [targets, setTargets] = useState<TreatmentVoiceTarget[] | null>(null);
  const [loadError, setLoadError] = useState<string>();
  const [query, setQuery] = useState('');
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let active = true;
    listTreatmentVoiceTargets().then(
      (rows) => active && setTargets(rows),
      (error: unknown) => active && setLoadError(errorMessage(error)),
    );
    return () => {
      active = false;
    };
  }, []);

  const term = foldText(query.trim());
  const rows = (targets ?? [])
    .filter(
      (t) =>
        term === '' || foldText(`${t.code} ${t.titre} ${t.maladie} ${t.praticien}`).includes(term),
    )
    // Atelier : les traitements qui ont des voix à valider d'abord
    .sort((a, b) =>
      mode === 'atelier'
        ? b.aValider - a.aValider
        : mode === 'controle'
          ? b.aControler - a.aControler
          : 0,
    );

  return (
    <>
      <PageHeader {...header} />
      {loadError && <Alert tone="error">{loadError}</Alert>}
      {targets === null && !loadError && <p>Chargement…</p>}
      {targets && targets.length > 0 && (
        <ListToolbar>
          <SearchBox
            label="Rechercher un traitement"
            placeholder="Code, titre, maladie ou praticien"
            value={query}
            onChange={setQuery}
          />
        </ListToolbar>
      )}
      {targets && rows.length === 0 && (
        <p>{term ? 'Aucun traitement ne correspond.' : 'Aucun traitement dans votre zone.'}</p>
      )}
      {rows.length > 0 && (
        <ul className="ui-dossiers" aria-label="Traitements">
          {rows.map((t) => (
            <DossierRow
              key={t.code}
              code={t.code}
              name={t.titre}
              onOpen={() => setOpened((s) => (s.has(t.code) ? s : new Set(s).add(t.code)))}
              meta={
                <>
                  {t.praticien} · {t.prefecture} · {t.maladie} ·{' '}
                  <Badge tone={t.statut === 'soumise' ? 'warning' : 'neutral'}>
                    {TREATMENT_STATUS[t.statut] ?? t.statut}
                  </Badge>{' '}
                  {mode === 'controle' ? (
                    <>
                      · <strong>{t.aControler} à contrôler</strong>
                    </>
                  ) : mode === 'atelier' ? (
                    <>
                      · <strong>{t.aValider} à valider</strong>, {t.validees} validées
                    </>
                  ) : (
                    <>
                      · voix : {t.brouillons} en brouillon, {t.traduites} envoyées, {t.publiees}{' '}
                      publiées
                    </>
                  )}
                </>
              }
            >
              {opened.has(t.code) ? <TreatmentDetail code={t.code} mode={mode} /> : null}
            </DossierRow>
          ))}
        </ul>
      )}
    </>
  );
}

function TreatmentDetail({ code, mode }: { code: string; mode: TreatmentVoicesMode }) {
  const [voices, setVoices] = useState<TreatmentVoices | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    fetchTreatmentVoices(code).then(
      (v) => active && setVoices(v),
      (failure: unknown) => active && setError(errorMessage(failure)),
    );
    return () => {
      active = false;
    };
  }, [code]);

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!voices) return <p>Chargement…</p>;
  return (
    <>
      <p>
        Praticien : {voices.praticien} · Statut : {TREATMENT_STATUS[voices.statut] ?? voices.statut}
      </p>
      {voices.prefectoral && !voices.peutReviser && (
        <p className="ui-field__hint">
          Le texte français se révise seulement quand le traitement est soumis, avant l’expertise du
          Comité. Les voix s’enregistrent à toutes les étapes.
        </p>
      )}
      {voices.sections
        // Comité : la seule section des effets indésirables et contre-indications
        .filter((section) => mode !== 'controle' || section.type === 'effets_indesirables')
        .map((section) => (
          <SectionVoices
            key={section.type}
            mode={mode}
            voices={voices}
            section={section}
            onChange={setVoices}
          />
        ))}
      {voices.nomsPlantes.length > 0 && (
        <section className="ui-section" aria-labelledby="noms-plantes">
          <h3 id="noms-plantes">Noms des plantes dits par le praticien</h3>
          <p className="ui-muted">
            Écoute interne, pour identifier chaque plante : ces voix ne sont jamais publiées.
          </p>
          <ul className="ui-list">
            {voices.nomsPlantes.map((n) => (
              <li key={n.plante}>
                <span>
                  {n.nomFr} ({n.plante}) · {n.langueNom}
                </span>
                <audio
                  controls
                  preload="none"
                  aria-label={`Nom de la plante ${n.nomFr} dit par le praticien, en ${n.langueNom}`}
                >
                  <source
                    src={treatmentPlantVoiceAudioUrl(voices.code, n.plante)}
                    type="audio/webm"
                  />
                  {n.secours && (
                    <source
                      src={treatmentPlantVoiceAudioUrl(voices.code, n.plante, true)}
                      type="audio/mp4"
                    />
                  )}
                </audio>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}

// Gestes possibles pour le compte connecté ; la base les contrôle aussi
function actionsFor(
  entry: TreatmentVoiceEntry,
  voices: TreatmentVoices,
  mode: TreatmentVoicesMode,
) {
  const prefectoral = voices.prefectoral;
  const comite =
    mode === 'controle' && voices.comite && entry.statut === 'valide' && !entry.controle;
  const resumes = mode === 'resumes' && prefectoral;
  const atelier = mode === 'atelier' && entry.peutValider;
  return {
    record: resumes && entry.peutEnregistrer,
    send: resumes && entry.statut === 'brouillon' && (entry.parMoi || entry.peutTraduire),
    validate: atelier && entry.statut === 'traduit' && !entry.parMoi,
    sendBack: atelier && (entry.statut === 'traduit' || entry.statut === 'valide'),
    control: comite,
  };
}

function SectionVoices({
  mode,
  voices,
  section,
  onChange,
}: {
  mode: TreatmentVoicesMode;
  voices: TreatmentVoices;
  section: TreatmentVoiceSection;
  onChange: (v: TreatmentVoices) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [form, setForm] = useState<
    { kind: 'revise' } | { kind: 'record' | 'sendBack' | 'refuse'; langue: string } | null
  >(null);

  async function act(run: () => Promise<TreatmentVoices>, done: string) {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      onChange(await run());
      setNotice(done);
      setForm(null);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  // Langues montrées. Résumés : celles où une voix existe, ou où le compte peut enregistrer.
  // Atelier : seules les voix des langues que le compte valide (critère de US-072).
  // Contrôle : toutes les voix existantes, chaque langue étant contrôlée à part.
  const languages = section.voix.filter((e) =>
    mode === 'atelier'
      ? e.statut !== null && e.peutValider
      : mode === 'controle'
        ? e.statut !== null
        : e.statut !== null || (voices.prefectoral && e.peutEnregistrer),
  );
  const headingId = `section-${voices.code}-${section.type}`;
  const recordLanguage = form?.kind === 'record' ? form.langue : null;
  const sendBackLanguage = form?.kind === 'sendBack' ? form.langue : null;
  const refuseLanguage = form?.kind === 'refuse' ? form.langue : null;
  const languageName = (code: string) => section.voix.find((e) => e.langue === code)!.langueNom;

  return (
    <section className="ui-section" aria-labelledby={headingId}>
      <h3 id={headingId}>{section.libelle}</h3>
      {error && <Alert tone="error">{error}</Alert>}
      {notice && (
        <p role="status" className="ui-live-status">
          {notice}
        </p>
      )}
      {/* Texte français et voix côte à côte sur ordinateur (critère de US-072) */}
      <div className="ui-split">
        <div>
          {section.texteFr ? (
            <p className="ui-prose">{section.texteFr}</p>
          ) : (
            <p className="ui-muted">
              Section dite en voix par le praticien : texte français à écrire avant le Comité.
            </p>
          )}
          {section.texteEn && (
            <p className="ui-prose" lang="en">
              {section.texteEn}
            </p>
          )}
          {section.revisions.length > 0 && (
            <details>
              <summary>Texte d’origine et révisions ({section.revisions.length})</summary>
              <ol>
                {section.revisions.map((r) => (
                  <li key={r.le}>
                    Révisé par {r.par} le {new Date(r.le).toLocaleDateString('fr-FR')}. Texte
                    précédent : {r.avant ? `« ${r.avant} »` : 'aucun (section dite en voix)'}
                  </li>
                ))}
              </ol>
            </details>
          )}
          {voices.peutReviser && form?.kind !== 'revise' && (
            <div className="ui-actions">
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setForm({ kind: 'revise' })}
              >
                Réviser le texte français{' '}
                <span className="ui-visually-hidden">: {section.libelle}</span>
              </Button>
            </div>
          )}
          {form?.kind === 'revise' && (
            <ReviseForm
              section={section}
              busy={busy}
              onCancel={() => setForm(null)}
              onSubmit={(texteFr, texteEn) =>
                act(
                  () => reviseTreatmentSection(voices.code, section.type, texteFr, texteEn),
                  'Texte révisé ; le texte précédent reste dans l’historique.',
                )
              }
            />
          )}
        </div>
        <div>
          {languages.length === 0 ? (
            <p>
              {mode === 'atelier'
                ? 'Aucune voix dans vos langues pour cette section.'
                : 'Aucune voix, et aucune langue où vous pouvez enregistrer.'}
            </p>
          ) : (
            <ul className="ui-list" aria-label={`Voix : ${section.libelle}`}>
              {languages.map((e) => {
                const can = actionsFor(e, voices, mode);
                return (
                  <li key={e.langue}>
                    <strong>{e.langueNom}</strong>{' '}
                    {e.statut ? (
                      <Badge tone={STATUS[e.statut][1]}>{STATUS[e.statut][0]}</Badge>
                    ) : (
                      <Badge tone="neutral">Aucune voix</Badge>
                    )}
                    {e.statut && (
                      <span>
                        {' '}
                        · enregistrée par {e.enregistrePar}
                        {!e.consentement && ' · sans consentement de publication'}
                        {e.motif && ` · renvoyée : ${e.motif}`}
                        {section.type === 'effets_indesirables' &&
                          e.statut === 'valide' &&
                          (e.controle
                            ? ' · contrôlée par le Comité'
                            : ' · contrôle du Comité attendu')}
                      </span>
                    )}
                    {e.statut && (
                      <audio
                        controls
                        preload="none"
                        aria-label={`${section.libelle}, voix en ${e.langueNom}`}
                      >
                        <source
                          src={treatmentVoiceAudioUrl(voices.code, section.type, e.langue)}
                          type="audio/webm"
                        />
                        {e.secours && (
                          <source
                            src={treatmentVoiceAudioUrl(voices.code, section.type, e.langue, true)}
                            type="audio/mp4"
                          />
                        )}
                      </audio>
                    )}
                    <div className="ui-actions">
                      {can.record && (
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() => setForm({ kind: 'record', langue: e.langue })}
                        >
                          {e.statut ? 'Réenregistrer' : 'Enregistrer'}{' '}
                          <span className="ui-visually-hidden">en {e.langueNom}</span>
                        </Button>
                      )}
                      {can.send && (
                        <Button
                          variant="primary"
                          disabled={busy}
                          onClick={() =>
                            act(
                              () =>
                                moveTreatmentVoice(voices.code, section.type, e.langue, 'traduit'),
                              `Voix en ${e.langueNom} envoyée à l’administrateur régional.`,
                            )
                          }
                        >
                          Envoyer au régional{' '}
                          <span className="ui-visually-hidden">la voix en {e.langueNom}</span>
                        </Button>
                      )}
                      {can.validate && (
                        <Button
                          variant="primary"
                          disabled={busy}
                          onClick={() =>
                            act(
                              () =>
                                moveTreatmentVoice(voices.code, section.type, e.langue, 'valide'),
                              `Voix en ${e.langueNom} validée.`,
                            )
                          }
                        >
                          Valider{' '}
                          <span className="ui-visually-hidden">la voix en {e.langueNom}</span>
                        </Button>
                      )}
                      {can.control && (
                        <Button
                          variant="primary"
                          disabled={busy}
                          onClick={() =>
                            act(
                              () =>
                                moveTreatmentVoice(voices.code, section.type, e.langue, 'controle'),
                              `Voix en ${e.langueNom} contrôlée : elle peut être publiée.`,
                            )
                          }
                        >
                          Contrôler{' '}
                          <span className="ui-visually-hidden">la voix en {e.langueNom}</span>
                        </Button>
                      )}
                      {can.control && (
                        <Button
                          variant="tertiary"
                          disabled={busy}
                          onClick={() => setForm({ kind: 'refuse', langue: e.langue })}
                        >
                          Renvoyer{' '}
                          <span className="ui-visually-hidden">la voix en {e.langueNom}</span>
                        </Button>
                      )}
                      {can.sendBack && (
                        <Button
                          variant="tertiary"
                          disabled={busy}
                          onClick={() => setForm({ kind: 'sendBack', langue: e.langue })}
                        >
                          Renvoyer{' '}
                          <span className="ui-visually-hidden">la voix en {e.langueNom}</span>
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
      {sendBackLanguage && (
        <SendBackForm
          title={`${section.libelle} : renvoyer la voix en ${languageName(sendBackLanguage)}`}
          busy={busy}
          onCancel={() => setForm(null)}
          onSubmit={(motif) =>
            act(
              () =>
                moveTreatmentVoice(voices.code, section.type, sendBackLanguage, 'brouillon', motif),
              'Voix renvoyée en brouillon avec le motif.',
            )
          }
        />
      )}
      {refuseLanguage && (
        <SendBackForm
          title={`${section.libelle} : renvoyer la voix en ${languageName(refuseLanguage)}`}
          busy={busy}
          onCancel={() => setForm(null)}
          onSubmit={(motif) =>
            act(
              () =>
                moveTreatmentVoice(
                  voices.code,
                  section.type,
                  refuseLanguage,
                  'controle_refuse',
                  motif,
                ),
              'Voix renvoyée en brouillon avec le motif du Comité.',
            )
          }
        />
      )}
      {recordLanguage && (
        <RecordForm
          title={`${section.libelle} : voix en ${languageName(recordLanguage)}`}
          hint="La section dite à voix haute, 3 Mo au plus. Un nouvel enregistrement remplace la voix et la remet en brouillon."
          busy={busy}
          onCancel={() => setForm(null)}
          onSubmit={(file, consent) =>
            act(async () => {
              const depot = await depositVoice(file, consent);
              return recordTreatmentVoice(voices.code, section.type, recordLanguage, depot);
            }, 'Voix enregistrée : elle est en brouillon.')
          }
        />
      )}
    </section>
  );
}

function ReviseForm({
  section,
  busy,
  onCancel,
  onSubmit,
}: {
  section: TreatmentVoiceSection;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (texteFr: string, texteEn: string | null) => void;
}) {
  const [texteFr, setTexteFr] = useState(section.texteFr ?? '');
  const [texteEn, setTexteEn] = useState(section.texteEn ?? '');
  const [error, setError] = useState<string>();
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => field.current?.focus(), []);

  function submit(event: FormEvent) {
    event.preventDefault();
    const fr = texteFr.trim();
    if (!fr) {
      setError('Saisissez le texte français de la section.');
      return field.current?.focus();
    }
    onSubmit(fr, texteEn.trim() || null);
  }

  const titleId = `reviser-${section.type}`;
  return (
    <form className="ui-form" noValidate onSubmit={submit} aria-labelledby={titleId}>
      <h4 id={titleId}>Réviser : {section.libelle}</h4>
      <TextAreaField
        ref={field}
        label="Texte français"
        hint="Résumé clair et fidèle aux paroles du praticien. Les voix déjà enregistrées de cette section reviendront en brouillon."
        value={texteFr}
        maxLength={TEXT_MAX_LENGTH}
        error={error}
        aria-required="true"
        onChange={(event) => setTexteFr(event.target.value)}
      />
      <TextAreaField
        label="Texte anglais (facultatif)"
        hint="À défaut, le texte français est affiché."
        value={texteEn}
        maxLength={TEXT_MAX_LENGTH}
        lang="en"
        onChange={(event) => setTexteEn(event.target.value)}
      />
      <div className="ui-form__actions">
        <Button type="submit" variant="primary" disabled={busy}>
          Enregistrer la révision
        </Button>
        <Button variant="tertiary" disabled={busy} onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </form>
  );
}
