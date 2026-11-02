#!/usr/bin/env bash
# Application mobile Flutter (US-005) : format, analyse, tests et APK de débogage.
# Flutter est épinglé par version et par l'empreinte SHA-256 de l'archive officielle.
# Intégration continue : archive téléchargée et vérifiée. Poste local : le Flutter du PATH,
# ou celui de FLUTTER_BIN, doit être exactement cette version.
source "$(dirname "$0")/env.sh"

FLUTTER_VERSION=3.47.7
FLUTTER_LINUX_SHA256=af7455f540df951184c7953fbe3cf884766e7541dacf8571f9f582db03dd6230

if [[ -n "${CI:-}" ]]; then
  sdk="${RUNNER_TEMP:-/tmp}/flutter-$FLUTTER_VERSION"
  if [[ ! -x "$sdk/flutter/bin/flutter" ]]; then
    archive="$(mktemp)"
    curl -fsSL -o "$archive" \
      "https://storage.googleapis.com/flutter_infra_release/releases/stable/linux/flutter_linux_${FLUTTER_VERSION}-stable.tar.xz"
    echo "$FLUTTER_LINUX_SHA256  $archive" | sha256sum -c -
    mkdir -p "$sdk"
    tar -xJf "$archive" -C "$sdk"
    rm -f "$archive"
  fi
  # Le dépôt Git de Flutter appartient à un autre utilisateur que celui du job
  git config --global --add safe.directory "$sdk/flutter"
  flutter="$sdk/flutter/bin/flutter"
else
  flutter="${FLUTTER_BIN:-flutter}"
fi

installed="$("$flutter" --version --machine 2>/dev/null | node -e \
  'let s="";process.stdin.on("data",(d)=>(s+=d)).on("end",()=>console.log(JSON.parse(s).frameworkVersion))')"
if [[ "$installed" != "$FLUTTER_VERSION" ]]; then
  echo "ÉCHEC : Flutter $installed, attendu $FLUTTER_VERSION (FLUTTER_BIN=chemin/vers/flutter)" >&2
  exit 1
fi

"$flutter" config --no-analytics >/dev/null
"$flutter" --disable-analytics >/dev/null 2>&1 || true

cd apps/mobile
"$flutter" pub get --enforce-lockfile
"$(dirname "$flutter")/dart" format --output=none --set-exit-if-changed lib test
"$flutter" analyze --fatal-infos
"$flutter" test
"$flutter" build apk --debug
echo "APK de débogage : apps/mobile/build/app/outputs/flutter-apk/app-debug.apk"
