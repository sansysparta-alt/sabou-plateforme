import type { ReactNode } from 'react';

export interface CardProps {
  title?: string;
  // Niveau du titre dans la page (h2 par défaut) : la hiérarchie des titres reste juste (WCAG 1.3.1)
  headingLevel?: 2 | 3;
  actions?: ReactNode;
  children: ReactNode;
  as?: 'section' | 'div';
}

export function Card({ title, headingLevel = 2, actions, children, as = 'section' }: CardProps) {
  const Tag = as;
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <Tag className="ui-card">
      {(title || actions) && (
        <div className="ui-card__header">
          {title && <Heading className="ui-card__title">{title}</Heading>}
          {actions}
        </div>
      )}
      <div className="ui-card__body">{children}</div>
    </Tag>
  );
}

export interface StatCardProps {
  label: string;
  // null : fonction pas encore livrée, la carte annonce le sprint prévu
  value: number | string | null;
  detail?: string;
  upcoming?: string;
}

const numberFormat = new Intl.NumberFormat('fr-FR');

// Chiffre clé du tableau de bord : libellé en capitales, grand chiffre, précision
export function StatCard({ label, value, detail, upcoming }: StatCardProps) {
  const isUpcoming = value === null;
  return (
    <div className={`ui-card ui-stat${isUpcoming ? ' ui-stat--upcoming' : ''}`}>
      <p className="ui-stat__label">{label}</p>
      <p className="ui-stat__value">
        {isUpcoming
          ? (upcoming ?? 'À venir')
          : typeof value === 'number'
            ? numberFormat.format(value)
            : value}
      </p>
      {detail && <p className="ui-stat__detail">{detail}</p>}
    </div>
  );
}

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'error';

export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) {
  return <span className={`ui-badge ui-badge--${tone}`}>{children}</span>;
}
