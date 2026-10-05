# Development image only: production serves the build baked into the Caddy image.
FROM node:22-alpine AS dev
WORKDIR /app
RUN chown node:node /app
# Non-root, and dependencies live in the image, not in a bind mount.
USER node
COPY --chown=node:node package.json package-lock.json ./
RUN --mount=type=cache,target=/home/node/.npm,uid=1000,gid=1000 npm ci
COPY --chown=node:node . .
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]
