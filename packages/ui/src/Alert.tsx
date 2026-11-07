import type { ReactNode } from 'react';
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
export function Alert({ tone = 'info', title, children, id }: AlertProps) {
  return (
    <div
      id={id}
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
}
