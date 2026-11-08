import type { ReactNode } from 'react';

export interface Column<Row> {
  key: string;
  header: string;
  render: (row: Row) => ReactNode;
  numeric?: boolean;
}

export interface DataTableProps<Row> {
  // Légende obligatoire : nomme le tableau pour les lecteurs d'écran (visible ou non)
  caption: string;
  captionHidden?: boolean;
  columns: Column<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string | number;
  empty?: string;
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
}: DataTableProps<Row>) {
  return (
    <div className="ui-table-wrap">
      <table className="ui-table">
        <caption className={captionHidden ? 'ui-visually-hidden' : undefined}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={column.numeric ? 'ui-table__num' : undefined}
              >
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
            rows.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((column) => (
                  <td key={column.key} className={column.numeric ? 'ui-table__num' : undefined}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
