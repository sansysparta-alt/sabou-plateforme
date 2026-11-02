#!/usr/bin/env bash
# Vérifie que chaque image Docker est épinglée par empreinte sha256, et non par une
# étiquette qu'un tiers pourrait déplacer : lignes « image: » des fichiers Compose et
# lignes « FROM » des Dockerfile. Les images construites par le projet (clé « build: »
# voisine) portent une étiquette locale et sont exemptées.
# Usage : check-pins.sh [fichier…], par défaut les fichiers Compose de infra/ et les Dockerfile.
source "$(dirname "$0")/env.sh"

if (($# > 0)); then
  files=("$@")
else
  mapfile -t files < <(git ls-files --cached --others --exclude-standard \
    ':(glob)infra/**/compose*.yaml' ':(glob)**/Dockerfile')
fi

errors=0
pinned='@sha256:[0-9a-f]{64}$'
for file in "${files[@]}"; do
  if [[ "$(basename "$file")" == Dockerfile ]]; then
    # FROM image[@empreinte] [AS étape] ; une étape nommée plus haut n'est pas une image
    stages=()
    while read -r image stage; do
      if [[ ! "$image" =~ $pinned ]] && [[ ! " ${stages[*]} " =~ " $image " ]]; then
        echo "ÉCHEC : $file : image non épinglée par empreinte : $image" >&2
        errors=$((errors + 1))
      fi
      [[ -n "$stage" ]] && stages+=("$stage")
    done < <(sed -nE 's/^FROM +(--platform=[^ ]+ +)?([^ ]+)( +[Aa][Ss] +([^ ]+))?.*/\2 \4/p' "$file")
  else
    # Image sans empreinte, sauf si le service est construit par le projet (build: dans le même bloc)
    while read -r image; do
      echo "ÉCHEC : $file : image non épinglée par empreinte : $image" >&2
      errors=$((errors + 1))
    done < <(awk '
      /^  [a-z][a-z0-9_-]*:$/ { if (img != "" && !built) print img; img = ""; built = 0 }
      /^    build:/ { built = 1 }
      /^    image:/ { img = $2; if (img ~ /@sha256:[0-9a-f]{64}$/) img = "" }
      END { if (img != "" && !built) print img }' "$file")
  fi
done

if ((errors > 0)); then exit 1; fi
echo "Images épinglées par empreinte : ${files[*]}"
