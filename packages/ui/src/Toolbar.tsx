import { useEffect, useId, useState, type ReactNode } from 'react';

// Barre de recherche et de filtres des listes de gestion (US-019, gabarit de liste, 05 §2.45) :
// une seule barre, au-dessus du tableau, sur le modèle de la page Comptes. Le parent ramène
// la liste à sa première page à chaque changement (usePagination, resetOn).

export function ListToolbar({ children }: { children: ReactNode }) {
  return (
    <div className="ui-toolbar" role="search">
      {children}
    </div>
  );
}

// Champ de recherche : l'étiquette est lue par les lecteurs d'écran, le texte d'exemple dit
// quoi chercher. La recherche suit la frappe : pas de bouton à valider.
export function SearchBox({
  label,
  placeholder,
  value,
  onChange,
  maxLength = 100,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
}) {
  const id = useId();
  return (
    <div className="ui-toolbar__search">
      <label htmlFor={id} className="ui-visually-hidden">
        {label}
      </label>
      <input
        id={id}
        className="ui-input"
        type="search"
        placeholder={placeholder}
        maxLength={maxLength}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

// Filtre à choix unique, avec le nombre d'éléments de chaque choix : « Tous (12) »
export function SegmentedFilter<V extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: V; label: string; count?: number }[];
  value: V;
  onChange: (value: V) => void;
}) {
  return (
    <div className="ui-segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className="ui-segmented__item"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
          {option.count !== undefined && ` (${option.count})`}
        </button>
      ))}
    </div>
  );
}

// Valeur qui ne suit la saisie qu'après une pause : une recherche envoyée à l'API part une
// fois la frappe arrêtée, pas à chaque lettre (réseau 3G)
export const SEARCH_DELAY_MS = 400;

export function useDebounced<T>(value: T, delay = SEARCH_DELAY_MS): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

// Texte comparé sans accents ni majuscules : « nere » trouve « Néré » (recherche dans une
// liste déjà reçue)
export const foldText = (text: string) =>
  text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
