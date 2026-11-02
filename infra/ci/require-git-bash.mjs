// Sous Windows, le pipeline local doit être lancé depuis Git Bash : depuis PowerShell
// ou cmd, la commande « bash » désigne celle de WSL, qui ne voit ni Node ni pnpm.
// Git Bash transmet la variable MSYSTEM aux programmes qu'il lance.
if (process.platform === 'win32' && !process.env.MSYSTEM) {
  console.error(
    'ÉCHEC : le pipeline local se lance depuis Git Bash, pas depuis PowerShell ni cmd.\n' +
      'Ouvrir un terminal Git Bash dans le dossier du projet, puis relancer : pnpm ci:local',
  );
  process.exit(1);
}
