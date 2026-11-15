import { forwardRef, type ReactNode } from 'react';
import { Icon } from './Icon';

export type AlertTone = 'info' | 'success' | 'warning' | 'error';

export interface AlertProps {
  tone?: AlertTone;
  title?: string;
  children?: ReactNode;
  id?: string;
}

// Message sobre : encadré fin tout autour, icône dessinée, pas de trait latéral.
// Erreur : role="alert" (annoncée aussitôt) ; autres : role="status" (annoncée sans interrompre).
// Message à focaliser (erreur d'un formulaire) : passer « ref », il reçoit alors tabIndex={-1}.
// forwardRef plutôt que « ref » en simple propriété (React 19) : l'application de gestion tourne
// sur Preact 10, qui ne transmet « ref » qu'à travers forwardRef (US-017).
export const Alert = forwardRef<HTMLDivElement, AlertProps>(function Alert(
  { tone = 'info', title, children, id },
  ref,
) {
  return (
    <div
      ref={ref}
      id={id}
      tabIndex={ref ? -1 : undefined}
      className={`ui-alert ui-alert--${tone}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <Icon name={tone} className="ui-alert__icon" />
      <div className="ui-alert__body">
        {title && <p className="ui-alert__title">{title}</p>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
});
