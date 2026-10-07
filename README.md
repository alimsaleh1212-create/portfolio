# Portfolio

Ali Saleh's personal portfolio. It presents his career to recruiters and hiring managers as a hiker's climb up a 3D mountain. The full spec is GitHub issue #1; the vocabulary is in `CONTEXT.md`.

Every service runs under Docker Compose. The text content (profile, Stages, Projects) is in `content/` and the API serves it; the frontend shows it as the Climb at <http://localhost:8080/> (an opening screen, the five Stages as you scroll, the Summit ahead and the contact section, with an altitude meter; `/#ridge` and the other Stage keys open at that Stage), on the Summary page at `/summary`, and on a page per Project at `/projects/{slug}` with links to the previous and next Project (`/status` shows readiness). Behind the Climb's text there is a 3D mountain, generated in code from a seed (identical on every load) and lit from pre-dawn at the Trailhead to sunrise at High Camp; scrolling moves its camera up the trail. It is a separate download that loads after the text has painted. Each device is served one of three tiers, decided once at page load: full (the whole scene), light (the same scene, cheaper: a coarser ground, fewer pines and stars, pixel ratio 1) or still (no canvas: a picture of the scene for each position behind the same text, for no WebGL 2, software rendering or reduced motion). A full tier whose frames stay slow drops to light, and a lost graphics context drops to still, without a reload. `?tier=full|light|still` forces a tier. The still pictures are captured from the full scene with `cd frontend && npm run stills` (stack up) and `npm test` fails when they are out of date; the browser tests are `cd frontend && npm run e2e` (stack up). Add `?debug` to the Climb's address to see frames per second, triangles and draw calls (`?debug&at=3.5` also pins the camera at a point on the journey, 0 to 6).

| Folder | Holds |
|---|---|
| `backend/` | FastAPI API (Python 3.13, uv), Alembic migrations |
| `frontend/` | Vite, React, TypeScript, Tailwind (npm) |
| `content/` | Text content in YAML: `profile.yaml`, `stages.yaml`, `projects.yaml`, and `media.yaml` (the media manifest) |
| `my_docs/` | The source Portrait, Video CV and CV PDF (git-ignored; only `.gitkeep` is tracked) |
| `infra/` | Caddy configuration and image; `infra/observability/` has the configuration and Grafana dashboards of the observability profile |

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

## Caching

The five read endpoints are cached in Redis and carry a strong `ETag` with `Cache-Control: no-cache`, so a browser asks again and gets `304` when it already has the latest copy. Content only changes when the seed runs, and the seed invalidates the cache itself as its last step, so the next request after a seed returns the new content. If Redis is down the endpoints answer from Postgres and log one warning. Visits, contact and health are sent `Cache-Control: no-store`.

