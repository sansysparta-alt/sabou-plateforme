import { Pagination, usePagination } from './Pagination';
import type { ReactNode } from 'react';

export interface Column<Row> {
  key: string;
  header: string;
  render: (row: Row) => ReactNode;
  numeric?: boolean;
  // Colonne d'actions : alignée à droite, comme sur la page Comptes (gabarit de liste)
  actions?: boolean;
}

const cellClass = <Row,>(column: Column<Row>) =>
  column.actions ? 'ui-table__actions' : column.numeric ? 'ui-table__num' : undefined;

export interface DataTableProps<Row> {
  // Légende obligatoire : nomme le tableau pour les lecteurs d'écran (visible ou non)
  caption: string;
  captionHidden?: boolean;
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string | number;
  empty?: string;
  // Pagination au-delà de 10 lignes (US-019) : nom de la liste (taille de page mémorisée) et
  // nom des éléments, ex. { key: 'entonnoir-bloques', noun: ['dossier', 'dossiers'] } ;
  // resetOn : recherche et filtres, dont tout changement ramène à la première page
  paginate?: { key: string; noun: readonly [string, string]; resetOn?: unknown[] };
}

// Tableau de données : en-têtes de colonne réels (<th scope="col">), défilement horizontal
// dans son cadre sur téléphone, jamais celui de la page.
export function DataTable<Row>({
  caption,
  captionHidden = false,
  columns,
  rows,
  rowKey,
  empty = 'Aucun élément.',
  paginate,
}: DataTableProps<Row>) {
  // Sans pagination demandée, la clé ne sert à rien et toutes les lignes sont montrées
  const { pageItems, paginationProps } = usePagination(
    rows,
    paginate?.key ?? 'tableau',
    paginate?.resetOn,
  );
  const shown = paginate ? pageItems : rows;
  return (
    <div className="ui-table-block">
      <div className="ui-table-wrap">
        <table className="ui-table">
          <caption className={captionHidden ? 'ui-visually-hidden' : undefined}>{caption}</caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key} scope="col" className={cellClass(column)}>
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="ui-muted">
                  {empty}
                </td>
              </tr>
            ) : (
              shown.map((row) => (
                <tr key={rowKey(row)}>
                  {columns.map((column) => (
                    <td key={column.key} className={cellClass(column)}>
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {paginate && (
        <Pagination {...paginationProps} noun={paginate.noun} label={`Pages : ${caption}`} />
      )}
    </div>
  );
}
