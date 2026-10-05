# Portfolio

Ali Saleh's personal portfolio. It presents his career to recruiters and hiring managers as a hiker's climb up a 3D mountain. The full spec is GitHub issue #1; the vocabulary is in `CONTEXT.md`.

This is the walking skeleton: every service runs under Docker Compose and one page shows that the API can reach Postgres, Redis and MinIO. There is no site content yet.

| Folder | Holds |
|---|---|
| `backend/` | FastAPI API (Python 3.13, uv), Alembic migrations |
| `frontend/` | Vite, React, TypeScript, Tailwind (npm) |
| `content/` | Text content (empty for now) |
| `infra/` | Caddy configuration and image |

## Quickstart

Needs Docker with Compose.

```sh
cp .env.example .env
docker compose up -d --build --wait
```

Open <http://localhost:8080> (change the port with `CADDY_PORT` in `.env`). Caddy is the only service published on the host. It serves the built frontend and proxies `/api/` to the API.

- `GET /api/v1/health/live` says the API process is up.
- `GET /api/v1/health/ready` checks Postgres, Redis and MinIO and returns 503 if any fails.

Stop with `docker compose down`; add `-v` to also delete the data volumes.

## Development mode

Hot reload for the API (uvicorn `--reload`, `backend/` mounted) and the frontend (Vite dev server behind Caddy, `frontend/` mounted):

```sh
docker compose -f compose.yaml -f compose.dev.yaml up -d --wait
```

The first start runs `npm ci` inside the frontend container, which takes a few minutes. Same URL as above.

## Tests and checks

Backend integration tests run against the real Postgres, Redis and MinIO, so they run inside the dev stack's network (nothing is published on the host). Compose starts the dependencies for you:

```sh
docker compose -f compose.yaml -f compose.dev.yaml run --rm api pytest
docker compose -f compose.yaml -f compose.dev.yaml run --rm api pytest tests/test_health.py::test_live_reports_ok
```

Backend lint and types run on the host with uv (`cd backend`):

```sh
uv run ruff check . && uv run ruff format --check . && uv run pyright
```

Frontend (`cd frontend`, run `npm ci` once):

```sh
npm test
npx vitest run src/ReadinessPage.test.tsx -t "unreachable"
npm run lint && npm run typecheck
```
