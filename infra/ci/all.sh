#!/usr/bin/env bash
# Pipeline avant fusion, en local, dans l'ordre de l'intégration continue : tout ce qui prouve
# que la plateforme fonctionne (pnpm ci:recit ne sert qu'en cours de développement).
# Décision du maître d'œuvre du 19 novembre 2026 (05 §2.73) : la vitesse (Lighthouse) et la
# sécurité (Trivy, Semgrep, images) ne bloquent plus chaque fusion ; elles passent en fin de
# sprint et avant toute mise en production : pnpm ci:fin-sprint (infra/ci/fin-sprint.sh).
source "$(dirname "$0")/env.sh"
# Aucun réglage de ci:recit ne doit alléger la preuve : specs au complet
unset RECIT_ADMIN_SPECS RECIT_SITE_SPECS LH_PAGES LH_RUNS LH_FORM_FACTORS
export RECIT_LIGHTHOUSE=0
# Pas pendant un essai dans le navigateur ; arrêt propre à la première étape en échec
browser_session_guard
pipeline_guard
started=$SECONDS
step "Arrêt propre (contre-épreuve)" bash infra/ci/pipeline-selftest.sh
step "Contrôles du dépôt" bash infra/ci/check-repo.sh
step "Contrôles du dépôt (contre-épreuve)" bash infra/ci/check-repo-selftest.sh
step "Installation" bash infra/ci/install.sh
step "Lint et format" bash infra/ci/lint.sh
step "Tests" bash infra/ci/test.sh
step "Compilation" bash infra/ci/build.sh
step "Bout en bout du site" bash infra/ci/e2e.sh
step "Bout en bout de l'application de gestion" bash infra/ci/e2e-admin.sh
step "Lecture audio" bash infra/ci/audio-lecture.sh
# Étapes sans l'environnement local, lancées ensemble (l'application mobile, la plus
# gourmande, tourne seule dans son groupe).
# Application mobile : Flutter 3.47.7 (FLUTTER_BIN si le Flutter par défaut est une autre version)
step "Contrôles indépendants (en parallèle)" parallel_steps \
  "Application mobile" "bash infra/ci/mobile.sh" \
  "Variables d'environnement" "bash infra/ci/env-check.sh && bash infra/ci/env-check-selftest.sh"
echo "Pipeline avant fusion vert en $(((SECONDS - started) / 60)) min $(((SECONDS - started) % 60)) s"
