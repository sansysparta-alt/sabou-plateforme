import type { Metadata } from 'next';
import Link from 'next/link';
import styles from '../Forms.module.css';
import SignupFlow from './SignupFlow';

export const metadata: Metadata = {
  title: 'Créer un compte — SABOU',
  description: 'Créez un compte gratuit avec votre numéro de téléphone.',
};

export default function SignupPage() {
  return (
    <main className={styles.page}>
      <h1>Créer un compte gratuit</h1>
      <p>Avec un compte, vous pouvez témoigner et demander une plante.</p>
      <SignupFlow />
      <p>
        Déjà un compte ? <Link href="/connexion">Se connecter</Link>
      </p>
    </main>
  );
}
