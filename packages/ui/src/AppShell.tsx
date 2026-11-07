import { useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  count?: number;
}

export interface NavGroup {
  heading: string;
  items: NavItem[];
}

export interface AppShellProps {
  // Contexte affiché après la marque, ex. « Direction Générale »
  context?: string;
  user: { name: string; zone?: string };
  nav: NavGroup[];
  currentPath: string;
  // Bouton ou formulaire de déconnexion, fourni par l'application
  userActions?: ReactNode;
  children: ReactNode;
}

// Ossature de l'application de gestion (maquette v1.3) : bandeau Vert forêt, navigation latérale
// groupée par rubriques, contenu centré. Sur téléphone, la navigation s'ouvre par « Menu ».
export function AppShell({
  context,
  user,
  nav,
  currentPath,
  userActions,
  children,
}: AppShellProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="ui-shell">
      <a className="ui-skip-link" href="#contenu">
        Aller au contenu
      </a>
      <header className="ui-topbar">
        <button
          type="button"
          className="ui-button ui-button--secondary ui-topbar__menu"
          aria-expanded={open}
          aria-controls="navigation"
          onClick={() => setOpen((value) => !value)}
        >
          <Icon name={open ? 'close' : 'menu'} />
          Menu
        </button>
        <a className="ui-topbar__brand" href="/">
          <span className="ui-topbar__mark" aria-hidden="true">
            S
          </span>
          SABOU
          {context && <span className="ui-topbar__context">· {context}</span>}
        </a>
        <span className="ui-topbar__spacer" />
        <div className="ui-topbar__user">
          <div className="ui-topbar__identity">
            <span className="ui-topbar__name">{user.name}</span>
            {user.zone && <span className="ui-topbar__zone">{user.zone}</span>}
          </div>
          {userActions}
        </div>
      </header>
      <div className="ui-shell__body">
        <nav
          id="navigation"
          className="ui-sidebar"
          aria-label="Navigation principale"
          data-open={open}
        >
          <div className="ui-nav">
            {nav.map((group) => (
              <div key={group.heading} className="ui-nav__group">
                <p className="ui-nav__heading">{group.heading}</p>
                <ul className="ui-nav__list">
                  {group.items.map((item) => (
                    <li key={item.href}>
                      <a
                        className="ui-nav__link"
                        href={item.href}
                        aria-current={item.href === currentPath ? 'page' : undefined}
                      >
                        <Icon name={item.icon} />
                        {item.label}
                        {item.count !== undefined && (
                          <span className="ui-nav__count">{item.count}</span>
                        )}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </nav>
        <main id="contenu" className="ui-main" tabIndex={-1}>
          <div className="ui-main__inner">{children}</div>
        </main>
      </div>
    </div>
  );
}

export interface PageHeaderProps {
  title: string;
  lead?: string;
  actions?: ReactNode;
}

// En-tête de page : le seul h1 de la page (Cambria), une phrase d'introduction, les actions
export function PageHeader({ title, lead, actions }: PageHeaderProps) {
  return (
    <div className="ui-page-header">
      <div className="ui-page-header__text">
        <h1>{title}</h1>
        {lead && <p className="ui-page-header__lead">{lead}</p>}
      </div>
      {actions}
    </div>
  );
}
