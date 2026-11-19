import { useEffect, useId, useRef, type ReactNode } from 'react';

// Un dossier dans une file (maquette v1.3, US-019 : une ligne par dossier, « Voir ») : la ligne
// donne le code, le praticien et les repères ; un clic ouvre le détail dans un panneau latéral
// (05 §2.76), la liste restant visible derrière. Fenêtre native <dialog> ouverte en modale :
// le focus reste dans le panneau, Échap, « Fermer » ou un clic à côté le referment, et le
// focus revient sur la ligne. Sur téléphone, le panneau prend tout l'écran.
export function DossierRow({
  code,
  name,
  meta,
  defaultOpen = false,
  notice,
  children,
}: {
  code: string;
  name: string;
  meta: ReactNode;
  // Ouvert au chargement (dossier terrain qui vient d'être créé, à compléter)
  defaultOpen?: boolean;
  // Dernier message d'une action faite dans le panneau (pièce déposée, visite signée…) : la
  // page derrière est inactive tant que le panneau est ouvert, le message est donc dit ici
  notice?: string;
  children: ReactNode;
}) {
  const id = useId();
  const panel = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);

  const show = () => {
    if (panel.current && !panel.current.open) panel.current.showModal();
  };
  const hide = () => panel.current?.close();

  useEffect(() => {
    // Ouverture à la première apparition seulement
    if (defaultOpen && panel.current && !panel.current.open) panel.current.showModal();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <li className="ui-dossier">
      <div className="ui-dossier__summary">
        <h3 className="ui-dossier__title">
          <button
            ref={opener}
            type="button"
            className="ui-dossier__open"
            aria-haspopup="dialog"
            onClick={show}
          >
            {code} · {name}
          </button>
        </h3>
        <span className="ui-dossier__meta">{meta}</span>
        <span className="ui-dossier__toggle" aria-hidden="true" />
      </div>
      <dialog
        ref={panel}
        className="ui-drawer"
        aria-labelledby={`${id}-titre`}
        // Clic sur le fond assombri, à côté du panneau : il se referme
        onClick={(event) => {
          if (event.target === panel.current) hide();
        }}
        onClose={() => opener.current?.focus()}
      >
        <div className="ui-drawer__panel">
          <header className="ui-drawer__header">
            <div className="ui-drawer__heading">
              <h2 id={`${id}-titre`} className="ui-drawer__title">
                {code} · {name}
              </h2>
              <div className="ui-dossier__meta">{meta}</div>
            </div>
            <button type="button" className="ui-button ui-button--secondary" onClick={hide}>
              Fermer<span className="ui-visually-hidden"> le dossier {code}</span>
            </button>
          </header>
          <div className="ui-drawer__body">
            {notice !== undefined && (
              <p role="status" className="ui-live-status">
                {notice}
              </p>
            )}
            {children}
          </div>
        </div>
      </dialog>
    </li>
  );
}
