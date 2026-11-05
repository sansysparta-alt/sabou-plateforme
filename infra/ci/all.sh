#!/usr/bin/env bash
# Tout le pipeline en local, dans l'ordre de l'intégration continue
source "$(dirname "$0")/env.sh"
bash infra/ci/check-repo.sh
bash infra/ci/check-repo-selftest.sh
bash infra/ci/install.sh
bash infra/ci/lint.sh
bash infra/ci/test.sh
bash infra/ci/build.sh
bash infra/ci/e2e.sh
bash infra/ci/e2e-admin.sh
bash infra/ci/audio-lecture.sh
# Application mobile : Flutter 3.47.7 (FLUTTER_BIN si le Flutter par défaut est une autre version)
bash infra/ci/mobile.sh
bash infra/ci/audit.sh
bash infra/ci/audit-selftest.sh
bash infra/ci/semgrep.sh
bash infra/ci/semgrep-selftest.sh
bash infra/ci/env-check.sh
bash infra/ci/env-check-selftest.sh
bash infra/ci/audit-images.sh
bash infra/ci/audit-images-selftest.sh
