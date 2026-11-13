import { useEffect, useState } from 'react';
import { Alert, Badge, Button, type BadgeTone } from '@sabou/ui';
import type { CertificateView } from '@sabou/types';
import { ApiError } from './accounts-api';
import { fetchCertificate } from './certification-api';

// Certificat signé, page à imprimer (US-045 ; décision du maître d'œuvre du 12 novembre 2026 :
// données, QR et empreinte ; le PDF viendra en S9). À l'impression, seuls le certificat et
// ses mentions restent : bandeau, menu et boutons sont masqués (feuille « print » de @sabou/ui).

const STATUS: Record<CertificateView['statut'], { label: string; tone: BadgeTone }> = {
  actif: { label: 'Actif', tone: 'success' },
  expire: { label: 'Expiré', tone: 'warning' },
  revoque: { label: 'Révoqué', tone: 'error' },
};

const date = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { dateStyle: 'long', timeZone: 'UTC' });

// Empreinte en blocs de 4 caractères, comme sur la page de vérification (05 §2.16)
const blocks = (hex: string) => hex.match(/.{1,4}/g)?.join(' ') ?? hex;

export function CertificatePage({ numero }: { numero: string }) {
  const [certificate, setCertificate] = useState<CertificateView | null>(null);
  const [error, setError] = useState<string>();

  useEffect(() => {
    fetchCertificate(numero).then(setCertificate, (failure: unknown) =>
      setError(failure instanceof ApiError ? failure.message : 'Une erreur est survenue.'),
    );
  }, [numero]);

  if (error) return <Alert tone="error">{error}</Alert>;
  if (!certificate) return <p>Chargement…</p>;
  const status = STATUS[certificate.statut];

  return (
    <article className="ui-certificate" aria-labelledby="certificat-titre">
      <div className="ui-certificate__actions ui-no-print">
        <Button variant="primary" onClick={() => window.print()}>
          Imprimer le certificat
        </Button>
        <a href="/approbation">Retour aux dossiers à approuver</a>
      </div>
      <header className="ui-certificate__header">
        <p className="ui-certificate__authority">République de Guinée · {certificate.autorite}</p>
        <h1 id="certificat-titre">Certificat de tradipraticien</h1>
        <p>
          N° <strong>{certificate.numero}</strong> <Badge tone={status.tone}>{status.label}</Badge>
        </p>
      </header>
      <div className="ui-certificate__body">
        <dl className="ui-facts">
          <dt>Titulaire</dt>
          <dd>{certificate.titulaire}</dd>
          <dt>Praticien</dt>
          <dd>{certificate.praticien}</dd>
          <dt>Spécialité</dt>
          <dd>{certificate.specialite}</dd>
          <dt>Préfecture</dt>
          <dd>{certificate.prefecture}</dd>
          <dt>Émis le</dt>
          <dd>{date(certificate.emisLe)}</dd>
          <dt>Valable jusqu’au</dt>
          <dd>{date(certificate.expireLe)} inclus</dd>
          <dt>Dossier</dt>
          <dd>{certificate.dossier}</dd>
        </dl>
        {certificate.qrSvg ? (
          <figure className="ui-certificate__qr">
            <img
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(certificate.qrSvg)}`}
              alt={`QR code signé du certificat ${certificate.numero}`}
              width={200}
              height={200}
            />
            <figcaption>Vérifiez ce certificat sur le site SABOU, page « Vérifier un certificat ».</figcaption>
          </figure>
        ) : (
          <p className="ui-muted">Certificat d’exemple, sans QR signé.</p>
        )}
      </div>
      <footer className="ui-certificate__footer">
        <p>
          Empreinte SHA3-256 : <span className="ui-code">{blocks(certificate.empreinte)}</span>
        </p>
        <p>
          Signé électroniquement (Ed25519) par la Direction Générale · clé{' '}
          <span className="ui-code">{certificate.cle}</span>
        </p>
        <p>
          La plateforme SABOU atteste la certification du praticien. Elle informe ; elle ne prescrit
          pas.
        </p>
      </footer>
    </article>
  );
}
