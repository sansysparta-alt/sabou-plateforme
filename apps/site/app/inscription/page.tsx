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
      {/* US-068 : le praticien a sa propre application ; le site ne sert que le grand public */}
      <aside className={styles.notice} aria-labelledby="praticien-titre">
        <h2 id="praticien-titre" className={styles.label}>
          Vous êtes praticien de la médecine traditionnelle ?
        </h2>
        <p>
          Installez l’application mobile SABOU : vous y créez votre compte, remplissez votre dossier
          de certification et saisissez vos traitements.
        </p>
      </aside>
      <SignupFlow />
      <p>
        Déjà un compte ? <Link href="/connexion">Se connecter</Link>
      </p>
    </main>
  );
}
