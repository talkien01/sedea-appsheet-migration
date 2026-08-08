# Build de la PWA y publicacion estatica con Nginx.
# El contexto de build es la raiz del monorepo.
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
COPY pwa/package.json pwa/
COPY scripts/package.json scripts/

# Solo los workspaces que necesita la PWA.
RUN npm install --no-audit --no-fund -w pwa -w @sedea/shared --include-workspace-root

COPY packages/shared packages/shared
COPY pwa pwa

ARG VITE_API_URL=/api
ARG VITE_APP_NOMBRE="SEDEA Campo"
ARG VITE_TILE_URL="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_APP_NOMBRE=$VITE_APP_NOMBRE
ENV VITE_TILE_URL=$VITE_TILE_URL

RUN npm run build -w @sedea/shared && npm run build -w pwa

FROM nginx:1.27-alpine
# Plantilla procesada por el entrypoint oficial de nginx (envsubst) al arrancar,
# asi el nombre/puerto interno del backend se puede ajustar por variable de
# entorno sin reconstruir la imagen (ej. en EasyPanel el servicio se llama
# "sedea_backend", no "backend" como en docker-compose local).
COPY pwa/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/pwa/dist /usr/share/nginx/html
ENV BACKEND_HOST=backend
ENV BACKEND_PORT=3000
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
