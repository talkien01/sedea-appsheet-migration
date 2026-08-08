# Build de la PWA y publicacion estatica con Nginx.
# El contexto de build es la raiz del monorepo.
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
COPY pwa/package.json pwa/
COPY scripts/package.json scripts/

RUN npm install --no-audit --no-fund

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
COPY pwa/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/pwa/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
