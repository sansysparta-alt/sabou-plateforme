// Graphiques des tableaux de bord (US-090) : SVG et CSS seuls, sans bibliothèque (poids nul en
// 3G, 05 §2.90). Chaque valeur est écrite en clair à côté de sa marque : rien n'est lu par la
// seule couleur, et aucune info-bulle n'est nécessaire (au toucher comme au clavier).

const numberFormat = new Intl.NumberFormat('fr-FR');
const percentFormat = new Intl.NumberFormat('fr-FR', {
  style: 'percent',
  maximumFractionDigits: 0,
});

export interface BarListRow {
  label: string;
  value: number;
}

export interface BarListProps {
  // Titre du tableau, lu par les lecteurs d'écran (le titre visible est celui de la carte)
  caption: string;
  // En-têtes des deux colonnes, pour les lecteurs d'écran
  labelHeader: string;
  valueHeader: string;
  rows: BarListRow[];
  // Message si la liste est vide
  empty: string;
}

// Barres horizontales d'une seule série : un vrai tableau (libellé, valeur), dont la barre n'est
// que l'illustration. Longueurs proportionnelles à la plus grande valeur, base commune à gauche.
export function BarList({ caption, labelHeader, valueHeader, rows, empty }: BarListProps) {
  if (rows.length === 0) return <p className="ui-muted">{empty}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <table className="ui-bars">
      <caption className="ui-visually-hidden">{caption}</caption>
      <thead className="ui-visually-hidden">
        <tr>
          <th scope="col">{labelHeader}</th>
          <th scope="col">{valueHeader}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.label}>
            <th scope="row" className="ui-bars__label">
              {row.label}
            </th>
            <td className="ui-bars__cell">
              <span className="ui-bars__track" aria-hidden="true">
                {/* Une valeur nulle garde une marque d'un pixel : la ligne n'a pas l'air vide */}
                <span
                  className="ui-bars__bar"
                  style={{ width: row.value === 0 ? '1px' : `${(row.value / max) * 100}%` }}
                />
              </span>
              <span className="ui-bars__value">{numberFormat.format(row.value)}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export type RingTone = 'success' | 'pending' | 'neutral' | 'error';

export interface RingSegment {
  label: string;
  value: number;
  tone: RingTone;
}

export interface StatusRingProps {
  // Nom de l'ensemble, lu avec le total au centre (ex. « praticiens »)
  noun: string;
  segments: RingSegment[];
}

const RADIUS = 42;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
// Écart de surface entre deux segments, en unités du dessin (environ 2 px à l'écran)
const GAP = 1.5;

// Anneau de statut : part de chaque état dans un total. Le dessin est décoratif (aria-hidden) ;
// la légende donne, pour chaque état, son nom, son nombre et sa part.
export function StatusRing({ noun, segments }: StatusRingProps) {
  const total = segments.reduce((n, s) => n + s.value, 0);
  const drawn = segments.filter((s) => s.value > 0);
  let offset = 0;
  return (
    <div className="ui-ring">
      <div className="ui-ring__figure">
        <svg className="ui-ring__chart" viewBox="0 0 100 100" aria-hidden="true">
          <circle className="ui-ring__track" cx="50" cy="50" r={RADIUS} />
          {drawn.map((s) => {
            const length = (s.value / total) * CIRCUMFERENCE;
            // Un seul segment : anneau plein, sans écart
            const visible = drawn.length > 1 ? Math.max(length - GAP, 0.5) : length;
            const circle = (
              <circle
                key={s.label}
                className={`ui-ring__segment ui-ring--${s.tone}`}
                cx="50"
                cy="50"
                r={RADIUS}
                strokeDasharray={`${visible} ${CIRCUMFERENCE - visible}`}
                strokeDashoffset={-offset}
              />
            );
            offset += length;
            return circle;
          })}
        </svg>
        {/* Total au centre en HTML (contraste mesurable, lu par les lecteurs d'écran) */}
        <p className="ui-ring__center">
          <span className="ui-ring__total">{numberFormat.format(total)}</span>
          <span className="ui-ring__noun">{noun}</span>
        </p>
      </div>
      <ul className="ui-ring__legend">
        {segments.map((s) => (
          <li key={s.label}>
            <span className={`ui-ring__swatch ui-ring--${s.tone}`} aria-hidden="true" />
            <span className="ui-ring__label">{s.label}</span>
            <span className="ui-ring__value">
              {numberFormat.format(s.value)}
              <span className="ui-muted">
                {' '}
                ({percentFormat.format(total === 0 ? 0 : s.value / total)})
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
