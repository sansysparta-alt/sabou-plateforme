#!/usr/bin/env bash
# Analyse du code par Semgrep (édition communautaire) : un résultat de gravité haute fait
# échouer le pipeline ; les autres sont affichés sans bloquer.
# Usage : semgrep.sh [dossier]  (par défaut, la racine du dépôt)
# SEMGREP_FILES (pnpm ci:recit) : fichiers à analyser, relatifs au dossier et séparés par des
# retours à la ligne ; vide : tous les fichiers du dossier (pipeline complet).

# Dossier résolu avant env.sh, qui se place à la racine du dépôt
target="$(cd "${1:-$(dirname "$0")/../..}" && pwd)"
source "$(dirname "$0")/env.sh"

# Image épinglée par empreinte (version 1.181.0)
SEMGREP_IMAGE="semgrep/semgrep@sha256:81474464c1f07483ba0682a44787fd93c91397419762a04abe2bafaae396304b"
# Règles du dépôt semgrep/semgrep-rules, épinglées par commit (15 octobre 2026). Leur licence
# (Semgrep Rules License v1.0) permet l'usage interne mais pas la redistribution : elles sont
# téléchargées à chaque analyse, jamais copiées dans le dépôt.
RULES_REPO="https://github.com/semgrep/semgrep-rules.git"
RULES_COMMIT="17e31e11ebac99fb7dfe1cd288f7a32151b6f3f9"
# Langages présents dans le dépôt (Dart n'a pas de règles de sécurité dans ce jeu)
RULES_DIRS=(bash dockerfile generic html javascript typescript yaml)
# Le projet n'utilise pas i18next : cette règle signalerait chaque texte affiché
I18NEXT_RULE="rules.typescript.react.portability.i18next.jsx-not-internationalized"

workdir="$(mktemp -d)"
container=""
cleanup() {
  if [[ -n "$container" ]]; then docker rm -f "$container" >/dev/null 2>&1 || true; fi
  rm -rf "$workdir"
}
trap cleanup EXIT
mkdir "$workdir/rules"
# Un commit désigné par son empreinte : le contenu des règles ne peut pas changer
git -C "$workdir/rules" init -q
git -C "$workdir/rules" fetch -q --depth 1 "$RULES_REPO" "$RULES_COMMIT"
git -C "$workdir/rules" -c advice.detachedHead=false checkout -q FETCH_HEAD

# Fichiers analysés : SEMGREP_FILES (pnpm ci:recit), sinon tout le dossier
targets=()
while read -r file; do
  [[ -n "$file" && -f "$target/$file" ]] && targets+=("$file")
done <<<"${SEMGREP_FILES:-}"
if [[ -n "${SEMGREP_FILES:-}" ]] && ((${#targets[@]} == 0)); then
  echo "Semgrep : aucun fichier à analyser"
  exit 0
fi

out="$workdir"
# Sous Git Bash (Windows), Docker attend des chemins Windows
if command -v cygpath >/dev/null; then out="$(cygpath -m "$out")"; fi
configs=()
for dir in "${RULES_DIRS[@]}"; do configs+=(--config "/rules/$dir"); done

# Le code et les règles (des milliers de petits fichiers) sont copiés dans le conteneur par
# un flux tar : sous Windows, les lire à travers le dossier partagé prenait 9 minutes, contre
# moins d'une ainsi. Seuls les fichiers que Git suit ou n'ignore pas sont copiés : dans un
# dossier de travail secondaire (git worktree), le .git pointe hors du conteneur et Semgrep
# ne pourrait pas lire le .gitignore (il analysait alors les rapports Lighthouse et
# node_modules). --metrics=off : aucune donnée envoyée à Semgrep ; le code n'est jamais transmis.
container=$(MSYS_NO_PATHCONV=1 docker create -v "$out:/out" -w /src \
  "$SEMGREP_IMAGE" semgrep scan --metrics=off --disable-version-check --quiet \
  "${configs[@]}" --exclude-rule "$I18NEXT_RULE" --text --json-output=/out/results.json \
  "${targets[@]}")
# Archives préfixées et déposées à la racine : docker cp n'accepte qu'une destination existante
tar -C "$workdir/rules" --transform 's,^,rules/,' -cf - "${RULES_DIRS[@]}" |
  MSYS_NO_PATHCONV=1 docker cp - "$container:/" >/dev/null
# Fichiers du dépôt (suivis, ou nouveaux et non ignorés) ; hors dépôt Git (contre-épreuve),
# tout le dossier. Un fichier suivi mais supprimé est sauté.
if git -C "$target" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git -C "$target" ls-files -z --cached --others --exclude-standard
else
  (cd "$target" && find . -type f -print0)
fi | tar -C "$target" --null --ignore-failed-read -T - --transform 's,^\(\./\)\?,src/,' -cf - 2>/dev/null |
  MSYS_NO_PATHCONV=1 docker cp - "$container:/" >/dev/null
status=0
docker start -a "$container" || status=$?
# Code de sortie de Semgrep : 0 sans résultat, 1 avec résultats (triés ci-dessous), > 1 erreur
if ((status > 1)); then
  echo "ÉCHEC : Semgrep s'est arrêté sur une erreur (code $status)" >&2
  exit "$status"
fi

# Gravité haute : ERROR dans le classement historique de Semgrep, HIGH ou CRITICAL dans le nouveau
node -e '
const { results, errors } = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const high = results.filter((r) => ["ERROR", "HIGH", "CRITICAL"].includes(r.extra.severity));
for (const e of errors) console.error(`Erreur d’analyse : ${e.path ?? ""} ${[].concat(e.type ?? [])[0]} ${e.message ?? ""}`.slice(0, 300));
for (const r of high) console.error(`HAUTE : ${r.path}:${r.start.line} ${r.check_id}`);
console.log(`Semgrep : ${results.length} résultat(s), dont ${high.length} de gravité haute ; ${errors.length} erreur(s) d’analyse.`);
if (high.length > 0) process.exit(1);
' "$workdir/results.json"
