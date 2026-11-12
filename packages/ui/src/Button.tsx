import type { AnchorHTMLAttributes, ComponentPropsWithRef, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export type ButtonVariant = 'primary' | 'secondary' | 'tertiary' | 'danger';

interface CommonProps {
  variant?: ButtonVariant;
  block?: boolean;
  icon?: IconName;
  children: ReactNode;
}

function classes(variant: ButtonVariant, block: boolean, extra?: string): string {
  return ['ui-button', `ui-button--${variant}`, block && 'ui-button--block', extra]
    .filter(Boolean)
    .join(' ');
}

// Bouton d'action. Un seul bouton « primary » par zone d'écran.
export function Button({
  variant = 'primary',
  block = false,
  icon,
  children,
  className,
  type = 'button',
  ...rest
}: CommonProps & ComponentPropsWithRef<'button'>) {
  return (
    <button type={type} className={classes(variant, block, className)} {...rest}>
      {icon && <Icon name={icon} className="ui-button__icon" />}
      {children}
    </button>
  );
}

// Lien qui a l'apparence d'un bouton (navigation vers une autre page)
export function ButtonLink({
  variant = 'primary',
  block = false,
  icon,
  children,
  className,
  ...rest
}: CommonProps & AnchorHTMLAttributes<HTMLAnchorElement>) {
  return (
    <a className={classes(variant, block, className)} {...rest}>
      {icon && <Icon name={icon} className="ui-button__icon" />}
      {children}
    </a>
  );
}
