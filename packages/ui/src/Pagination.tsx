import { useId, useState } from 'react';
import { Icon } from './Icon';

// Pagination des listes de gestion (US-019), commune à tous les écrans : taille de page au
// choix (mémorisée par liste, pour ce navigateur), « 1–10 sur 36 comptes », numéros de page
// avec points de suspension au-delà de sept pages. Sur téléphone, « Page 2 sur 4 » remplace
// les numéros. La page courante est annoncée (aria-current), chaque bouton dit sa page.

export const PAGE_SIZES = [10, 25, 50] as const;

export interface PaginationProps {
  total: number;
  page: number; // à partir de 0
  pageSize: number;
  onPage: (page: number) => void;
  onPageSize: (size: number) => void;
  // Nom des éléments : [singulier, pluriel], ex. ['compte', 'comptes']
  noun: readonly [string, string];
  // Nom accessible de la navigation, ex. « Pages des comptes »
  label: string;
}

// Numéros à afficher : toujours la première et la dernière, la courante et ses voisines ;
// null marque un saut (« … »)
export function pageNumbers(current: number, pages: number): (number | null)[] {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i);
  const wanted = new Set([0, pages - 1, current - 1, current, current + 1]);
  if (current <= 2) [1, 2, 3].forEach((n) => wanted.add(n));
  if (current >= pages - 3) [pages - 4, pages - 3, pages - 2].forEach((n) => wanted.add(n));
  const sorted = [...wanted].filter((n) => n >= 0 && n < pages).sort((a, b) => a - b);
  const result: (number | null)[] = [];
  sorted.forEach((n, i) => {
    if (i > 0 && n - sorted[i - 1]! > 1) result.push(null);
    result.push(n);
  });
  return result;
}

export function Pagination({
  total,
  page,
  pageSize,
  onPage,
  onPageSize,
  noun,
  label,
}: PaginationProps) {
  const sizeId = useId();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  // Une seule page : rien à paginer, mais le choix de la taille reste utile au-delà de 10
  if (total <= PAGE_SIZES[0]) return null;
  const first = page * pageSize + 1;
  const last = Math.min((page + 1) * pageSize, total);
  return (
    <nav className="ui-pagination" aria-label={label}>
      <div className="ui-pagination__info">
        <label htmlFor={sizeId}>Afficher</label>
        <select
          id={sizeId}
          className="ui-select ui-pagination__size"
          value={pageSize}
          onChange={(event) => onPageSize(Number(event.target.value))}
        >
          {PAGE_SIZES.map((size) => (
            <option key={size} value={size}>
              {size}
            </option>
          ))}
        </select>
        <span>par page</span>
        <span className="ui-pagination__range">
          <strong>
            {first}–{last}
          </strong>{' '}
          sur <strong>{total}</strong> {total > 1 ? noun[1] : noun[0]}
        </span>
      </div>
      {pages > 1 && (
        <div className="ui-pagination__pages">
          <button
            type="button"
            className="ui-pagination__step"
            disabled={page === 0}
            onClick={() => onPage(page - 1)}
          >
            <Icon name="chevron-left" />
            Préc.<span className="ui-visually-hidden"> : page précédente</span>
          </button>
          <ol className="ui-pagination__numbers">
            {pageNumbers(page, pages).map((n, i) =>
              n === null ? (
                <li key={`saut-${i}`} className="ui-pagination__gap" aria-hidden="true">
                  …
                </li>
              ) : (
                <li key={n}>
                  <button
                    type="button"
                    className="ui-pagination__number"
                    aria-current={n === page ? 'page' : undefined}
                    aria-label={`Page ${n + 1}`}
                    onClick={() => onPage(n)}
                  >
                    {n + 1}
                  </button>
                </li>
              ),
            )}
          </ol>
          <span className="ui-pagination__compact" aria-hidden="true">
            Page {page + 1} sur {pages}
          </span>
          <button
            type="button"
            className="ui-pagination__step"
            disabled={page >= pages - 1}
            onClick={() => onPage(page + 1)}
          >
            Suiv.<span className="ui-visually-hidden"> : page suivante</span>
            <Icon name="chevron-left" className="ui-pagination__next" />
          </button>
        </div>
      )}
    </nav>
  );
}

function readSize(key: string): number {
  try {
    const stored = Number(window.localStorage.getItem(`sabou-par-page-${key}`));
    return (PAGE_SIZES as readonly number[]).includes(stored) ? stored : PAGE_SIZES[0];
  } catch {
    return PAGE_SIZES[0];
  }
}

// Pagination côté client d'une liste déjà filtrée. `key` nomme la liste (taille de page
// mémorisée) ; `resetOn` : toute valeur dont le changement ramène à la première page
// (recherche, filtres).
export function usePagination<T>(items: T[], key: string, resetOn: unknown[] = []) {
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(() => readSize(key));
  // Filtres changés : retour à la première page, calculé pendant le rendu (pas d'effet)
  const resetKey = JSON.stringify(resetOn);
  const [lastResetKey, setLastResetKey] = useState(resetKey);
  if (lastResetKey !== resetKey) {
    setLastResetKey(resetKey);
    setPage(0);
  }
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const current = Math.min(lastResetKey !== resetKey ? 0 : page, pages - 1);

  return {
    pageItems: items.slice(current * pageSize, (current + 1) * pageSize),
    paginationProps: {
      total: items.length,
      page: current,
      pageSize,
      onPage: setPage,
      onPageSize: (size: number) => {
        setPageSize(size);
        setPage(0);
        try {
          window.localStorage.setItem(`sabou-par-page-${key}`, String(size));
        } catch {
          // Stockage indisponible : le choix vaut pour cette page seulement
        }
      },
    },
  };
}
