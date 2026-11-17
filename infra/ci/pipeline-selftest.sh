#!/usr/bin/env bash
# Contre-épreuve de l'arrêt propre du pipeline (env.sh) : une étape en échec échoue, une étape
# figée est arrêtée à sa durée maximale, un échec en parallèle arrête les autres étapes, et le
# pipeline refuse de démarrer pendant un essai dans le navigateur.
source "$(dirname "$0")/env.sh"
fail() {
  echo "ÉCHEC de la contre-épreuve : $1" >&2
  exit 1
}

# 1. Étape en échec
if step "étape en échec" false >/dev/null 2>&1; then fail "une étape en échec passe"; fi

# 2. Étape figée : arrêtée après 2 s au lieu de 120
started=$SECONDS
if STEP_TIMEOUT_SEC=2 step "étape figée" sleep 120 >/dev/null 2>&1; then
  fail "une étape figée passe"
fi
((SECONDS - started < 30)) || fail "une étape figée n'est pas arrêtée à sa durée maximale"

# 3. En parallèle : l'échec de l'une arrête l'autre
started=$SECONDS
if parallel_steps "longue" "sleep 120" "en échec" "sleep 1; false" >/dev/null 2>&1; then
  fail "un échec en parallèle passe"
fi
((SECONDS - started < 30)) || fail "un échec en parallèle n'arrête pas les autres étapes"
sleep 1
! ps -ef | grep -q "[s]leep 120" || fail "des processus d'une étape arrêtée restent en marche"

# 4. Essai dans le navigateur : un port occupé bloque, un port libre laisse passer
port=$(node -e 'const s=require("net").createServer().listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')
browser_session_guard "$port" 2>/dev/null || fail "un port libre bloque le pipeline"
node -e 'require("net").createServer().listen(+process.argv[1],"127.0.0.1");setTimeout(()=>process.exit(),20000)' "$port" &
server=$!
for _ in $(seq 1 50); do (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null && break; sleep 0.1; done
if browser_session_guard "$port" 2>/dev/null; then
  kill_tree "$server"
  fail "le pipeline démarre pendant un essai dans le navigateur"
fi
kill_tree "$server"

echo "Arrêt propre : étape en échec, étape figée, échec en parallèle et essai en cours détectés."
