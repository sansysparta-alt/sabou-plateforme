import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

// Onglets (US-019), selon le modèle WAI-ARIA : flèches gauche et droite, Début et Fin pour
// passer d'un onglet à l'autre, un seul arrêt de tabulation sur la rangée. L'onglet choisi est
// gardé dans l'adresse (#langues) : un rechargement ou un lien partagé y ramène.

export interface Tab {
  id: string; // fragment d'adresse, ex. « langues »
  label: string;
  count?: number;
  content: ReactNode;
}

function initialTab(tabs: Tab[]): string {
  const hash = typeof window === 'undefined' ? '' : window.location.hash.slice(1);
  return tabs.some((tab) => tab.id === hash) ? hash : tabs[0]!.id;
}

export function Tabs({ label, tabs }: { label: string; tabs: Tab[] }) {
  const base = useId();
  const [selected, setSelected] = useState(() => initialTab(tabs));
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  function select(index: number, focus: boolean) {
    const tab = tabs[index]!;
    setSelected(tab.id);
    window.history.replaceState(null, '', `#${tab.id}`);
    if (focus) buttons.current[index]?.focus();
  }

  function onKeyDown(event: KeyboardEvent, index: number) {
    const last = tabs.length - 1;
    const target =
      event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : null;
    if (target === null) return;
    event.preventDefault();
    select(target, true);
  }

  return (
    <div className="ui-tabs">
      <div className="ui-tabs__list" role="tablist" aria-label={label}>
        {tabs.map((tab, index) => {
          const active = tab.id === selected;
          return (
            <button
              key={tab.id}
              ref={(element) => {
                buttons.current[index] = element;
              }}
              type="button"
              role="tab"
              id={`${base}-${tab.id}-onglet`}
              className="ui-tabs__tab"
              aria-selected={active}
              aria-controls={`${base}-${tab.id}`}
              tabIndex={active ? 0 : -1}
              onClick={() => select(index, false)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              {tab.label}
              {tab.count !== undefined && <span className="ui-tabs__count">{tab.count}</span>}
            </button>
          );
        })}
      </div>
      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`${base}-${tab.id}`}
          aria-labelledby={`${base}-${tab.id}-onglet`}
          className="ui-tabs__panel"
          hidden={tab.id !== selected}
          tabIndex={0}
        >
          {tab.id === selected && tab.content}
        </div>
      ))}
    </div>
  );
}
