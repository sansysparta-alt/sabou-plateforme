import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { Alert, Badge, Button, PageHeader, SelectField } from '@sabou/ui';
import type { DesignableAgent, FieldDossierDesignation } from '@sabou/types';
import { ApiError } from './accounts-api';
import { designateVerifier, listDesignations } from './field-dossiers-api';
import { PAGE_HEADERS } from './page-headers';

// Agent de vérification d'un dossier terrain (US-040d, décision du maître d'œuvre du 19/11) :
// l'auteur d'un dossier terrain ne le vérifie pas lui-même ; quand la préfecture n'a qu'un
// agent, l'admin régional désigne un autre agent préfectoral de sa région. La base contrôle
// le rôle, la région, l'auteur et l'étape, et journalise la désignation.

const message = (failure: unknown) =>
  failure instanceof ApiError
    ? failure.message
    : 'Le service est momentanément indisponible. Veuillez réessayer.';

export function VerifierDesignationPage() {
  const [data, setData] = useState<{
    dossiers: FieldDossierDesignation[];
    agents: DesignableAgent[];
  }>();
  const [loadError, setLoadError] = useState<string>();
  const [notice, setNotice] = useState('');

  const reload = useCallback(
    () => listDesignations().then(setData, (failure: unknown) => setLoadError(message(failure))),
    [],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <>
      <PageHeader {...PAGE_HEADERS['/agents-verification']} />
      {loadError && <Alert tone="error">{loadError}</Alert>}
      <p role="status" className="ui-live-status">
        {notice}
      </p>
      <section aria-labelledby="designations-liste">
        <h2 id="designations-liste">Dossiers terrain de la région</h2>
        {data === undefined ? (
          !loadError && <p className="ui-muted">Chargement des dossiers…</p>
        ) : data.dossiers.length === 0 ? (
          <p className="ui-muted">
            Aucun dossier terrain en attente de vérification dans votre région.
          </p>
        ) : (
          <ul className="ui-list" aria-label="Dossiers terrain à vérifier">
            {data.dossiers.map((dossier) => (
              <li key={dossier.code}>
                <DesignationCard
                  dossier={dossier}
                  agents={data.agents}
                  onDesignated={async (agent) => {
                    setNotice(
                      `Dossier ${dossier.code} : ${agent} est désigné pour la vérification. Lui seul vérifie désormais ce dossier.`,
                    );
                    await reload();
                  }}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function DesignationCard({
  dossier,
  agents,
  onDesignated,
}: {
  dossier: FieldDossierDesignation;
  agents: DesignableAgent[];
  onDesignated: (agent: string) => Promise<void>;
}) {
  const id = useId();
  // L'auteur n'est jamais désignable ; l'agent déjà désigné reste dans la liste
  const choices = agents.filter((agent) => agent.id !== dossier.auteurId);
  const [agentId, setAgentId] = useState('');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const agent = choices.find((candidate) => String(candidate.id) === agentId);
    if (!agent) {
      setError('Choisissez un agent.');
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await designateVerifier(dossier.code, agent.id);
      setAgentId('');
      await onDesignated(agent.nom);
    } catch (failure) {
      setError(message(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="ui-card" aria-labelledby={`${id}-nom`}>
      <h3 id={`${id}-nom`}>
        {dossier.praticien} <span className="ui-muted">· {dossier.code}</span>
      </h3>
      <dl className="ui-facts">
        <dt>Préfecture</dt>
        <dd>{dossier.prefecture}</dd>
        <dt>Étape</dt>
        <dd>{dossier.etape === 1 ? '1 · constitution du dossier' : '2 · vérification terrain'}</dd>
        <dt>Créé par</dt>
        <dd>{dossier.auteur}</dd>
        <dt>Agent de vérification</dt>
        <dd>
          {dossier.verificateur ? (
            <>
              {dossier.verificateur.nom} ({dossier.verificateur.prefecture}){' '}
              <Badge tone="success">Désigné</Badge>
            </>
          ) : (
            'Un agent de la préfecture, autre que l’auteur'
          )}
        </dd>
      </dl>
      <form
        noValidate
        onSubmit={submit}
        aria-label={`Désigner l’agent de vérification du dossier ${dossier.code}`}
      >
        <SelectField
          id={`${id}-agent`}
          label={dossier.verificateur ? 'Changer d’agent' : 'Désigner un agent'}
          value={agentId}
          error={error}
          onChange={(event) => setAgentId(event.target.value)}
        >
          <option value="">Choisir…</option>
          {choices.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.nom} · {agent.prefecture}
            </option>
          ))}
        </SelectField>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? 'Désignation…' : 'Désigner'}
        </Button>
      </form>
    </article>
  );
}
