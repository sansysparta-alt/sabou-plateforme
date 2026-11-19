import type { Metadata } from 'next';
import styles from '../Forms.module.css';
import ReportForm from './ReportForm';

export const metadata: Metadata = {
  title: 'Signaler un danger — SABOU',
  description:
    'Signalez un danger ou un effet indésirable lié à un traitement ou à une plante publiés sur SABOU.',
};

// US-100 (R-SAN-01, R-SAN-02) : ouverte à tous, sans compte. Lien direct avec le code
// prérempli (/signaler?code=REC-2041) ; les boutons des pages traitement et plante viendront
// avec ces pages (sprints 10 et 11). Page statique : le code est lu dans l'adresse par le
// navigateur, pour rester rapide en 3G.
export default function ReportPage() {
  return (
    <main className={styles.page}>
      <h1>Signaler un danger</h1>
      <p>
        Un traitement ou une plante publiés sur SABOU vous ont causé, ou à un proche, un effet
        inattendu ? Dites-le au Comité scientifique : il examine chaque signalement, les plus graves
        sous 24 heures, et peut retirer un traitement du site.
      </p>
      <p>
        <strong>En cas d’urgence</strong>, rendez-vous sans attendre au centre de santé le plus
        proche. Ce signalement ne remplace pas un avis médical.
      </p>
      <ReportForm />
    </main>
  );
}
