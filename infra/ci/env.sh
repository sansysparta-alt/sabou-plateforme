# Réglages communs aux scripts du pipeline (à sourcer, pas à exécuter)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
export NEXT_TELEMETRY_DISABLED=1
export TURBO_TELEMETRY_DISABLED=1
