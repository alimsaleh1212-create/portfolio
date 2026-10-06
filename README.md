# Portfolio

Ali Saleh's personal portfolio. It presents his career to recruiters and hiring managers as a hiker's climb up a 3D mountain. The full spec is GitHub issue #1; the vocabulary is in `CONTEXT.md`.

Every service runs under Docker Compose. The text content (profile, Stages, Projects) is in `content/` and the API serves it; the frontend shows it on the Summary page at <http://localhost:8080/summary> and on a page per Project at `/projects/{slug}` with links to the previous and next Project (`/` redirects to the Summary until the Climb exists; `/status` shows readiness).

| Folder | Holds |
|---|---|
| `backend/` | FastAPI API (Python 3.13, uv), Alembic migrations |
| `frontend/` | Vite, React, TypeScript, Tailwind (npm) |
| `content/` | Text content in YAML: `profile.yaml`, `stages.yaml`, `projects.yaml`, and `media.yaml` (the media manifest) |
| `my_docs/` | The source Portrait, Video CV and CV PDF (git-ignored; only `.gitkeep` is tracked) |
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
- `GET /api/v1/media` describes the Portrait, Video CV and CV PDF that exist: each one's role, alt text, variants (address, format, size, dimensions) and, for the video, its duration. A role with no source file is absent.

Stop with `docker compose down`; add `-v` to also delete the data volumes.

## Visits and privacy

The site records each Visit (one page load) and how far up the Climb it got, and never identifies a Visitor (ADR 0002). It sets no cookies and writes nothing to local or session storage, and the API has no CORS because the frontend is same-origin.

- `POST /api/v1/visits` starts a Visit and returns `{"id": ...}`; a known bot gets `204` and no ID. `POST /api/v1/visits/{id}/events` adds a Stage reached, Project opened, CV downloaded or contact message sent event (`204`; repeating a Stage reached changes nothing). Both answer `429` past a per-client limit; bodies over 4 KiB get `413`; a Visit takes events for 24 hours.
- Unique Visitors are counted with a hash of the client address and user agent, keyed by a random salt that exists only in Redis and expires after its UTC day. The address is never stored or logged. If Redis is down, Visits are recorded without a hash.
- Progress is derived, not stored. The views `visit_progress` (each Visit's highest Stage) and `visits_per_stage` (a funnel in Climb order: the Visits whose Progress is that Stage or higher) are what Grafana reads.
- Caddy writes no access log on purpose and passes the client address to the API in `X-Forwarded-For`, replacing whatever the client sent.

## Content and the seed command

All copy lives in `content/` and comes from Ali's CV: first person, with roles, dates and metrics as the CV has them (a metric is a `value` and a `label`). Each file is validated against a schema (`backend/app/content/schema.py`).

A one-shot `seed` service loads the files into Postgres at startup, after migrations and before the API starts, so a fresh stack always has content. Run it by hand with:

```sh
docker compose run --rm seed python -m app.seed            # load, placeholders included
docker compose run --rm seed python -m app.seed --strict   # fail and list every placeholder and missing media file
```

Add `-f compose.yaml -f compose.dev.yaml` after `docker compose` when working in dev mode. The seed updates changed rows and removes rows whose content was deleted, so running it twice leaves the same state as once. A failure names the file and field. After editing a content file, run the seed again; the API reads the database, not the files.

The five Challenges are placeholders marked `PLACEHOLDER:` until Ali writes them. Strict mode exits non-zero while any marker remains, in any text field.

## Media

The Portrait, the Video CV and the CV PDF are not in git (the repo is public and the CV carries a phone number). Put the source files in a folder and the seed prepares them:

- **Where**: `MEDIA_DIR` in `.env`, default `./my_docs` (the clone ships that folder, empty, so Docker never creates it as root). It is mounted read-only into the seed. If you point `MEDIA_DIR` somewhere else, create the folder first.
- **Which files**: `content/media.yaml` maps each role to a file name and carries what the files cannot: the Portrait's alt text, the Video CV's label and poster time, the PDF's download name.
- **What it makes**: the Portrait at several widths (never upscaled) in AVIF, WebP and JPEG, with orientation applied and every piece of metadata removed; the Video CV as H.264 + AAC MP4 at 1080p and 720p, 8-bit 4:2:0, tone-mapped to SDR BT.709 when the source is HDR, with the index at the front so it streams and seeks, plus a poster frame prepared like any other image; the CV PDF as it is. This needs `ffmpeg`, which is in the seed image and the dev image but not the API's production image.
- **Unchanged means untouched**: the seed runs at every startup. For each role it hashes the source file and the processing settings (widths, qualities, encoder arguments); when both match what is recorded in `media_items` and the objects are in the bucket, it uploads and encodes nothing. A changed file replaces its objects and removes the old ones.
- **Missing files**: a role whose file is not in the folder is skipped with a warning, and the Summary leaves it out. `python -m app.seed --strict` fails and names every missing file.
- **Serving**: objects live in the MinIO bucket under content-hashed keys. Anonymous visitors may read objects and nothing else (no listing, no writes). Caddy serves them at `/media/<key>` with `Cache-Control: public, max-age=31536000, immutable`, passes range requests through, allows only GET, HEAD and OPTIONS, and strips MinIO's own headers. MinIO is not published on the host.

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
