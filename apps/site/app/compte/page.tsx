import type { Metadata } from 'next';
import styles from '../Forms.module.css';
import Account from './Account';

export const metadata: Metadata = {
  title: 'Mon compte — SABOU',
  robots: { index: false },
};

export default function AccountPage() {
  return (
    <main className={styles.page}>
      <h1>Mon compte</h1>
      <Account />
    </main>
  );
}
