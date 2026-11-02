#!/usr/bin/env bash
# Mesure de la lecture d'une voix traitée en 3G simulée (US-005, Playwright + Chromium).
# Docker doit tourner (FFmpeg). Version de Chromium fixée par @playwright/test (pnpm-lock.yaml).
source "$(dirname "$0")/env.sh"
if [[ -n "${CI:-}" ]]; then
  # Intégration continue (Ubuntu) : bibliothèques système de Chromium comprises
  pnpm --filter @sabou/audio exec playwright install --with-deps chromium
else
  pnpm --filter @sabou/audio exec playwright install chromium
fi
pnpm --filter @sabou/audio run lecture
