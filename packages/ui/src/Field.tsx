import { forwardRef, useId, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import { Icon } from './Icon';

interface FieldFrameProps {
  label: string;
  hint?: string;
  error?: string;
}

// Relie libellé, aide et erreur au champ (aria-describedby, aria-invalid) : WCAG 1.3.1, 3.3.1
function useFieldIds(id: string | undefined, hint?: string, error?: string) {
  const generated = useId();
  const fieldId = id ?? generated;
  const hintId = hint ? `${fieldId}-aide` : undefined;
  const errorId = error ? `${fieldId}-erreur` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return { fieldId, hintId, errorId, describedBy };
}

function Frame({
  fieldId,
  label,
  hint,
  hintId,
  error,
  errorId,
  children,
}: FieldFrameProps & { fieldId: string; hintId?: string; errorId?: string; children: ReactNode }) {
  return (
    <div className="ui-field">
      <label className="ui-field__label" htmlFor={fieldId}>
        {label}
      </label>
      {children}
      {hint && (
        <p className="ui-field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {error && (
        <p className="ui-field__error" id={errorId}>
          <Icon name="error" size={16} />
          {error}
        </p>
      )}
    </div>
  );
}

export const TextField = forwardRef<
  HTMLInputElement,
  FieldFrameProps & ComponentPropsWithoutRef<'input'>
>(function TextField({ label, hint, error, id, className, ...rest }, ref) {
  const ids = useFieldIds(id, hint, error);
  return (
    <Frame {...ids} label={label} hint={hint} error={error}>
      <input
        ref={ref}
        id={ids.fieldId}
        className={['ui-input', className].filter(Boolean).join(' ')}
        aria-describedby={ids.describedBy}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
    </Frame>
  );
});

export const SelectField = forwardRef<
  HTMLSelectElement,
  FieldFrameProps & ComponentPropsWithoutRef<'select'>
>(function SelectField({ label, hint, error, id, className, children, ...rest }, ref) {
  const ids = useFieldIds(id, hint, error);
  return (
    <Frame {...ids} label={label} hint={hint} error={error}>
      <select
        ref={ref}
        id={ids.fieldId}
        className={['ui-select', className].filter(Boolean).join(' ')}
        aria-describedby={ids.describedBy}
        aria-invalid={error ? true : undefined}
        {...rest}
      >
        {children}
      </select>
    </Frame>
  );
});

// Texte libre sur plusieurs lignes (motif d'un rejet, US-042) ; même cadre que les autres champs
export const TextAreaField = forwardRef<
  HTMLTextAreaElement,
  FieldFrameProps & ComponentPropsWithoutRef<'textarea'>
>(function TextAreaField({ label, hint, error, id, className, ...rest }, ref) {
  const ids = useFieldIds(id, hint, error);
  return (
    <Frame {...ids} label={label} hint={hint} error={error}>
      <textarea
        ref={ref}
        id={ids.fieldId}
        className={['ui-input', 'ui-textarea', className].filter(Boolean).join(' ')}
        aria-describedby={ids.describedBy}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
    </Frame>
  );
});
