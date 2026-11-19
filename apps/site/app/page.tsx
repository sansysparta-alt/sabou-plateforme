import Link from 'next/link';

export default function HomePage() {
  return (
    <main>
      <h1>SABOU</h1>
      <p>Plateforme nationale de la médecine traditionnelle guinéenne.</p>
      <p>Site en construction.</p>
      <nav aria-label="Compte">
        <ul>
          <li>
            <Link href="/inscription">Créer un compte gratuit</Link>
          </li>
          <li>
            <Link href="/connexion">Se connecter</Link>
          </li>
        </ul>
      </nav>
      {/* US-100 : signalement ouvert à tous, sans compte */}
      <p>
        <Link href="/signaler">Signaler un danger ou un effet indésirable</Link>
      </p>
    </main>
  );
}
