#!/usr/bin/env bash
# Pipeline rapide pendant le développement d'un récit (pnpm ci:recit). Ne vaut JAMAIS preuve :
# avant chaque demande de fusion, le pipeline complet (pnpm ci:local) est lancé et joint.
# Il ne vérifie que ce que le récit touche depuis sa base (origin/main, ou RECIT_BASE) :
#   - lint, typage et tests unitaires des paquets modifiés et de ceux qui en dépendent ;
#   - tests de la base au complet (rapides, sur un vrai PostgreSQL) ;
#   - de bout en bout : seuls les specs modifiés par le récit (ou RECIT_SPECS) ;
#   - Lighthouse : une mesure, téléphone seul, sur les pages de RECIT_PAGES (expression
#     régulière sur l'adresse, ex. RECIT_PAGES='visites|certificat') ;
#   - Semgrep sur les fichiers touchés ; application mobile si elle a changé ; audit des dépendances et des
#     images seulement si le verrou des dépendances, un Dockerfile ou Compose a changé.
source "$(dirname "$0")/env.sh"
started=$SECONDS

base=$(git merge-base "${RECIT_BASE:-origin/main}" HEAD)
# Fichiers modifiés depuis la base : commités, en cours ou nouveaux
changed=$({
  git diff --name-only "$base"
  git ls-files --others --exclude-standard
} | sort -u)
echo "Base : $(git log -1 --format='%h %s' "$base")"
echo "Fichiers modifiés : $(grep -c . <<<"$changed" || true)"
touched() { grep -E "$1" <<<"$changed" || true; }

step "Contrôles du dépôt" bash infra/ci/check-repo.sh
step "Installation" bash infra/ci/install.sh

# Paquets modifiés et leurs dépendants (« ...[base] »), plus la base de données au complet
filters=(--filter="...[$base]" --filter=@sabou/db)
step "Lint des paquets touchés" pnpm exec turbo run lint "--filter=...[$base]"
mapfile -t existing < <(while read -r f; do [[ -n "$f" && -f "$f" ]] && echo "$f"; done <<<"$changed")
if ((${#existing[@]} > 0)); then
  step "Format des fichiers touchés" pnpm exec prettier --check --ignore-unknown "${existing[@]}"
fi
step "Tests des paquets touchés et de la base" pnpm exec turbo run test "${filters[@]}"
step "Compilation des paquets touchés" pnpm exec turbo run build "--filter=...[$base]"

# Specs de bout en bout : ceux du récit, plus RECIT_SPECS (chemins depuis la racine)
specs="$(touched '^apps/(admin/e2e|site/e2e-compte|site/e2e)/.*\.spec\.ts$')
$(tr ' ' '\n' <<<"${RECIT_SPECS:-}")"
admin_specs=$(grep '^apps/admin/e2e/' <<<"$specs" | sed 's#^apps/admin/##' | xargs || true)
compte_specs=$(grep '^apps/site/e2e-compte/' <<<"$specs" | sed 's#^apps/site/##' | xargs || true)
site_specs=$(grep '^apps/site/e2e/' <<<"$specs" | sed 's#^apps/site/##' | xargs || true)

if [[ -n "$site_specs" ]]; then
  step "Bout en bout du site ($site_specs)" bash -c \
    "pnpm --filter '@sabou/site...' run build && pnpm --filter @sabou/site exec playwright install chromium && pnpm --filter @sabou/site run e2e $site_specs"
fi
if [[ -n "$admin_specs$compte_specs" || -n "${RECIT_PAGES:-}" ]]; then
  RECIT_ADMIN_SPECS=${admin_specs:--} RECIT_SITE_SPECS=${compte_specs:--} \
    RECIT_LIGHTHOUSE=$([[ -n "${RECIT_PAGES:-}" ]] && echo 1 || echo 0) \
    LH_PAGES=${RECIT_PAGES:-} LH_RUNS=1 LH_FORM_FACTORS=mobile \
    step "Bout en bout de l'application de gestion et du compte" bash infra/ci/e2e-admin.sh
else
  echo "Aucun spec de bout en bout ni page à mesurer (RECIT_PAGES) : étape sautée"
fi

if [[ -n "$(touched '^apps/mobile/')" ]]; then
  step "Application mobile" bash infra/ci/mobile.sh
fi
SEMGREP_FILES="$changed" step "Semgrep des fichiers touchés" bash infra/ci/semgrep.sh
if [[ -n "$(touched '(^|/)(pnpm-lock\.yaml|Dockerfile[^/]*|compose\.ya?ml)$')" ]]; then
  step "Audit des dépendances" bash infra/ci/audit.sh
  step "Analyse des images" bash infra/ci/audit-images.sh
fi
echo "Pipeline du récit vert en $(((SECONDS - started) / 60)) min $(((SECONDS - started) % 60)) s (ne vaut pas preuve : pnpm ci:local avant la demande de fusion)"
