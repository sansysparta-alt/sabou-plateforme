import { useEffect, useRef, useState, type ReactNode } from 'react';
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
  // Absent pendant la lecture de la session : le cadre s'affiche déjà, sans profil (US-017b)
  user?: { name: string; zone?: string };
  nav: NavGroup[];
  currentPath: string;
  // Bouton ou formulaire de déconnexion, fourni par l'application
  userActions?: ReactNode;
  children: ReactNode;
}

// Navigation réduite aux icônes (ordinateur), mémorisée pour ce navigateur seulement
const COLLAPSED_KEY = 'sabou-navigation-reduite';

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (
    (words[0]?.[0] ?? '') + (words.length > 1 ? (words.at(-1)?.[0] ?? '') : '')
  ).toUpperCase();
}

// Ossature de l'application de gestion (US-019) : colonne Vert forêt pleine hauteur, marque en
// haut, rubriques ; réductible aux icônes sur ordinateur. Le compte connecté et la déconnexion
// sont en haut à droite, là où on les cherche (décision du maître d'œuvre du 19/11, 05 §2.77) :
// barre du compte au-dessus du contenu, à toutes les tailles ; sur téléphone, sous le bandeau
// qui porte le bouton « Menu » (il ouvre la colonne).
export function AppShell({
  context,
  user,
  nav,
  currentPath,
  userActions,
  children,
}: AppShellProps) {
  const [open, setOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);

  function toggleCollapsed() {
    setCollapsed((value) => {
      try {
        window.localStorage.setItem(COLLAPSED_KEY, value ? '0' : '1');
      } catch {
        // Stockage indisponible : le choix vaut pour cette page seulement
      }
      return !value;
    });
  }

  return (
    <div className="ui-shell" data-collapsed={collapsed}>
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
        </a>
      </header>
      <div className="ui-shell__body">
        <nav
          id="navigation"
          className="ui-sidebar"
          aria-label="Navigation principale"
          data-open={open}
        >
          <a className="ui-sidebar__brand" href="/">
            <span className="ui-topbar__mark" aria-hidden="true">
              S
            </span>
            <span className="ui-sidebar__text">
              <span className="ui-sidebar__name">SABOU</span>
              <span className="ui-sidebar__tagline">{context ?? 'Médecine traditionnelle'}</span>
            </span>
          </a>
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
                        title={collapsed ? item.label : undefined}
                        aria-current={item.href === currentPath ? 'page' : undefined}
                      >
                        <Icon name={item.icon} />
                        <span className="ui-sidebar__text">{item.label}</span>
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
          <div className="ui-sidebar__footer">
            <button
              type="button"
              className="ui-sidebar__collapse"
              aria-pressed={collapsed}
              onClick={toggleCollapsed}
            >
              <Icon name="chevron-left" />
              <span className="ui-sidebar__text">Réduire le menu</span>
            </button>
          </div>
        </nav>
        <div className="ui-shell__column">
          {user && (
            <section className="ui-account" aria-label="Compte connecté">
              <span className="ui-avatar" aria-hidden="true">
                {initials(user.name)}
              </span>
              <span className="ui-account__identity">
                <span className="ui-account__name">{user.name}</span>
                {user.zone && <span className="ui-account__zone">{user.zone}</span>}
              </span>
              {userActions}
            </section>
          )}
          <main id="contenu" className="ui-main" tabIndex={-1}>
            <div className="ui-main__inner">{children}</div>
          </main>
        </div>
      </div>
    </div>
  );
}

export interface PageHeaderProps {
  title: string;
  lead?: string;
  actions?: ReactNode;
}

// Marge ajoutée à la hauteur de l'introduction (titre réduit, espacements) pour décider du
// resserrement de l'en-tête
const SHRINK_MARGIN_PX = 24;

// En-tête de page : le seul h1 de la page (Cambria), une phrase d'introduction, les actions.
// Sur ordinateur, il reste en haut de l'écran pendant le défilement : titre et action principale
// toujours à portée. Une fois accroché, il se resserre (l'introduction s'efface) et un filet le
// sépare du contenu.
export function PageHeader({ title, lead, actions }: PageHeaderProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    const element = ref.current;
    // Navigateur sans IntersectionObserver (ou tests) : en-tête simplement fixe, sans resserrement
    if (!element || typeof IntersectionObserver === 'undefined') return;
    // L'en-tête est accroché à -1 px : dès qu'il est collé, il n'est plus entièrement visible.
    // Se resserrer raccourcit la page de la hauteur de l'introduction : si la page ne défile
    // que de peu, elle ne défilerait plus, l'en-tête se décollerait, puis se recollerait…
    // (clignotement sans fin). On ne le resserre donc que s'il reste de quoi défiler ensuite.
    const observer = new IntersectionObserver(
      ([entry]) => {
        const sticks =
          entry !== undefined && entry.intersectionRatio < 1 && entry.boundingClientRect.top < 1;
        const lead = element.querySelector<HTMLElement>('.ui-page-header__lead');
        const shrink = (lead?.offsetHeight ?? 0) + SHRINK_MARGIN_PX;
        const room = document.documentElement.scrollHeight - window.innerHeight;
        setStuck((wasStuck) => sticks && (wasStuck || room > 2 * shrink));
      },
      { threshold: [1] },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} className="ui-page-header" data-stuck={stuck || undefined}>
      <div className="ui-page-header__text">
        <h1>{title}</h1>
        {lead && <p className="ui-page-header__lead">{lead}</p>}
      </div>
      {actions}
    </div>
  );
}
