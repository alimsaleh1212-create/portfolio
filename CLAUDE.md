# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Work is tracked in GitHub Issues. The milestone 1 spec is #1 and its tickets are its sub-issues; #2 and #3 outline the later milestones. Read the spec before proposing structure or tooling.

## Commands

All Compose commands run from the repo root. Copy `.env.example` to `.env` first.

- Run the stack: `docker compose up -d --build --wait`, then <http://localhost:8080> (`CADDY_PORT`). Stop with `docker compose down` (`-v` deletes data).
- Dev mode (hot reload for API and frontend): `docker compose -f compose.yaml -f compose.dev.yaml up -d --build --wait`. Dev images are separate from prod ones; `--build` picks up dependency changes.
- Backend tests (real Postgres, Redis, MinIO, so run inside Compose): `docker compose -f compose.yaml -f compose.dev.yaml run --build --rm api pytest`
- One backend test: `... run --build --rm api pytest tests/test_health.py::test_live_reports_ok`
- Seed content by hand (the stack runs it at startup, non-strict): `docker compose run --rm seed python -m app.seed`. Add `--strict` to fail while any `PLACEHOLDER:` remains or a media file is missing. In dev mode, add `-f compose.yaml -f compose.dev.yaml` before `run`.
- Frontend tests: `cd frontend && npm test`. One test: `npx vitest run src/pages/ReadinessPage.test.tsx -t "unreachable"`. `npm test` includes the token and contrast checks
- Backend lint and types (host, in `backend/`): `uv run ruff check . && uv run ruff format --check . && uv run pyright`
- Frontend lint and types (in `frontend/`): `npm run lint && npm run typecheck`
- The frontend uses npm.
- CI (`.github/workflows/ci.yml`) runs on pull requests and pushes to `main` as three parallel jobs: backend lint and types, backend tests (the same Compose command as above, with `.env` copied from `.env.example`), and frontend lint, types, tests and build.

## Architecture

Caddy is the only published port. It serves the built frontend (baked into its image) and proxies `/api/` to FastAPI. In dev mode it proxies `/` to the Vite dev server instead. Postgres, Redis and MinIO are internal. Three one-shot services run at startup: `migrate` (Alembic), `seed` (after `migrate`; the API waits for it) and `minio-init` (creates the bucket).

