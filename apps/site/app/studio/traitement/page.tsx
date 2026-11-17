import type { Metadata } from 'next';
import forms from '../../Forms.module.css';
import styles from '../Studio.module.css';
import TreatmentEditor from '../TreatmentEditor';

export const metadata: Metadata = {
  title: 'Traitement — Studio — SABOU',
  robots: { index: false },
};

// Création (sans code) ou modification d'un traitement (US-060)
export default async function TreatmentPage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string | string[] }>;
}) {
  const { code } = await searchParams;
  const value = typeof code === 'string' && /^REC-\d{4,10}$/.test(code) ? code : null;
  return (
    <main className={`${forms.page} ${styles.page}`}>
      <p>
        <a href="/studio">← Mes traitements</a>
      </p>
      <TreatmentEditor code={value} />
    </main>
  );
}
