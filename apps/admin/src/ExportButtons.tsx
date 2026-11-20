import { useState } from 'react';
import type { ExportFormat, ExportRequest } from '@sabou/types';
import { Alert, Button } from '@sabou/ui';
import { ApiError } from './accounts-api';
import { downloadExport } from './reports-api';

// Boutons d'export PDF et XLSX (US-091) : l'API garde la photographie des données dans
// l'historique des exports, puis le navigateur télécharge le fichier. Petit module à part :
// le tableau de bord ne charge pas la page des rapports.

export function ExportButtons({
  request,
  subject,
  open,
}: {
  request: (format: ExportFormat) => ExportRequest;
  // Ce qui est exporté, pour les lecteurs d'écran (ex. « le tableau de bord »)
  subject: string;
  open?: (url: string) => void;
}) {
  const [busy, setBusy] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string>();

  async function run(format: ExportFormat) {
    setBusy(format);
    setError(undefined);
    try {
      await downloadExport(request(format), open);
    } catch (failure) {
      setError(failure instanceof ApiError ? failure.message : 'L’export n’a pas pu être préparé.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="ui-form__actions">
        <Button variant="secondary" disabled={busy !== null} onClick={() => run('pdf')}>
          {busy === 'pdf' ? 'Préparation…' : 'Exporter en PDF'}{' '}
          <span className="ui-visually-hidden">{subject}</span>
        </Button>
        <Button variant="secondary" disabled={busy !== null} onClick={() => run('xlsx')}>
          {busy === 'xlsx' ? 'Préparation…' : 'Exporter en XLSX'}{' '}
          <span className="ui-visually-hidden">{subject}</span>
        </Button>
      </div>
      {error && <Alert tone="error">{error}</Alert>}
    </>
  );
}
