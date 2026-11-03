#!/usr/bin/env bash
# Analyse du code par Semgrep (édition communautaire) : un résultat de gravité haute fait
# échouer le pipeline ; les autres sont affichés sans bloquer.
# Usage : semgrep.sh [dossier]  (par défaut, la racine du dépôt)

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
trap 'rm -rf "$workdir"' EXIT
mkdir "$workdir/rules" "$workdir/out"
# Un commit désigné par son empreinte : le contenu des règles ne peut pas changer
git -C "$workdir/rules" init -q
git -C "$workdir/rules" fetch -q --depth 1 "$RULES_REPO" "$RULES_COMMIT"
git -C "$workdir/rules" -c advice.detachedHead=false checkout -q FETCH_HEAD

src="$target" rules="$workdir/rules" out="$workdir/out"
# Sous Git Bash (Windows), Docker attend des chemins Windows
if command -v cygpath >/dev/null; then
  src="$(cygpath -m "$src")" rules="$(cygpath -m "$rules")" out="$(cygpath -m "$out")"
fi
configs=()
for dir in "${RULES_DIRS[@]}"; do configs+=(--config "/rules/$dir"); done

# --metrics=off : aucune donnée envoyée à Semgrep ; le code n'est jamais transmis
MSYS_NO_PATHCONV=1 docker run --rm -v "$src:/src:ro" -v "$rules:/rules:ro" -v "$out:/out" \
  -w /src "$SEMGREP_IMAGE" semgrep scan --metrics=off --disable-version-check --quiet \
  "${configs[@]}" --exclude-rule "$I18NEXT_RULE" --text --json-output=/out/results.json

# Gravité haute : ERROR dans le classement historique de Semgrep, HIGH ou CRITICAL dans le nouveau
node -e '
const { results, errors } = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const high = results.filter((r) => ["ERROR", "HIGH", "CRITICAL"].includes(r.extra.severity));
for (const e of errors) console.error(`Erreur d’analyse : ${e.path ?? ""} ${e.type ?? ""} ${e.message ?? ""}`.slice(0, 300));
for (const r of high) console.error(`HAUTE : ${r.path}:${r.start.line} ${r.check_id}`);
console.log(`Semgrep : ${results.length} résultat(s), dont ${high.length} de gravité haute ; ${errors.length} erreur(s) d’analyse.`);
if (high.length > 0) process.exit(1);
' "$workdir/out/results.json"
