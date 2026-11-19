// Dépôt d'un fichier en un geste (05 §2.74) : vrai champ fichier, nommé par son libellé,
// focalisable ; le fichier choisi part aussitôt ; désactivé, rien ne part.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { FileButton } from './FileButton';

afterEach(cleanup);

const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });

describe('FileButton', () => {
  it('champ fichier nommé par le libellé du bouton, focalisable, avec son aide', () => {
    render(
      <>
        <p id="aide">JPEG, PNG ou PDF.</p>
        <FileButton accept="image/jpeg" describedBy="aide" onFile={() => undefined}>
          Déposer <span className="ui-visually-hidden">la photo</span>
        </FileButton>
      </>,
    );
    const input = screen.getByLabelText('Déposer la photo') as HTMLInputElement;
    expect(input.type).toBe('file');
    expect(input.accept).toBe('image/jpeg');
    expect(input.getAttribute('aria-describedby')).toBe('aide');
    input.focus();
    expect(document.activeElement).toBe(input);
  });

  it('le fichier choisi part aussitôt, et le champ est vidé (même fichier possible ensuite)', () => {
    const onFile = vi.fn();
    render(<FileButton onFile={onFile}>Déposer</FileButton>);
    const input = screen.getByLabelText('Déposer') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    expect(onFile).toHaveBeenCalledWith(file);
    expect(input.value).toBe('');
  });

  it('désactivé : champ inactif, libellé signalé comme indisponible', () => {
    render(
      <FileButton disabled onFile={() => undefined}>
        Déposer
      </FileButton>,
    );
    const input = screen.getByLabelText('Déposer') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(screen.getByText('Déposer').getAttribute('aria-disabled')).toBe('true');
  });
});
