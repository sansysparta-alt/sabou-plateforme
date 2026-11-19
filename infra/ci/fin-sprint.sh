#!/usr/bin/env bash
# Pipeline de fin de sprint, en local : vitesse et sécurité. Décision du maître d'œuvre du
# 19 novembre 2026 (05 §2.73) : ces contrôles ne bloquent plus chaque fusion ; ils passent une
# fois en fin de sprint et avant toute mise en production. Le fonctionnement est prouvé avant
# chaque fusion par infra/ci/all.sh (pnpm ci:local).
source "$(dirname "$0")/env.sh"
unset RECIT_ADMIN_SPECS RECIT_SITE_SPECS RECIT_LIGHTHOUSE LH_PAGES LH_RUNS LH_FORM_FACTORS
started=$SECONDS
step "Installation" bash infra/ci/install.sh
step "Compilation" bash infra/ci/build.sh
# Mesures Lighthouse seules : les parcours de bout en bout sont déjà prouvés avant fusion.
# Le site public n'est mesuré qu'après ses parcours du compte citoyen (même script).
step "Vitesse (Lighthouse : gestion, site, connexion)" env RECIT_ADMIN_SPECS=- bash infra/ci/e2e-admin.sh
step "Sécurité (en parallèle)" parallel_steps \
  "Audit des dépendances" "bash infra/ci/audit.sh && bash infra/ci/audit-selftest.sh" \
  "Semgrep" "bash infra/ci/semgrep.sh && bash infra/ci/semgrep-selftest.sh"
step "Analyse des images" bash infra/ci/audit-images.sh
step "Analyse des images (contre-épreuve)" bash infra/ci/audit-images-selftest.sh
echo "Pipeline de fin de sprint vert en $(((SECONDS - started) / 60)) min $(((SECONDS - started) % 60)) s"
