#!/usr/bin/env bash
# Analyse des images Docker par Trivy (US-002) : image de l'API et images tierces de
# l'environnement local. Le pipeline échoue sur toute faille CRITIQUE qui a un correctif
# disponible ; les failles critiques sans correctif sont listées sans bloquer (décision du
# maître d'œuvre, novembre 2026 : on ne peut pas corriger soi-même une image tierce).
# Usage : audit-images.sh [image…], par défaut toutes les images de infra/local/compose.yaml
# et les images d'Atlas (migrations) et de FFmpeg (chaîne audio). Elles doivent être présentes
# sur le poste : pnpm env:up télécharge et construit celles de l'environnement, les tests de
# @sabou/db celle d'Atlas, ceux de @sabou/audio celle de FFmpeg.
source "$(dirname "$0")/env.sh"
source infra/ci/trivy.sh

if (($# > 0)); then
  images=("$@")
else
  mapfile -t images < <(
    awk '/^    image:/ { print $2 }' infra/local/compose.yaml
    grep -Eo "arigaio/atlas@sha256:[0-9a-f]{64}" packages/db/src/atlas.ts
    grep -Eo "jrottenberg/ffmpeg@sha256:[0-9a-f]{64}" packages/audio/src/ffmpeg.ts
  )
fi

report="$(mktemp)"
trap 'rm -f "$report"' EXIT

failed=()
for image in "${images[@]}"; do
  echo "=== $image"
  trivy_image "$image" --scanners vuln --severity CRITICAL --timeout 20m --quiet --format json >"$report"
  # Une ligne par faille critique ; code de sortie 1 si l'une d'elles a un correctif
  node -e '
    const report = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
    let fixable = 0;
    for (const result of report.Results ?? []) {
      for (const v of result.Vulnerabilities ?? []) {
        const fix = v.FixedVersion ? `corrigée en ${v.FixedVersion}` : "sans correctif";
        if (v.FixedVersion) fixable++;
        console.log(`  ${v.VulnerabilityID} ${v.PkgName} ${v.InstalledVersion} (${fix}) ${result.Target}`);
      }
    }
    process.exit(fixable > 0 ? 1 : 0);' "$report" || failed+=("$image")
done

if ((${#failed[@]} > 0)); then
  echo "ÉCHEC : faille critique avec correctif disponible dans : ${failed[*]}" >&2
  exit 1
fi
echo "Images analysées, aucune faille critique corrigeable : ${#images[@]} image(s)."
