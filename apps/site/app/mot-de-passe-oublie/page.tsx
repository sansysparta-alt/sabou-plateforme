import type { Metadata } from 'next';
import Link from 'next/link';
import styles from '../Forms.module.css';
import ResetFlow from './ResetFlow';

export const metadata: Metadata = {
  title: 'Mot de passe oublié — SABOU',
  description: 'Choisissez un nouveau mot de passe grâce à un code reçu par SMS.',
};

// US-069 : ouverte depuis « Se connecter » et depuis la page de connexion de Keycloak
export default function PasswordResetPage() {
  return (
    <main className={styles.page}>
      <h1>Mot de passe oublié</h1>
      <p>
        Recevez un code par SMS sur le numéro de votre compte, puis choisissez un nouveau mot de
        passe.
      </p>
      <ResetFlow />
      <p>
        Vous vous en souvenez ? <Link href="/connexion">Se connecter</Link>
      </p>
    </main>
  );
}
