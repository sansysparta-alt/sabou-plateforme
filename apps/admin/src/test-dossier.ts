import { fireEvent, screen, within } from '@testing-library/react';

// Ouvre le panneau d'un dossier comme l'utilisateur (clic sur sa ligne, 05 §2.76) et rend la
// ligne, qui contient le panneau ; sans effet s'il est déjà ouvert
export async function openDossier(name: RegExp): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { level: 3, name });
  const row = heading.closest('li')!;
  const panel = row.querySelector('dialog');
  if (panel && !panel.hasAttribute('open')) {
    fireEvent.click(within(heading).getByRole('button'));
  }
  return row;
}
