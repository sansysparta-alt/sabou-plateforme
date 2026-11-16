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

# Arrêt d'un processus et de tous ses descendants. Sous Git Bash (Windows), les programmes
# natifs (node, flutter, docker) ne reçoivent pas les signaux de bash : taskkill /T les arrête.
# Le parent est arrêté avant ses enfants : arrêté après, un sous-shell (le minuteur d'une
# étape) reprendrait la suite de son script dès la fin de son « sleep ».
kill_tree() {
  local pid=$1 child children
  children=$(child_pids "$pid")
  if [[ -r /proc/$pid/winpid ]]; then
    taskkill //T //F //PID "$(<"/proc/$pid/winpid")" >/dev/null 2>&1 || true
  fi
  kill "$pid" 2>/dev/null || true
  for child in $children; do kill_tree "$child"; done
}
# Enfants directs d'un processus (ps de Git Bash : PID en 2e colonne, parent en 3e). Le
# système décide de la commande, pas /proc : un processus déjà terminé n'y figure plus, et le
# ps de Git Bash ne connaît pas -o.
child_pids() {
  if [[ $OSTYPE == msys* || $OSTYPE == cygwin* ]]; then
    ps -ef | awk -v p="$1" 'NR > 1 && $3 == p { print $2 }'
  else
    ps -e -o pid= -o ppid= | awk -v p="$1" '$2 == p { print $1 }'
  fi
}

# Durée maximale d'une étape, en minutes : une étape figée (mémoire du poste saturée) est
# arrêtée au lieu de bloquer le pipeline pendant des heures (décision du 16 novembre 2026).
# STEP_TIMEOUT_SEC (secondes) sert à la contre-épreuve.
STEP_TIMEOUT_MIN=${STEP_TIMEOUT_MIN:-60}

# Étape horodatée : début, fin et durée dans le journal du pipeline, pour repérer la plus lente.
# Au-delà de STEP_TIMEOUT_MIN, l'étape est arrêtée avec tous ses processus et échoue.
#   step "Nom lisible" commande arguments…
step() {
  local name=$1 start=$SECONDS pid watcher status=0 expired
  shift
  # Témoin de dépassement : un programme arrêté par taskkill peut rendre le code 0
  expired=$(mktemp)
  rm -f "$expired"
  echo "▶ [$(date +%H:%M:%S)] $name"
  "$@" &
  pid=$!
  (
    sleep "${STEP_TIMEOUT_SEC:-$((STEP_TIMEOUT_MIN * 60))}"
    echo "✘ $name : durée maximale dépassée ($STEP_TIMEOUT_MIN min), étape arrêtée" >&2
    : >"$expired"
    kill_tree "$pid"
  ) &
  watcher=$!
  wait "$pid" || status=$?
  kill_tree "$watcher"
  [[ -e "$expired" ]] && status=124
  rm -f "$expired"
  if ((status != 0)); then
    echo "✘ [$(date +%H:%M:%S)] $name : ÉCHEC après $((SECONDS - start)) s" >&2
    return 1
  fi
  echo "✔ [$(date +%H:%M:%S)] $name ($((SECONDS - start)) s)"
}

# Étapes indépendantes lancées ensemble, chacune avec son journal ; les journaux sont recopiés
# dans l'ordre à la fin (preuve lisible). Dès qu'une étape échoue, les autres sont arrêtées.
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
  for _ in "${pids[@]}"; do
    if ! wait -n "${pids[@]}"; then
      failed=1
      for i in "${pids[@]}"; do kill_tree "$i"; done
      break
    fi
  done
  wait 2>/dev/null || true
  for i in "${!names[@]}"; do
    echo "──── ${names[$i]} ────"
    cat "$dir/$((i + 1)).log"
  done
  rm -rf "$dir"
  return "$failed"
}

# Pipeline complet : arrêt propre. À la sortie (réussite, échec ou Ctrl+C), les processus
# encore en cours et les conteneurs lancés par le pipeline sont arrêtés ; ceux qui existaient
# avant (environnement local, Docker Compose) ne sont pas touchés.
pipeline_cleanup() {
  local status=$? job id
  trap - EXIT INT TERM
  for job in $(jobs -p); do kill_tree "$job"; done
  for id in $(docker ps -q 2>/dev/null || true); do
    [[ "$PIPELINE_CONTAINERS" == *" $id "* ]] && continue
    [[ -n "$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project"}}' "$id" 2>/dev/null)" ]] && continue
    docker rm -f "$id" >/dev/null 2>&1 || true
  done
  ((status == 0)) || echo "Pipeline arrêté : voir l'étape marquée ✘ ci-dessus" >&2
  exit "$status"
}
pipeline_guard() {
  PIPELINE_CONTAINERS=" $(docker ps -q 2>/dev/null | tr '\n' ' ') "
  trap pipeline_cleanup EXIT
  trap 'exit 130' INT TERM
}

# Pas de pipeline complet pendant un essai dans le navigateur : l'application de gestion (5173)
# ou le site (3000) lancés en développement signalent un essai en cours, et la mémoire du
# poste ne suffit pas aux deux (décision du maître d'œuvre du 16 novembre 2026).
#   browser_session_guard [port…]
browser_session_guard() {
  local port host ports=("$@")
  ((${#ports[@]})) || ports=(5173 3000)
  for port in "${ports[@]}"; do
    for host in 127.0.0.1 ::1; do
      if (exec 3<>"/dev/tcp/$host/$port") 2>/dev/null; then
        echo "ÉCHEC : une application tourne sur le port $port (essai dans le navigateur en cours)." >&2
        echo "Arrêter l'essai et son serveur, puis relancer le pipeline." >&2
        return 1
      fi
    done
  done
}
