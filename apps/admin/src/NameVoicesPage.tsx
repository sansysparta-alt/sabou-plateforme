import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Badge,
  Button,
  DataTable,
  ListToolbar,
  PageHeader,
  SearchBox,
  SegmentedFilter,
  foldText,
} from '@sabou/ui';
import type {
  NameVoiceObject,
  NameVoices,
  NameVoicesEntry,
  NameVoiceStatus,
  NameVoiceTarget,
} from '@sabou/types';
import { ApiError } from './accounts-api';
import { depositVoice } from './local-names-api';
import {
  fetchNameVoices,
  listNameVoiceTargets,
  moveNameVoice,
  nameVoiceAudioUrl,
  recordNameVoice,
} from './name-voices-api';
import { PAGE_HEADERS } from './page-headers';
import { RecordForm, SendBackForm, STATUS } from './VoiceForms';

// Voix du nom des plantes et des maladies (US-071, UC-33, UC-41) : par langue, la voix suit
// Brouillon → Traduit → Validé → Publié (R-LNG-10). Le référent enregistre et présente la voix ;
// un valideur de la langue, qui ne l'a pas enregistrée, l'écoute puis la valide ou la renvoie ;
// la DG publie, si la personne qui parle a consenti (R-LNG-11). La base contrôle chaque geste.

const OBJECT_LABEL: Record<NameVoiceObject, string> = { plante: 'Plante', maladie: 'Maladie' };

const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : 'Une erreur est survenue.';

type KindFilter = 'toutes' | NameVoiceObject;

export function NameVoicesPage() {
  const [targets, setTargets] = useState<NameVoiceTarget[] | null>(null);
  const [current, setCurrent] = useState<NameVoices | null>(null);
  const [loadError, setLoadError] = useState<string>();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<KindFilter>('toutes');
  const title = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    let active = true;
    listNameVoiceTargets().then(
      (rows) => active && setTargets(rows),
      (error: unknown) => active && setLoadError(errorMessage(error)),
    );
    return () => {
      active = false;
    };
  }, []);

  const currentKey = current ? `${current.objet}/${current.code}` : null;
  useEffect(() => {
    if (currentKey) title.current?.focus();
  }, [currentKey]);

  async function open(target: NameVoiceTarget) {
    try {
      setCurrent(await fetchNameVoices(target.objet, target.code));
      setLoadError(undefined);
    } catch (error) {
      setLoadError(errorMessage(error));
    }
  }

  // Gabarit de liste (05 §2.45) : la liste entière est reçue en une fois ; la recherche et le
  // filtre s'appliquent ici, sans nouvel appel
  const all = targets ?? [];
  const term = foldText(query.trim());
  const count = (wanted: KindFilter) =>
    all.filter((t) => wanted === 'toutes' || t.objet === wanted).length;
  const rows = all.filter(
    (t) =>
      (kind === 'toutes' || t.objet === kind) && (term === '' || foldText(t.nom).includes(term)),
  );

  return (
    <>
      <PageHeader {...PAGE_HEADERS['/voix-des-noms']} />
      {loadError && <Alert tone="error">{loadError}</Alert>}
      {targets === null && !loadError && <p>Chargement…</p>}
      {targets && (
        <ListToolbar>
          <SearchBox
            label="Rechercher une fiche"
            placeholder="Nom de la plante ou de la maladie"
            value={query}
            onChange={setQuery}
          />
          <SegmentedFilter
            label="Filtrer par fiche"
            value={kind}
            onChange={setKind}
            options={[
              { value: 'toutes', label: 'Toutes', count: count('toutes') },
              { value: 'plante', label: 'Plantes', count: count('plante') },
              { value: 'maladie', label: 'Maladies', count: count('maladie') },
            ]}
          />
        </ListToolbar>
      )}
      {targets && (
        <DataTable
          caption="Fiches du Dictionnaire"
          captionHidden
          rows={rows}
          rowKey={(t) => `${t.objet}/${t.code}`}
          empty={
            term || kind !== 'toutes'
              ? 'Aucune fiche ne correspond.'
              : 'Aucune fiche pour l’instant.'
          }
          paginate={{ key: 'voix-des-noms', noun: ['fiche', 'fiches'], resetOn: [term, kind] }}
          columns={[
            { key: 'nom', header: 'Nom', render: (t) => t.nom },
            { key: 'objet', header: 'Fiche', render: (t) => OBJECT_LABEL[t.objet] },
            { key: 'publiees', header: 'Langues publiées', render: (t) => t.publiees },
            { key: 'encours', header: 'À valider ou publier', render: (t) => t.enCours },
            {
              key: 'action',
              header: 'Action',
              actions: true,
              render: (t) => (
                <Button variant="secondary" onClick={() => open(t)}>
                  Voix <span className="ui-visually-hidden">du nom {t.nom}</span>
                </Button>
              ),
            },
          ]}
        />
      )}
      {current && (
        <section className="ui-section" aria-labelledby="voix-titre">
          <h2 id="voix-titre" ref={title} tabIndex={-1}>
            {OBJECT_LABEL[current.objet]} : {current.nom}
          </h2>
          <VoicesTable voices={current} onChange={setCurrent} />
        </section>
      )}
    </>
  );
}

