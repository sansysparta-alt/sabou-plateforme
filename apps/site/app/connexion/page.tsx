import type { Metadata } from 'next';
import Link from 'next/link';
import styles from '../Forms.module.css';
import { loginHref } from '../links';

export const metadata: Metadata = {
  title: 'Se connecter — SABOU',
  description: 'Connectez-vous à SABOU avec votre numéro de téléphone.',
};

// Erreurs renvoyées par l'API après un retour de Keycloak (?erreur=…)
const ERRORS: Record<string, string> = {
  connexion: 'La connexion n’a pas abouti. Réessayez.',
  annulee: 'Connexion annulée.',
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ erreur?: string | string[] }>;
}) {
  const { erreur } = await searchParams;
  const message = typeof erreur === 'string' ? ERRORS[erreur] : undefined;
  return (
    <main className={styles.page}>
      <h1>Se connecter</h1>
      {message ? (
        <p className={styles.error} role="alert">
          {message}
        </p>
      ) : null}
      <p>Connectez-vous avec votre numéro de téléphone et votre mot de passe.</p>
      <div className={styles.actions}>
        <a className={styles.link} href={loginHref()}>
          Se connecter
        </a>
      </div>
      <p>
        <Link href="/mot-de-passe-oublie">Mot de passe oublié ?</Link>
      </p>
      <p>
        Pas encore de compte ? <Link href="/inscription">Créer un compte gratuit</Link>
      </p>
    </main>
  );
}
