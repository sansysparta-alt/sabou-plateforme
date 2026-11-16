'use client';

import { useEffect, useState } from 'react';
import type { TreatmentSummary } from '@sabou/types';
import forms from '../Forms.module.css';
import { loginHref } from '../links';
import styles from './Studio.module.css';
import { STATUS_LABELS, WAITING_LABELS, accessMessage, studioApi } from './studio-api';

type State =
  | { name: 'loading' }
  | { name: 'anonymous' }
  | { name: 'error'; message: string }
  | { name: 'ready'; treatments: TreatmentSummary[] };

const DATE = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'long' });

// Liste des traitements du praticien connecté (US-060), avec leur état dans le circuit et,
// pour un traitement resté « expertisé », la raison lue sur le traitement (US-046)
export default function StudioList() {
  const [state, setState] = useState<State>({ name: 'loading' });

  useEffect(() => {
    let active = true;
    void studioApi.list().then((result) => {
      if (!active) return;
      if (result.ok) setState({ name: 'ready', treatments: result.data });
      else if (result.status === 401) setState({ name: 'anonymous' });
      else
        setState({
          name: 'error',
          message:
            accessMessage(result.status) ??
            result.message ??
            'Vos traitements ne peuvent pas être affichés. Rechargez la page.',
        });
    });
    return () => {
      active = false;
    };
  }, []);

  switch (state.name) {
    case 'loading':
      return <p role="status">Chargement…</p>;
    case 'anonymous':
      return (
        <>
          <p>Connectez-vous avec votre compte de praticien pour ouvrir le Studio.</p>
          <div className={forms.actions}>
            <a className={forms.link} href={loginHref(undefined, '/studio')}>
              Se connecter
            </a>
          </div>
        </>
      );
    case 'error':
      return (
        <p className={forms.error} role="alert">
          {state.message}
        </p>
      );
    case 'ready':
      return (
        <>
          <div className={forms.actions}>
            <a className={forms.link} href="/studio/traitement">
              + Nouveau traitement
            </a>
          </div>
          {state.treatments.length === 0 ? (
            <p>Vous n’avez encore aucun traitement.</p>
          ) : (
            <ul className={styles.list}>
              {state.treatments.map((t) => (
                <li key={t.code} className={styles.card}>
                  <a className={styles.cardTitle} href={`/studio/traitement?code=${t.code}`}>
                    {t.titreFr}
                  </a>
                  <p className={styles.meta}>
                    {t.maladie.nomFr} · {t.code} · modifié le {DATE.format(new Date(t.modifieLe))}
                  </p>
                  <p className={styles.status} data-status={t.statut}>
                    {STATUS_LABELS[t.statut]}
                  </p>
                  {t.attenteRaison && (
                    <p className={styles.waiting}>{WAITING_LABELS[t.attenteRaison]}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      );
  }
}