// Gestes possibles pour le compte connecté ; la base les contrôle aussi
function actionsFor(entry: NameVoicesEntry, dg: boolean) {
  return {
    record: entry.peutEnregistrer,
    submit: entry.statut === 'brouillon' && (entry.parMoi || entry.peutTraduire),
    validate: entry.statut === 'traduit' && entry.peutValider && !entry.parMoi,
    sendBack: (entry.statut === 'traduit' || entry.statut === 'valide') && entry.peutValider,
    publish: entry.statut === 'valide' && dg,
  };
}

function VoicesTable({
  voices,
  onChange,
}: {
  voices: NameVoices;
  onChange: (v: NameVoices) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [form, setForm] = useState<{ langue: string; kind: 'record' | 'sendBack' } | null>(null);

  async function act(run: () => Promise<NameVoices>, done: string) {
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

  const move = (
    entry: NameVoicesEntry,
    vers: NameVoiceStatus,
    done: string,
    motif: string | null = null,
  ) => act(() => moveNameVoice(voices.objet, voices.code, entry.langue, vers, motif), done);

  return (
    <>
      {error && <Alert tone="error">{error}</Alert>}
      {notice && <Alert tone="success">{notice}</Alert>}
      <DataTable
        caption="Voix du nom, par langue"
        rows={voices.voix}
        rowKey={(entry) => entry.langue}
        empty="Aucune langue de voix active."
        columns={[
          { key: 'langue', header: 'Langue', render: (e) => e.langueNom },
          {
            key: 'statut',
            header: 'Statut',
            render: (e) =>
              e.statut ? (
                <Badge tone={STATUS[e.statut][1]}>{STATUS[e.statut][0]}</Badge>
              ) : (
                'Aucune voix'
              ),
          },
          {
            key: 'detail',
            header: 'Détail',
            render: (e) =>
              e.statut ? (
                <>
                  <span>Enregistrée par {e.enregistrePar}</span>
                  {!e.consentement && <span> · sans consentement de publication</span>}
                  {e.motif && <span> · renvoyée : {e.motif}</span>}
                </>
              ) : (
                '—'
              ),
          },
          {
            key: 'ecoute',
            header: 'Écoute',
            render: (e) =>
              e.statut ? (
                <audio controls preload="none" aria-label={`Voix du nom en ${e.langueNom}`}>
                  <source
                    src={nameVoiceAudioUrl(voices.objet, voices.code, e.langue)}
                    type="audio/webm"
                  />
                  {e.secours && (
                    <source
                      src={nameVoiceAudioUrl(voices.objet, voices.code, e.langue, true)}
                      type="audio/mp4"
                    />
                  )}
                </audio>
              ) : (
                '—'
              ),
          },
          {
            key: 'actions',
            header: 'Actions',
            render: (e) => {
              const can = actionsFor(e, voices.dg);
              const hidden = (
                <>
                  {' '}
                  <span className="ui-visually-hidden">en {e.langueNom}</span>
                </>
              );
              return (
                <div className="ui-actions">
                  {can.record && (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() => setForm({ langue: e.langue, kind: 'record' })}
                    >
                      {e.statut ? 'Réenregistrer' : 'Enregistrer'}
                      {hidden}
                    </Button>
                  )}
                  {can.submit && (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        move(e, 'traduit', `Voix en ${e.langueNom} présentée à la validation.`)
                      }
                    >
                      Présenter à la validation{hidden}
                    </Button>
                  )}
                  {can.validate && (
                    <Button
                      variant="primary"
                      disabled={busy}
                      onClick={() => move(e, 'valide', `Voix en ${e.langueNom} validée.`)}
                    >
                      Valider{hidden}
                    </Button>
                  )}
                  {can.sendBack && (
                    <Button
                      variant="tertiary"
                      disabled={busy}
                      onClick={() => setForm({ langue: e.langue, kind: 'sendBack' })}
                    >
                      Renvoyer{hidden}
                    </Button>
                  )}
                  {can.publish && (
                    <Button
                      variant="primary"
                      disabled={busy}
                      onClick={() => move(e, 'publie', `Voix en ${e.langueNom} publiée.`)}
                    >
                      Publier{hidden}
                    </Button>
                  )}
                </div>
              );
            },
          },
        ]}
      />
      {form?.kind === 'record' && (
        <RecordForm
          title={`Voix du nom en ${voices.voix.find((e) => e.langue === form.langue)!.langueNom}`}
          hint="Le nom prononcé, 3 Mo au plus. Un nouvel enregistrement remplace la voix et la remet en brouillon."
          busy={busy}
          onCancel={() => setForm(null)}
          onSubmit={(file, consent) =>
            act(async () => {
              const depot = await depositVoice(file, consent);
              return recordNameVoice(voices.objet, voices.code, form.langue, depot);
            }, 'Voix enregistrée : elle est en brouillon.')
          }
        />
      )}
      {form?.kind === 'sendBack' && (
        <SendBackForm
          title={`Renvoyer la voix en ${voices.voix.find((e) => e.langue === form.langue)!.langueNom}`}
          busy={busy}
          onCancel={() => setForm(null)}
          onSubmit={(motif) =>
            move(
              voices.voix.find((e) => e.langue === form.langue)!,
              'brouillon',
              'Voix renvoyée en brouillon avec le motif.',
              motif,
            )
          }
        />
      )}
    </>
  );
}
