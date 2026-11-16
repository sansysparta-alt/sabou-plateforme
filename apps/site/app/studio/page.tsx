import type { Metadata } from 'next';
import forms from '../Forms.module.css';
import styles from './Studio.module.css';
import StudioList from './StudioList';

export const metadata: Metadata = {
  title: 'Studio — SABOU',
  robots: { index: false },
};

// Studio web du praticien (US-060, UC-21)
export default function StudioPage() {
  return (
    <main className={`${forms.page} ${styles.page}`}>
      <h1>Studio</h1>
      <p className={forms.help}>
        Préparez vos traitements pour la certification : maladie, plantes, cycle et sections.
      </p>
      <StudioList />
    </main>
  );
}
