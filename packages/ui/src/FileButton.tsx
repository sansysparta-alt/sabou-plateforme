import { useId, type ReactNode } from 'react';
import type { ButtonVariant } from './Button';

export interface FileButtonProps {
  // Texte du bouton (« Déposer », « Remplacer »…). Quand plusieurs boutons se ressemblent,
  // le compléter d'un texte masqué visuellement (ui-visually-hidden) pour les lecteurs d'écran
  children: ReactNode;
  accept?: string;
  disabled?: boolean;
  variant?: ButtonVariant;
  // Aide ou erreur liée (identifiant d'un élément de la page)
  describedBy?: string;
  // Le fichier choisi part aussitôt : un seul geste, pas de bouton « Envoyer » à part
  onFile: (file: File) => void;
}

// Dépôt d'un fichier en un geste (règle commune, 05 §2.74) : un vrai champ fichier, masqué
// visuellement mais focalisable, présenté comme un bouton par son libellé. Clavier : Tab
// puis Entrée ou Espace ouvre le sélecteur ; le focus se voit sur le bouton.
export function FileButton({
  children,
  accept,
  disabled = false,
  variant = 'secondary',
  describedBy,
  onFile,
}: FileButtonProps) {
  const id = useId();
  return (
    <span className="ui-file-button">
      <input
        id={id}
        type="file"
        className="ui-file-button__input"
        accept={accept}
        disabled={disabled}
        aria-describedby={describedBy}
        onChange={(event) => {
          const file = event.target.files?.[0];
          // Vidé aussitôt : choisir de nouveau le même fichier relance le dépôt
          event.target.value = '';
          if (file) onFile(file);
        }}
      />
      <label
        htmlFor={id}
        className={`ui-button ui-button--${variant}`}
        aria-disabled={disabled || undefined}
      >
        {children}
      </label>
    </span>
  );
}
