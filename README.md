# Portfolio

Ali Saleh's personal portfolio. It presents his career to recruiters and hiring managers as a hiker's climb up a 3D mountain. The full spec is GitHub issue #1; the vocabulary is in `CONTEXT.md`.

Every service runs under Docker Compose. The text content (profile, Stages, Projects) is in `content/` and the API serves it; the frontend shows it on the Summary page at <http://localhost:8080/summary> (`/` redirects there until the Climb exists; `/status` shows readiness).

| Folder | Holds |
|---|---|
| `backend/` | FastAPI API (Python 3.13, uv), Alembic migrations |
| `frontend/` | Vite, React, TypeScript, Tailwind (npm) |
| `content/` | Text content in YAML: `profile.yaml`, `stages.yaml`, `projects.yaml` |
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
- `GET /api/v1/profile` returns Ali's profile.
- `GET /api/v1/stages` returns the five Stages in Climb order. Each Challenge comes without its marker, with `challenge_is_placeholder` saying whether Ali has written it yet.
- `GET /api/v1/projects` returns the six Projects in the CV's order; `GET /api/v1/projects/{slug}` returns one, or 404.

Stop with `docker compose down`; add `-v` to also delete the data volumes.

## Content and the seed command

All copy lives in `content/` and comes from Ali's CV: first person, with roles, dates and metrics as the CV has them. Each file is validated against a schema (`backend/app/content/schema.py`).

A one-shot `seed` service loads the files into Postgres at startup, after migrations and before the API starts, so a fresh stack always has content. Run it by hand with:

```sh
docker compose run --rm seed python -m app.seed            # load, placeholders included
docker compose run --rm seed python -m app.seed --strict   # fail and list every placeholder
```

Add `-f compose.yaml -f compose.dev.yaml` after `docker compose` when working in dev mode. The seed updates changed rows and removes rows whose content was deleted, so running it twice leaves the same state as once. A failure names the file and field. After editing a content file, run the seed again; the API reads the database, not the files.

The five Challenges are placeholders marked `PLACEHOLDER:` until Ali writes them. Strict mode exits non-zero while any marker remains, in any text field.

## Development mode

Hot reload for the API (uvicorn `--reload`, `backend/` mounted) and the frontend (Vite dev server behind Caddy, `frontend/` mounted):

```sh
docker compose -f compose.yaml -f compose.dev.yaml up -d --build --wait
```

Same URL as above. Dev images are named separately from the production ones, and `--build` picks up dependency changes (the first build installs npm packages and takes a few minutes).

## Tests and checks

Backend integration tests run against the real Postgres, Redis and MinIO, so they run inside the dev stack's network (nothing is published on the host). Compose starts the dependencies for you. Content tests use a separate `<POSTGRES_DB>_test` database that they create and drop, so the stack's own data is never touched:

```sh
docker compose -f compose.yaml -f compose.dev.yaml run --build --rm api pytest
docker compose -f compose.yaml -f compose.dev.yaml run --build --rm api pytest tests/test_health.py::test_live_reports_ok
```

Backend lint and types run on the host with uv (`cd backend`):

```sh
uv run ruff check . && uv run ruff format --check . && uv run pyright
```

Frontend (`cd frontend`, run `npm ci` once):

```sh
npm test
npx vitest run src/pages/ReadinessPage.test.tsx -t "unreachable"
npm run lint && npm run typecheck
```

`npm test` also checks that components use design tokens only (no literal colours, sizes or timings, no arbitrary Tailwind values) and that every text and surface colour pairing meets WCAG AA. The tokens are in `frontend/src/index.css`. Fonts (Geist) are self-hosted through `@fontsource` packages, and the site makes no request to any other origin.
