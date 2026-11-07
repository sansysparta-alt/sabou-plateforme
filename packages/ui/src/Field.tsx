import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
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

export function TextField({
  label,
  hint,
  error,
  id,
  className,
  ...rest
}: FieldFrameProps & InputHTMLAttributes<HTMLInputElement>) {
  const ids = useFieldIds(id, hint, error);
  return (
    <Frame {...ids} label={label} hint={hint} error={error}>
      <input
        id={ids.fieldId}
        className={['ui-input', className].filter(Boolean).join(' ')}
        aria-describedby={ids.describedBy}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
    </Frame>
  );
}

export function SelectField({
  label,
  hint,
  error,
  id,
  className,
  children,
  ...rest
}: FieldFrameProps & SelectHTMLAttributes<HTMLSelectElement>) {
  const ids = useFieldIds(id, hint, error);
  return (
    <Frame {...ids} label={label} hint={hint} error={error}>
      <select
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
}
