# Image de l'API, construite depuis la racine du dépôt (contexte « . ») :
#   docker build -f apps/api/Dockerfile .
# Images de base épinglées par empreinte (Node 26.13.0, Debian trixie slim).

# FFmpeg 9.0.2 statique (un seul binaire, aucune bibliothèque du système) pour le traitement
# des voix (US-070, 05 §2.43) ; même image et même empreinte que les tests de l'API
FROM mwader/static-ffmpeg@sha256:7d9bdaaf887f7e6ce6151f67325c344074b5ff1fb75316011c3376503e449a7b AS ffmpeg

FROM node:26.13.0-trixie-slim@sha256:e4db4c914bf8ad241bd24804fc25d272d89bad97e68cdc8a1414862790a02c39 AS build
# Même version de pnpm que le champ packageManager du package.json racine
RUN npm install --global pnpm@12.16.1
WORKDIR /repo

# Manifestes d'abord : la couche des dépendances reste en cache tant qu'ils ne changent pas
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/types/package.json packages/types/
COPY packages/qr/package.json packages/qr/
RUN pnpm install --frozen-lockfile --filter "@sabou/api..."

COPY tsconfig.base.json ./
COPY packages/types packages/types
COPY packages/qr packages/qr
COPY apps/api apps/api
RUN pnpm --filter "@sabou/api..." run build \
  && pnpm --filter @sabou/api deploy --legacy --prod /out

FROM node:26.13.0-trixie-slim@sha256:e4db4c914bf8ad241bd24804fc25d272d89bad97e68cdc8a1414862790a02c39
ENV NODE_ENV=production
# FFmpeg et modèle RNNoise (choisi par la mesure d'intelligibilité, packages/audio/models)
COPY --from=ffmpeg /ffmpeg /usr/local/bin/ffmpeg
COPY packages/audio/models/cb.rnnn /app/assets/rnnoise-cb.rnnn
WORKDIR /app
# Code en lecture seule pour l'utilisateur qui fait tourner l'API (propriété de root)
COPY --from=build /out ./
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
