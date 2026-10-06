# Two images come from this file, both from the same frontend build so the pages the pre-render
# writes always name the scripts and styles Caddy has:
#   target prerender: the one-shot job that draws the pages (compose.yaml, service `prerender`)
#   default (caddy):  serves the build's assets and the pages from the shared `site` volume
FROM node:22-alpine AS frontend
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci
COPY frontend/ ./
# The browser build (dist) and the server entry the pre-render runs (dist-prerender).
RUN npm run build

FROM node:22-alpine AS prerender
WORKDIR /app
COPY --from=frontend /app/dist/index.html ./dist/index.html
COPY --from=frontend /app/dist-prerender ./dist-prerender
# The pages go to a volume shared with Caddy. The job runs as root because a new named volume
# is owned by root (not every Docker setup copies this folder's owner into it); it has no port
# open and writes only there. The files are world-readable.
RUN mkdir /site
ENV TEMPLATE=dist/index.html OUT_DIR=/site
CMD ["node", "dist-prerender/run.js"]

FROM caddy:2-alpine
COPY infra/caddy/Caddyfile /etc/caddy/Caddyfile
COPY infra/caddy/media.caddy /etc/caddy/media.caddy
COPY infra/caddy/compress.caddy /etc/caddy/compress.caddy
COPY --from=frontend /app/dist /srv
# index.html is the pre-render's template, not a page: every page comes from /srv/pages.
RUN rm /srv/index.html && mkdir /srv/pages
