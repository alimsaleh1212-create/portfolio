# Layer order matters on a slow network: nothing that downloads a lot (the
# ffmpeg packages, the Python dependencies) may sit after a `COPY . .`, or
# every code change would fetch it again.
FROM python:3.13-slim AS base
COPY --from=ghcr.io/astral-sh/uv:0.12.9 /uv /usr/local/bin/uv
ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_LINK_MODE=copy \
    PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
RUN useradd --system --no-create-home app
WORKDIR /app

# ffmpeg is for preparing the Video CV, which only the seed and the tests do.
# It is installed here, before any file of the project is copied, so this layer
# is reused until the base image changes. The API's production image does not
# build on this stage and carries no ffmpeg.
FROM base AS media
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

FROM media AS dev
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen
COPY . .
# Non-root, so a bind-mounted ./backend never gets root-owned files.
USER app
CMD ["python", "-m", "app.serve"]

FROM base AS prod
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev
COPY . .
USER app
CMD ["python", "-m", "app.serve"]

# Production dependencies and code, plus ffmpeg, for the seed command.
FROM media AS seed
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev
COPY . .
USER app
CMD ["python", "-m", "app.serve"]
