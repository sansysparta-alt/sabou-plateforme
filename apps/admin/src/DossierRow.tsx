import type { ReactNode } from 'react';

// Un dossier de la file, replié sur une ligne (maquette v1.3, US-019) : code, praticien et
// repères ; ouvert, son détail et les décisions. <details> natif : clavier et lecteurs d'écran
// sans script, le titre reste dans la navigation par titres.
export function DossierRow({
  code,
  name,
  meta,
  defaultOpen = false,
  children,
}: {
  code: string;
  name: string;
  meta: ReactNode;
  // Ouvert au chargement (dossier terrain qui vient d'être créé, à compléter)
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="ui-dossier">
      <details open={defaultOpen || undefined}>
        <summary className="ui-dossier__summary">
          <h3 className="ui-dossier__title">
            {code} · {name}
          </h3>
          <span className="ui-dossier__meta">{meta}</span>
          <span className="ui-dossier__toggle" aria-hidden="true" />
        </summary>
        <div className="ui-dossier__body">{children}</div>
      </details>
    </li>
  );
}
