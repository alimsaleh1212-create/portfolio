# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Work is tracked in GitHub Issues. The milestone 1 spec is #1 and its tickets are its sub-issues; #2 and #3 outline the later milestones. Read the spec before proposing structure or tooling.

## Commands

All Compose commands run from the repo root. Copy `.env.example` to `.env` first.

- Run the stack: `docker compose up -d --build --wait`, then <http://localhost:8080> (`CADDY_PORT`). Stop with `docker compose down` (`-v` deletes data).
- Dev mode (hot reload for API and frontend): `docker compose -f compose.yaml -f compose.dev.yaml up -d --build --wait`. Dev images are separate from prod ones; `--build` picks up dependency changes.
- Backend tests (real Postgres, Redis, MinIO, so run inside Compose): `docker compose -f compose.yaml -f compose.dev.yaml run --build --rm api pytest`
- One backend test: `... run --build --rm api pytest tests/test_health.py::test_live_reports_ok`
- Frontend tests: `cd frontend && npm test`. One test: `npx vitest run src/ReadinessPage.test.tsx -t "unreachable"`
- Backend lint and types (host, in `backend/`): `uv run ruff check . && uv run ruff format --check . && uv run pyright`
- Frontend lint and types (in `frontend/`): `npm run lint && npm run typecheck`
- The frontend uses npm.

## Architecture

Caddy is the only published port. It serves the built frontend (baked into its image) and proxies `/api/` to FastAPI. In dev mode it proxies `/` to the Vite dev server instead. Postgres, Redis and MinIO are internal. Two one-shot services run at startup: `migrate` (Alembic) and `minio-init` (creates the bucket).

- `backend/app/`: `api/v1/` routes call `services/`, which use probes and clients from `data/`. `deps.py` wires them with FastAPI dependency injection; `main.create_app` builds the clients at startup. Settings come from environment variables only (`config.py`).
- Logs are JSON through structlog, including uvicorn's. `middleware.py` binds `X-Request-ID` (accepted or generated) to every line and logs one `request` line per request. Uvicorn's access log is off because it prints client IPs, which ADR 0002 forbids.
- Readiness (`/api/v1/health/ready`) pings each dependency with a short timeout and returns 503 with per-dependency status when any fails.
- `frontend/src/`: `ReadinessPage` renders the readiness result; `readiness.ts` fetches it and treats anything other than a 200 or 503 report as "API unreachable".
- Pyright runs in `standard` mode, not `strict`, because redis and Starlette's test client are not fully typed.

## Design

- **Vocabulary**: `CONTEXT.md` defines the project's terms (Climb, Stage, Visit, Progress and the rest). Use them exactly in code, copy and issues.
- **Decisions**: `docs/adr/` records the choices a reader would otherwise undo, such as the 3D scene and anonymous Visitors.
- **Frontend work**: load the `design-taste-frontend` and `emil-design-eng` skills before building UI, and audit finished UI with `web-design-guidelines`. Ali asked for these by name.

## Models

Sonnet implements and Opus reviews. When dispatching a subagent, set its model to match the work: `sonnet` to build a ticket, `opus` to review code.

## Source content (`my_docs/`)

Site copy comes from these files and from Ali's own words. Reproduce roles, dates and metrics exactly as written (95% detection recall, 97% track purity, 92% classification accuracy, and so on).

`my_docs/` is git-ignored because the repo is public and the CV carries Ali's phone number. The files exist only on Ali's machine, and the phone number stays out of tracked files.

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
