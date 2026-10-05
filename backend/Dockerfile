FROM python:3.13-slim AS base
COPY --from=ghcr.io/astral-sh/uv:0.12.9 /uv /usr/local/bin/uv
ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_LINK_MODE=copy \
    PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY pyproject.toml uv.lock ./

FROM base AS dev
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen
COPY . .
CMD ["python", "-m", "app.serve"]

FROM base AS prod
RUN --mount=type=cache,target=/root/.cache/uv uv sync --frozen --no-dev
COPY . .
RUN useradd --system --no-create-home app
USER app
CMD ["python", "-m", "app.serve"]
