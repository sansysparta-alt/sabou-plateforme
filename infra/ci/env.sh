# Réglages communs aux scripts du pipeline (à sourcer, pas à exécuter)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

# Lancé depuis PowerShell ou cmd, « bash » désigne celui de WSL : sur un dépôt Windows
# (/mnt/c, /mnt/d…), Node et pnpm de Windows y sont inutilisables.
if [[ "$PWD" == /mnt/[a-z]/* ]] && grep -qi microsoft /proc/version 2>/dev/null; then
  echo "ÉCHEC : ce script tourne dans WSL. Le lancer depuis Git Bash : pnpm ci:local" >&2
  exit 1
fi

export NEXT_TELEMETRY_DISABLED=1
export TURBO_TELEMETRY_DISABLED=1
# Pas de suggestions publicitaires de Docker dans la sortie du pipeline
export DOCKER_CLI_HINTS=false
