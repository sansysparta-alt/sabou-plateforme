'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { SessionUser } from '@sabou/types';
import { formatNationalMobile } from '@sabou/types/phone';
import styles from '../Forms.module.css';
import { loginHref } from '../links';

// Session du citoyen, lue auprès de l'API (cookie HttpOnly : aucun jeton dans la page)
type State =
  | { name: 'loading' }
  | { name: 'anonymous' }
  | { name: 'error' }
  | { name: 'signed-in'; user: SessionUser };

export default function Account() {
  const [state, setState] = useState<State>({ name: 'loading' });
  const [leaving, setLeaving] = useState(false);
  const router = useRouter();

  useEffect(() => {
    let active = true;
    fetch('/auth/citoyen/session', { cache: 'no-store' })
      .then(async (response) => {
        if (!active) return;
        if (response.status === 401) setState({ name: 'anonymous' });
        else if (response.ok)
          setState({ name: 'signed-in', user: (await response.json()) as SessionUser });
        else setState({ name: 'error' });
      })
      .catch(() => active && setState({ name: 'error' }));
    return () => {
      active = false;
    };
  }, []);

  async function logout() {
    if (leaving) return;
    setLeaving(true);
    await fetch('/auth/citoyen/logout', { method: 'POST' }).catch(() => undefined);
    router.push('/');
  }

  switch (state.name) {
    case 'loading':
      return <p role="status">Chargement…</p>;
    case 'error':
      return (
        <p className={styles.error} role="alert">
          Votre compte ne peut pas être affiché. Vérifiez votre réseau, puis rechargez la page.
        </p>
      );
    case 'anonymous':
      return (
        <>
          <p>Vous n’êtes pas connecté.</p>
          <div className={styles.actions}>
            <a className={styles.link} href={loginHref()}>
              Se connecter
            </a>
          </div>
        </>
      );
    case 'signed-in':
      return (
        <>
          <p>Bonjour {state.user.name}.</p>
          <p>Numéro de téléphone : {formatNationalMobile(state.user.username)}</p>
          <div className={styles.actions}>
            {state.user.roles.includes('praticien') && (
              <a className={styles.link} href="/studio">
                Ouvrir le Studio
              </a>
            )}
            <button
              type="button"
              className={styles.button}
              aria-disabled={leaving}
              onClick={() => void logout()}
            >
              Se déconnecter
            </button>
          </div>
        </>
      );
  }
}