- `backend/app/`: `api/v1/` routes call `services/`, which use probes and clients from `data/`. `deps.py` wires them with FastAPI dependency injection; `main.create_app` builds the clients at startup. Settings come from environment variables only (`config.py`).
- Content: `content/*.yaml` (profile, Stages, Projects) is mounted read-only at `CONTENT_DIR` (`/content`). `app/content/` validates it (`schema.py`, `loader.py`); `app/seed.py` loads it through `ContentRepository.sync`, which upserts on Stage key / Project slug and deletes rows missing from the files. Position is the file order. The profile is one JSONB row; Stages and Projects are tables. Alembic revision `0002` holds the schema.
- Media (`app/media/`, `content/media.yaml`): the seed's second step prepares the Portrait, Video CV and CV PDF from `MEDIA_DIR` (default `./my_docs`, mounted read-only at `MEDIA_SOURCE_DIR` `/media-source`; `my_docs/.gitkeep` is tracked so a clone has the folder and Docker never creates it as root). `manifest.py` validates the manifest (bare file names only), `images.py` makes widths in AVIF, WebP and JPEG (orientation applied, sRGB converted, all metadata dropped), `video.py` runs ffmpeg (HDR HLG/PQ goes through a zscale/tonemap chain to SDR BT.709; 1080p and 720p, `+faststart`), `prepare.py` names every object by content hash, `pipeline.py` syncs one role at a time: skip when the source is absent (strict fails, naming the files), leave alone when the source SHA-256 and the settings hash (widths, qualities, ffmpeg arguments) match the `media_items` row and the objects exist, otherwise upload, record, delete the old keys. A final sweep deletes bucket objects no row refers to. `data/storage.py` `MediaStore` applies the public-read bucket policy (GetObject only, so no listing or writes) at every seed. `media_items` (Alembic `0004`) has one row per role with a JSONB list of variants; `GET /api/v1/media` maps keys to `/media/<key>` addresses. `infra/caddy/media.caddy` (imported by both Caddyfiles) serves `/media/*` from MinIO: reads only, flat object names only (`[A-Za-z0-9_-][A-Za-z0-9._-]*`) and no query strings, immutable cache header on 200/206/304, every error answered as a plain 404 with no upstream body, MinIO headers stripped. Directive order matters there, so the steps sit inside a `route` block. ffmpeg is installed in the `dev` and `seed` image targets only, never `prod` (the API). Media tests use generated fixtures (`tests/media_helpers.py`), a throwaway bucket and the `_test` database, and never the real files.
- The Summary waits for `/media` to settle (failure counts as no media) so the Portrait is in the first paint with explicit dimensions. `components/Portrait.tsx`, `VideoCv.tsx` (`preload="none"`, 720p and a smaller poster below 768px) and `CvDownload.tsx` draw nothing when their role is absent. On `lg` screens the identity column (Portrait at 160px, name, headline, contacts, CV download) must fit the first screen at 1280x800; it sticks only on viewports at least 50rem tall (the `tall` variant, a `@custom-variant` in `index.css`, the one literal allowed outside `@theme` because media queries cannot read tokens) and scrolls with the page on shorter ones.
- A Challenge written as `PLACEHOLDER: text` is stored without the marker plus `challenge_is_placeholder`. Strict seed lists every `PLACEHOLDER:` in any text field and loads nothing. Stage keys are fixed by `StageKey` in `schema.py`; Visits depend on them.
- Content tests run against a throwaway `<POSTGRES_DB>_test` database (created and migrated per session in `tests/conftest.py`), never the stack's own data. The suite also checks that `content/` validates and has no phone-shaped text.
- Logs are JSON through structlog, including uvicorn's. `middleware.py` binds `X-Request-ID` (accepted or generated) to every line and logs one `request` line per request. Uvicorn's access log is off because it prints client IPs, which ADR 0002 forbids.
- Readiness (`/api/v1/health/ready`) pings each dependency with a short timeout and returns 503 with per-dependency status when any fails.
- Frontend (`frontend/src/`): React Router routes in `App.tsx` (`/` redirects to `/summary` until the Climb, ticket #14; `/projects/:slug` is a Project; `/status` is readiness; anything else is not-found), all inside `components/Shell.tsx` (header, nav, footer, skip link). `pages/` holds one component per route. `api/` is the typed client: `types.ts` mirrors the API responses, `client.ts` has the fetch wrapper (`ApiError`) and TanStack Query options, `useSummary.ts` combines profile and Projects into loading, error or ready. `useProject.ts` finds one Project by slug in the cached Projects list (so previous and next follow the API's order and cost no request): loading, error, not-found (an unknown slug, distinct from a failed request) or ready. The first Project has no previous link and the last no next; nothing wraps. `components/ProjectGallery.tsx` renders the optional `Project.media` (the API sends none yet) and draws nothing, not even its heading, when there is no picture. `readiness.ts` treats anything other than a 200 or 503 report as "API unreachable". Each route sets its title with `usePageTitle`.
- Design tokens live in the `@theme` block of `frontend/src/index.css`: colour (night ground, one sunrise accent, derived from ADR 0001), type scale, spacing, radius, motion durations and easings, focus. The block resets Tailwind's defaults, so only these exist. **Tokens only**: components use token utilities (`text-ink`, `px-gutter`, `animate-rise`), never literals or arbitrary values such as `text-[13px]`, `#fff` or `300ms`. `src/design/tokens.test.ts` fails on any such literal in a component or in the stylesheet outside `@theme`; `src/design/contrast.test.ts` computes WCAG AA contrast for every text colour in use on each surface. Both run in `npm test`, so CI enforces them. Add a new colour to `@theme` before using it, and a new surface to `SURFACES` in the contrast test.
- **No third-party requests from the browser** (ADR 0002): fonts are `@fontsource` packages bundled by Vite; no CDN, analytics, external images or scripts. Anything a page loads must come from our own origin.
- Frontend tests render the real `App` in a memory router with `fetch` stubbed (`src/test/render.tsx`, fixtures in `src/test/fixtures.ts`).
- Pyright runs in `standard` mode, not `strict`, because redis and Starlette's test client are not fully typed.

## Design

- **Vocabulary**: `CONTEXT.md` defines the project's terms (Climb, Stage, Visit, Progress and the rest). Use them exactly in code, copy and issues.
- **Decisions**: `docs/adr/` records the choices a reader would otherwise undo, such as the 3D scene and anonymous Visitors.
- **Frontend work**: load the `design-taste-frontend` and `emil-design-eng` skills before building UI, and audit finished UI with `web-design-guidelines`. Ali asked for these by name.

## Models

Sonnet implements and Opus reviews. When dispatching a subagent, set its model to match the work: `sonnet` to build a ticket, `opus` to review code.

## Source content (`my_docs/`)

Site copy comes from these files and from Ali's own words. Reproduce roles, dates and metrics exactly as written (95% detection recall, 97% track purity, 92% classification accuracy, and so on).

`my_docs/*` is git-ignored (only `.gitkeep` is tracked, so a clone has the folder) because the repo is public and the CV carries Ali's phone number. The files exist only on Ali's machine, and the phone number stays out of tracked files. Tests never use them.

- `Ali_Saleh_CV_AI_Development_Specialist.pdf` is the primary source: summary, skills by category, experience, six AI automation and agent projects, education and certifications. Read it with the Read tool, since grep cannot search a PDF.
- `additional-skill.txt` is Ali's note on the Kirelo role. The CV's Kirelo entry already covers it, so the CV wording wins. Its one extra fact is that Ali hikes.
- `Ali_Saleh-avatar.jpg` is the Portrait.
- `Ali_Saleh_CV.MOV` is the Video CV: 84 seconds of 1080p HEVC at 115 MB, in English, without captions by Ali's decision.

## Agent skills

### Issue tracker

Issues and specs live in this repo's GitHub Issues, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five default roles, each label equal to its name: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root, created lazily. See `docs/agents/domain.md`.
