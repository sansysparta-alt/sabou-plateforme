#!/usr/bin/env bash
# Tout le pipeline en local, dans l'ordre de l'intégration continue. Seul passage qui vaut
# preuve avant une demande de fusion (pnpm ci:recit ne sert qu'en cours de développement).
source "$(dirname "$0")/env.sh"
# Aucun réglage de ci:recit ne doit alléger la preuve : pages, mesures et specs au complet
unset RECIT_ADMIN_SPECS RECIT_SITE_SPECS RECIT_LIGHTHOUSE LH_PAGES LH_RUNS LH_FORM_FACTORS
started=$SECONDS
step "Contrôles du dépôt" bash infra/ci/check-repo.sh
step "Contrôles du dépôt (contre-épreuve)" bash infra/ci/check-repo-selftest.sh
step "Installation" bash infra/ci/install.sh
step "Lint et format" bash infra/ci/lint.sh
step "Tests" bash infra/ci/test.sh
step "Compilation" bash infra/ci/build.sh
step "Bout en bout du site" bash infra/ci/e2e.sh
step "Bout en bout de l'application de gestion" bash infra/ci/e2e-admin.sh
step "Lecture audio" bash infra/ci/audio-lecture.sh
# Étapes sans l'environnement local, lancées ensemble (la mémoire du poste est surveillée :
# l'application mobile, la plus gourmande, tourne seule dans son groupe).
# Application mobile : Flutter 3.47.7 (FLUTTER_BIN si le Flutter par défaut est une autre version)
step "Contrôles indépendants (en parallèle)" parallel_steps \
  "Application mobile" "bash infra/ci/mobile.sh" \
  "Audit des dépendances" "bash infra/ci/audit.sh && bash infra/ci/audit-selftest.sh" \
  "Semgrep" "bash infra/ci/semgrep.sh && bash infra/ci/semgrep-selftest.sh" \
  "Variables d'environnement" "bash infra/ci/env-check.sh && bash infra/ci/env-check-selftest.sh"
step "Analyse des images" bash infra/ci/audit-images.sh
step "Analyse des images (contre-épreuve)" bash infra/ci/audit-images-selftest.sh
echo "Pipeline complet vert en $(((SECONDS - started) / 60)) min $(((SECONDS - started) % 60)) s"
