# ── Stage 1: build the React frontend ────────────────────────────────────────
FROM node:20-slim AS frontend-build
WORKDIR /frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci || npm install
COPY frontend/ .
RUN npm run build

# ── Stage 2: Python app ───────────────────────────────────────────────────────
FROM python:3.11-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

# Install curl so the Docker health check can actually run
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY pyproject.toml .
RUN uv pip install --system .

# Copy the contents of your local 'app' folder into the container's /app
COPY app/ .

# Copy React build results into the container's static folder
COPY --from=frontend-build /frontend/dist/ ./static/

RUN mkdir -p /app/outputs
EXPOSE 8000

# Entry point must match the flat structure (main.py is in the current directory)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