Caddy serves the hashed files in `/assets/` with a one-year `immutable` header, serves the pre-rendered HTML and the favicon so browsers revalidate them (`Cache-Control: no-cache`, answered `304` from the file's `ETag`), and compresses text and JSON.

## Pre-rendering

The pages are drawn to HTML ahead of time so a crawler that does not run JavaScript, and a chat or social app building a link preview, see the real content: the landing page, the Summary and one page per Project (eight today; more if Projects are added). A one-shot `prerender` service runs the real React app on the server side, reads the same API endpoints the pages use (so the text comes from the seed, never from the frontend's source), and writes the HTML, `sitemap.xml` and `robots.txt` to a volume that Caddy serves. The browser then takes the page over (hydration) with the same data, so nothing is fetched twice and nothing flashes or jumps. The tier decision, the 3D scene, the still backdrop and the Visit still start in the browser only.

- **It runs at every start**, after the seed and before Caddy, so a normal `docker compose up` always serves pages that match the content.
- **After a manual seed, re-run it** (no image is rebuilt; about a second):

  ```bash
  docker compose run --rm --no-deps prerender
  ```

  `--no-deps` matters: without it Compose may start the seed again first. Dev mode does not pre-render: the Vite dev server draws the pages in the browser, with hot reload, and Caddy does not wait for the job.
- **Each page** has its own title, description (built from the profile's headline and summary, or a Project's tagline and description, at most 160 characters and never cut in the middle of a word), canonical address, Open Graph and Twitter card tags and a 1200x630 preview picture. The pictures are cropped from the scene's stills by the media pipeline: the landing page uses the opening view, the Summary the Summit, and the Projects the Trailhead, Long Approach, Steep Switch, Ridge and High Camp views in order (a sixth Project wraps round to the Trailhead). The landing page also carries structured data (a schema.org Person: name, headline as job title, email, LinkedIn and GitHub; no phone number).
- **`SITE_URL`** in `.env` is the site's public address (default `http://localhost:<CADDY_PORT>`). Canonical addresses, the sitemap and the preview picture addresses are written from it, so set it to the real address and re-run the pre-render when deploying.
- **Not found**: an address that is not a page answers `404` with the app's not-found page (an unknown Project slug gets the "Project not found" page). `/status` is a real page, marked `noindex` and disallowed in `robots.txt`, as is `/api/`.

Cache hit, miss and error counts are at `http://api:9100/metrics` inside the Compose network (not published, not proxied by Caddy). Request count and duration by route and status, and the database pool's state, are in the same endpoint. Clear the cache by hand with `docker compose run --rm api python -m app.clear_cache`; it leaves the Visitor salt and rate-limit counters alone. Tunables: `CACHE_TTL_SECONDS`, `CACHE_TIMEOUT_SECONDS`, `METRICS_PORT`.

Stop with `docker compose down`; add `-v` to also delete the data volumes.

## Visits and privacy

The site records each Visit (one page load) and how far up the Climb it got, and never identifies a Visitor (ADR 0002). It sets no cookies and writes nothing to local or session storage, and the API has no CORS because the frontend is same-origin.

- `POST /api/v1/visits` starts a Visit and returns `{"id": ...}`; a known bot gets `204` and no ID. `POST /api/v1/visits/{id}/events` adds a Stage reached, Project opened, CV downloaded or contact message sent event (`204`; repeating a Stage reached changes nothing). Both answer `429` past a per-client limit; bodies over 4 KiB get `413`; a Visit takes events for 24 hours.
- Unique Visitors are counted with a hash of the client address and user agent, keyed by a random salt that exists only in Redis and expires after its UTC day. The address is never stored or logged. If Redis is down, Visits are recorded without a hash.
- Progress is derived, not stored. The views `visit_progress` (each Visit's highest Stage) and `visits_per_stage` (a funnel in Climb order: the Visits whose Progress is that Stage or higher) are what Grafana reads.
- Caddy writes no access log on purpose and passes the client address to the API in `X-Forwarded-For`, replacing whatever the client sent.

## Contact messages

`POST /api/v1/contact` takes `{"name", "email", "message"}` and stores it in `contact_messages`; it is the one place personal details are kept, because the Visitor typed them in (ADR 0002). A message is not linked to a Visit.

- Answers: `201 {"received": true}`; `422` with `{"errors": {"<field>": "<message>"}}` (names up to 100 characters, a real address up to 254, a message of 10 to 4000 characters; line breaks and control codes are refused in the name and address, and the answer never echoes the input); `429` with `Retry-After` past 3 messages per client per hour (`CONTACT_LIMIT_PER_HOUR`); bodies over 32 KiB get `413`.
- The honeypot is an extra `website` field. A filled one gets the same `201` and nothing is stored or emailed.
- Email delivery is on only when `SMTP_HOST`, `MAIL_SENDER` and `MAIL_RECIPIENT` are all set. Also `SMTP_PORT` (587), `SMTP_USERNAME` and `SMTP_PASSWORD`, `SMTP_SECURITY` (`starttls`, `tls` or `none`). The message goes to `MAIL_RECIPIENT` with the Visitor's address as Reply-To. It is one attempt after the response is sent, so a mail failure never fails the request or loses the stored message. They are all listed, commented out, in `.env.example`.
- Logs record the message ID and whether delivery was attempted and succeeded, never the name, address or text. To read messages without email, query the table or open the Contact messages panel in Grafana (see Observability).

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

### The Hiker's model (tracked)

The one media item that is in git is the Hiker's 3D model, `content/hiker/hiker.glb`, because its licence allows it. `content/media.yaml` names it under `hiker` as a path inside `content/`; the seed stores it in MinIO like the others (`hiker-<hash>.glb`, listed by `/api/v1/media`), so a fresh clone and CI have it with an empty media folder.

## Credits

The Hiker is "Rogue (Hooded)" from the KayKit *Adventurers Character Pack* by [Kay Lousberg](https://www.kaylousberg.com), licensed CC0 (public domain), modified (weapons, cape and most animations removed; a rucksack added). Source, licence text, changes and file hashes: [`content/hiker/CREDITS.md`](content/hiker/CREDITS.md).

## Observability (optional)

An optional Compose profile adds Prometheus (metrics), Loki (logs), Tempo (traces), Alloy (the one collector) and Grafana. With the profile off the site runs exactly as before: no extra container and nothing tries to export anything. This is also where Ali reads his Visits, their Progress and his contact messages, since the site has no admin panel.

Turn it on by setting these in `.env` (see `.env.example`; there is no default password, and the profile refuses to start without both):

```sh
GRAFANA_ADMIN_PASSWORD=...        # Grafana's admin login (user `admin`)
GRAFANA_DB_PASSWORD=...           # password of the read-only Postgres role Grafana uses
OTEL_EXPORTER_OTLP_ENDPOINT=http://collector:4318   # sends the API's traces to the collector
```

```sh
docker compose --profile observability up -d --build --wait
```

Open <http://localhost:3000> (`GRAFANA_PORT`) and sign in as `admin`. Grafana is bound to localhost only, with anonymous access and sign-up off, and is not behind Caddy. Prometheus, Loki, Tempo and the collector are not published. If a password is missing, the `grafana-setup` container exits and says which one (`docker compose --profile observability logs grafana-setup`). Grafana's admin password is read only when Grafana first creates its database; to change it later, run `docker compose --profile observability exec grafana grafana cli admin reset-admin-password NEW`. Stop with `docker compose --profile observability down` (add `-v` to delete the data).

Both dashboards, all four data sources (Prometheus, Loki, Tempo, Postgres) and their links are provisioned from files in `infra/observability/grafana/`, so there is nothing to set up by hand. Edit the JSON files, not the dashboards in the browser.

**Visits and Progress** (the home dashboard; every panel follows the time range at the top, in UTC days):

| Panel | Shows |
|---|---|
| Visits, Projects opened, CV downloads, Contact messages sent | Totals in the range |
| Visits per day | Visits that started each day |
| Unique Visitors per day | Distinct daily Visitor hashes per day (a returning Visitor counts once per day) |
| Visits per Stage (Progress funnel) | For each Stage in Climb order, the Visits whose Progress is that Stage or higher |
| Referring sites | Referrer hosts, top 10; (direct) means none |
| Device classes, Tiers served | Phone, tablet, desktop; full, light, still |
| Projects opened by Project | Every Project with how often it was opened |
| Contact messages | Date, name, address and text of each message, newest first |

**Application health** (last hour, refreshes every 30 s; a Route filter at the top): requests per second, error rate (5xx), p95 latency and cache hit rate as headline numbers; request rate by route; 5xx and 4xx share of requests; p95 latency by route and a p50/p95/p99 table by route; cache hit rate by endpoint; database connections in use and idle against the pool limit; recent error logs. A log line with a `trace_id` has an "Open trace" link to its trace in Tempo.

Grafana reads Postgres as `grafana_reader`, a role the profile creates (or updates, on a database that already has it) every time it starts. It can `SELECT` from the Visit tables and views, the content tables and `contact_messages`, and can write nothing. Retention is short and local: metrics 7 days, logs 7 days, traces 3 days, on Docker volumes. Memory limits: Prometheus 256 MB, Loki 320 MB, Tempo 320 MB, Grafana 384 MB, collector 192 MB, Docker proxy 64 MB.

Container logs reach Loki through the collector, which asks the Docker API for the logs of this Compose project's containers. It reaches the API only through `docker-proxy`, which holds the Docker socket read-only and lets through only reads of containers and networks.

Telemetry follows the same privacy rules as logs (ADR 0002): no client address, user agent, referrer, Visitor hash, salt, rate-limit key or contact message text in any span, metric label or log line. The traces use hand-made spans with a fixed attribute list instead of the stock instrumentation, and metric labels use route templates (`/api/v1/projects/{slug}`), never raw paths.

Check the profile's files without starting it: `cd backend && uv run python ../infra/observability/check_config.py` (CI runs it).

## Development mode

Hot reload for the API (uvicorn `--reload`, `backend/` mounted) and the frontend (Vite dev server behind Caddy, `frontend/` mounted):

```sh
docker compose -f compose.yaml -f compose.dev.yaml up -d --build --wait
```

Same URL as above. Pages are drawn in the browser here (no pre-rendering). Dev images are named separately from the production ones, and `--build` picks up dependency changes (the first build installs npm packages and takes a few minutes).

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

Browser tests and Lighthouse (stack up; `cd frontend`, `BASE_URL` is the address Caddy listens on):

```sh
BASE_URL=http://localhost:8080 npm run e2e          # Playwright: the whole Climb, privacy, accessibility (axe), keyboard, budgets, tiers, pre-rendering
BASE_URL=http://localhost:8080 npm run lighthouse   # phone profile; writes frontend/lighthouse-report/
```

The browser tests send real contact messages from each tier, and the API allows only three an hour per client, so start the stack for them with `CONTACT_LIMIT_PER_HOUR=1000` in `.env` (CI does). They also look in the stack's Postgres (`docker compose exec`) to see that a Visit's Progress and a message were stored. `npm run e2e` fails on any serious or critical axe violation, on a throttled phone profile whose text takes more than 2.5 seconds or whose layout shifts by 0.1 or more, and on any cookie or storage written during a full Visit; `npm run lighthouse` fails when Accessibility or Best Practices is under 95 on the landing page, the Summary or the landing page with the full tier forced, and reports Performance without gating on it. CI runs both on every pull request and keeps the Lighthouse reports as an artifact.
