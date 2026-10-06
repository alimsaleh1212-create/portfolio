FROM node:22-alpine AS frontend
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY frontend/ ./
RUN npm run build

FROM caddy:2-alpine
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY infra/caddy/media.caddy /etc/caddy/media.caddy
COPY infra/caddy/compress.caddy /etc/caddy/compress.caddy
COPY --from=frontend /app/dist /srv
