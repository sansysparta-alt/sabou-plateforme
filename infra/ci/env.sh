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

# Étape horodatée : début, fin et durée dans le journal du pipeline, pour repérer la plus lente.
#   step "Nom lisible" commande arguments…
step() {
  local name=$1 start=$SECONDS
  shift
  echo "▶ [$(date +%H:%M:%S)] $name"
  if ! "$@"; then
    echo "✘ [$(date +%H:%M:%S)] $name : ÉCHEC après $((SECONDS - start)) s" >&2
    return 1
  fi
  echo "✔ [$(date +%H:%M:%S)] $name ($((SECONDS - start)) s)"
}

# Étapes indépendantes lancées ensemble, chacune avec son journal ; les journaux sont recopiés
# dans l'ordre à la fin (preuve lisible), et l'ensemble échoue si une seule a échoué.
#   parallel_steps "Nom 1" "commande 1" "Nom 2" "commande 2" …
parallel_steps() {
  local dir names=() pids=() failed=0 i
  dir=$(mktemp -d)
  while (($# > 0)); do
    names+=("$1")
    step "$1" bash -c "$2" >"$dir/${#names[@]}.log" 2>&1 &
    pids+=($!)
    shift 2
  done
  for i in "${!pids[@]}"; do
    wait "${pids[$i]}" || failed=1
    echo "──── ${names[$i]} ────"
    cat "$dir/$((i + 1)).log"
  done
  rm -rf "$dir"
  return "$failed"
}
