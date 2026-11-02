import type { Verdict } from '@sabou/qr';
import styles from './Verifier.module.css';

const RED_MESSAGES = {
  falsifie: 'Certificat falsifié ou illisible. Ne vous fiez pas à ce document.',
  cle_inconnue:
    'Certificat signé par une clé inconnue. Il n’a pas été émis par la Direction générale.',
  cle_revoquee: 'La clé qui a signé ce certificat a été révoquée. Ne vous fiez pas à ce document.',
} as const;

function formatDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

/** Verdict de R-QR-05 : la couleur n'est jamais la seule information (WCAG 1.4.1). */
export default function VerdictView({ verdict }: { verdict: Verdict }) {
  if (verdict.color === 'rouge') {
    return (
      <div className={styles.verdict} data-color="rouge">
        <p className={styles.title}>✗ Rouge : non authentique</p>
        <p>{RED_MESSAGES[verdict.status]}</p>
      </div>
    );
  }
  const { certificate } = verdict;
  return (
    <div className={styles.verdict} data-color={verdict.color}>
      <p className={styles.title}>
        {verdict.color === 'vert'
          ? '✓ Vert : certificat authentique'
          : `! Ambre : certificat authentique mais expiré le ${formatDate(certificate.expiresOn)}`}
      </p>
      <dl className={styles.details}>
        <dt>Praticien</dt>
        <dd>{certificate.practitioner}</dd>
        <dt>Numéro</dt>
        <dd>{certificate.number}</dd>
        <dt>Valide du</dt>
        <dd>
          {formatDate(certificate.issuedOn)} au {formatDate(certificate.expiresOn)}
        </dd>
        <dt>Autorité</dt>
        <dd>{certificate.authority}</dd>
        <dt>Empreinte SHA-3</dt>
        <dd className={styles.digest}>{verdict.digest}</dd>
      </dl>
      <p className={styles.note}>
        Signature vérifiée sur ce téléphone. Une éventuelle révocation du certificat ne se vérifie
        qu’en ligne.
      </p>
    </div>
  );
}
