# Imagen de la API. El contexto de build es la raiz del monorepo.
# Build fix: papelera usuarios
FROM node:20-alpine

WORKDIR /app

# Dependencias del sistema utiles para sharp y para el healthcheck.
RUN apk add --no-cache libc6-compat

# Manifiestos primero para aprovechar la cache de capas.
COPY package.json ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
COPY pwa/package.json pwa/
COPY scripts/package.json scripts/

# Solo los workspaces que necesita la API: acelera el build de la imagen.
RUN npm install --no-audit --no-fund -w backend -w @sedea/shared --include-workspace-root

# Codigo fuente necesario para el backend.
COPY packages/shared packages/shared
COPY backend backend
COPY db db

RUN npm run build -w @sedea/shared && npm run build -w backend

ENV NODE_ENV=production
ENV MEDIA_DIR=/app/media
RUN mkdir -p /app/media

EXPOSE 3000

# Migraciones + seed (solo si la base esta vacia) + arranque.
CMD ["sh", "-c", "node backend/dist/migrar.js && node backend/dist/sembrar.js --si-vacio && node backend/dist/server.js"]
