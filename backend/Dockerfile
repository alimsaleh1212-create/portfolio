FROM python:3.13-slim AS base
COPY --from=ghcr.io/astral-sh/uv:0.12.9 /uv /usr/local/bin/uv
ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_LINK_MODE=copy \
    PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
RUN useradd --system --no-create-home app
WORKDIR /app
COPY pyproject.toml uv.lock ./

# ffmpeg is for preparing the Video CV, which only the seed and the tests do.
# The API's production image does not carry it.
FROM base AS dev
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen
COPY . .
# Non-root, so a bind-mounted ./backend never gets root-owned files.
USER app
CMD ["python", "-m", "app.serve"]

FROM base AS prod
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev
COPY . .
USER app
CMD ["python", "-m", "app.serve"]

# The prod image plus ffmpeg, for the seed command.
FROM prod AS seed
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
USER app
