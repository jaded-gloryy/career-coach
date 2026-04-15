# ── Stage 1: build the React frontend ────────────────────────────────────────
FROM node:20-slim AS frontend-build

WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --prefer-offline 2>/dev/null || npm install
COPY frontend/ .
RUN npm run build
# output: /frontend/dist

# ── Stage 2: Python app ───────────────────────────────────────────────────────
FROM python:3.11-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

COPY pyproject.toml .
COPY app/ ./app/

# Replace static dir with the built React bundle
COPY --from=frontend-build /frontend/dist/ ./app/static/

RUN uv pip install --system .

RUN mkdir -p /app/outputs

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
