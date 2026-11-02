import type { Metadata } from 'next';
import Verifier from './Verifier';
import styles from './Verifier.module.css';

export const metadata: Metadata = {
  title: 'Vérifier un certificat — SABOU',
  description: 'Vérifier l’authenticité d’un certificat de praticien, même sans réseau.',
};

export default function VerifierPage() {
  return (
    <main className={styles.page}>
      <h1>Vérifier un certificat</h1>
      <p>
        Scannez le QR code du certificat. La vérification se fait sur votre téléphone, même sans
        réseau, avec la clé publique de la Direction générale.
      </p>
      <Verifier />
    </main>
  );
}
