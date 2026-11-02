#!/usr/bin/env bash
# Tout le pipeline en local, dans l'ordre de l'intégration continue
source "$(dirname "$0")/env.sh"
bash infra/ci/check-repo.sh
bash infra/ci/install.sh
bash infra/ci/lint.sh
bash infra/ci/test.sh
bash infra/ci/build.sh
bash infra/ci/audit.sh
bash infra/ci/audit-selftest.sh
