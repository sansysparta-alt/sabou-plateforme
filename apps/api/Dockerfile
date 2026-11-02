# Image de l'API, construite depuis la racine du dépôt (contexte « . ») :
#   docker build -f apps/api/Dockerfile .
# Images de base épinglées par empreinte (Node 26.13.0, Debian trixie slim).

FROM node:26.13.0-trixie-slim@sha256:e4db4c914bf8ad241bd24804fc25d272d89bad97e68cdc8a1414862790a02c39 AS build
# Même version de pnpm que le champ packageManager du package.json racine
RUN npm install --global pnpm@12.16.1
WORKDIR /repo

# Manifestes d'abord : la couche des dépendances reste en cache tant qu'ils ne changent pas
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/types/package.json packages/types/
RUN pnpm install --frozen-lockfile --filter "@sabou/api..."

COPY tsconfig.base.json ./
COPY packages/types packages/types
COPY apps/api apps/api
RUN pnpm --filter "@sabou/api..." run build \
  && pnpm --filter @sabou/api deploy --legacy --prod /out

FROM node:26.13.0-trixie-slim@sha256:e4db4c914bf8ad241bd24804fc25d272d89bad97e68cdc8a1414862790a02c39
ENV NODE_ENV=production
WORKDIR /app
# Code en lecture seule pour l'utilisateur qui fait tourner l'API (propriété de root)
COPY --from=build /out ./
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
