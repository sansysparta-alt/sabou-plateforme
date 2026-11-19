import { useEffect, useState } from 'react';
import { Alert, Button, DataTable, PageHeader } from '@sabou/ui';
import type { VoiceCoverage, VoiceCoverageLanguage } from '@sabou/types';
import { ApiError } from './accounts-api';
import { PAGE_HEADERS } from './page-headers';
import { fetchVoiceCoverage, publishVoices } from './treatment-voices-api';

// Couverture vocale (US-074, UC-63, R-GOV-05) : la DG suit, pour chaque langue de voix, la part
// des sections des traitements certifiés dont la voix est publiée, et les retards par région ;
// elle publie d'un geste les voix validées, d'une langue ou de toutes. La base ne publie que
// les voix publiables (consentements, contrôle du Comité pour les effets indésirables) et
// compte les autres comme bloquées.

const errorMessage = (error: unknown) =>
  error instanceof ApiError ? error.message : 'Une erreur est survenue.';

const percent = (l: VoiceCoverageLanguage) =>
  l.sections === 0 ? 0 : Math.round((100 * l.publiees) / l.sections);

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

export function VoiceCoveragePage() {
  const [coverage, setCoverage] = useState<VoiceCoverage | null>(null);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetchVoiceCoverage().then(
      (c) => active && setCoverage(c),
      (failure: unknown) => active && setError(errorMessage(failure)),
    );
    return () => {
      active = false;
    };
  }, []);

  async function publish(langue: string | null, label: string) {
    setBusy(true);
    setError(undefined);
    setNotice(undefined);
    try {
      const result = await publishVoices(langue);
      setCoverage(await fetchVoiceCoverage());
      setNotice(
        `${label} : ${plural(result.publiees, 'voix publiée', 'voix publiées')}` +
          (result.bloquees
            ? `, ${plural(result.bloquees, 'voix bloquée', 'voix bloquées')} (consentement ou contrôle du Comité manquant).`
            : '.'),
      );
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  const publishable = (l: VoiceCoverageLanguage) => l.validees - l.bloquees;
  const total = coverage?.langues.reduce((n, l) => n + publishable(l), 0) ?? 0;

  return (
    <>
      <PageHeader
        {...PAGE_HEADERS['/couverture-vocale']}
        actions={
          coverage && (
            <Button
              variant="primary"
              disabled={busy || total === 0}
              onClick={() => publish(null, 'Toutes les langues')}
            >
              Publier toutes les voix validées ({total})
            </Button>
          )
        }
      />
      {error && <Alert tone="error">{error}</Alert>}
      {notice && (
        <p role="status" className="ui-live-status">
          {notice}
        </p>
      )}
      {!coverage && !error && <p>Chargement…</p>}
      {coverage && (
        <>
          <DataTable
            caption="Couverture par langue (sections des traitements certifiés)"
            rows={coverage.langues}
            rowKey={(l) => l.langue}
            empty="Aucune langue de voix active."
            columns={[
              { key: 'langue', header: 'Langue', render: (l) => l.langueNom },
              {
                key: 'couverture',
                header: 'Sections publiées',
                render: (l) => (
                  <>
                    <strong>{percent(l)} %</strong> ({l.publiees} sur {l.sections})
                  </>
                ),
              },
              {
                key: 'validees',
                header: 'Validées à publier',
                render: (l) =>
                  l.bloquees ? `${publishable(l)} (+ ${l.bloquees} bloquées)` : publishable(l),
              },
              {
                key: 'action',
                header: 'Action',
                actions: true,
                render: (l) => (
                  <Button
                    variant="secondary"
                    disabled={busy || publishable(l) === 0}
                    onClick={() => publish(l.langue, l.langueNom)}
                  >
                    Publier <span className="ui-visually-hidden">les voix en {l.langueNom}</span>
                  </Button>
                ),
              },
            ]}
          />
          <DataTable
            caption="Retards par région : voix en attente depuis plus de 7 jours"
            rows={coverage.retards}
            rowKey={(r) => r.region}
            empty="Aucun retard."
            columns={[
              { key: 'region', header: 'Région', render: (r) => r.region },
              { key: 'brouillons', header: 'En brouillon', render: (r) => r.brouillons },
              { key: 'envoyees', header: 'À valider', render: (r) => r.envoyees },
              { key: 'validees', header: 'À publier', render: (r) => r.validees },
              {
                key: 'depuis',
                header: 'Plus ancienne',
                render: (r) => new Date(`${r.plusAncienne}T00:00:00`).toLocaleDateString('fr-FR'),
              },
            ]}
          />
        </>
      )}
    </>
  );
}
