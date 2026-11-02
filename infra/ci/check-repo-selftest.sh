#!/usr/bin/env bash
# Contre-épreuves des garde-fous du pipeline local :
# - check-repo.sh doit refuser un script racine nommé comme une commande intégrée de pnpm ;
# - require-git-bash.mjs doit refuser un lancement Windows hors de Git Bash.
source "$(dirname "$0")/env.sh"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

# 1. Scripts racine « pipeline » (commande intégrée de pnpm 12) et « rt » (alias de
#    « runtime ») : doivent être refusés tous les deux
node -e "
const p = require('./package.json');
p.scripts.pipeline = 'bash infra/ci/all.sh';
p.scripts.rt = 'echo rt';
require('fs').writeFileSync(process.argv[1], JSON.stringify(p));" "$workdir/package.json"
if bash infra/ci/check-repo.sh "$workdir/package.json" 2>"$workdir/err"; then
  echo "ÉCHEC : les scripts racine « pipeline » et « rt » n'ont pas été refusés." >&2
  exit 1
fi
for name in pipeline rt; do
  grep -q "script « $name » porte le nom d'une commande intégrée" "$workdir/err" || {
    cat "$workdir/err" >&2
    echo "ÉCHEC : check-repo.sh n'a pas refusé le script « $name »." >&2
    exit 1
  }
done

# 2. Le manifeste réel passe (ci:local n'est pas une commande intégrée)
bash infra/ci/check-repo.sh package.json >/dev/null

# 3. Sous Windows sans MSYSTEM (PowerShell, cmd ; vide plutôt que retirée, car Git Bash
#    la remet en lançant un programme Windows) : refus ; avec MSYSTEM (Git Bash) : accepté
as_windows='data:text/javascript,Object.defineProperty(process,"platform",{value:"win32"})'
if MSYSTEM= node --import "$as_windows" infra/ci/require-git-bash.mjs 2>/dev/null; then
  echo "ÉCHEC : un lancement Windows hors de Git Bash n'a pas été refusé." >&2
  exit 1
fi
MSYSTEM=MINGW64 node --import "$as_windows" infra/ci/require-git-bash.mjs

echo "Garde-fous du pipeline local : refusent ce qu'ils doivent refuser, acceptent le reste."
