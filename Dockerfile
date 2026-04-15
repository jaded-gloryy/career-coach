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

WORKDIR /app

# Copy dependencies first for caching
COPY pyproject.toml .
RUN uv pip install --system .

# Copy the CONTENTS of your app folder to /app in the container
# This puts main.py at /app/main.py instead of /app/app/main.py
COPY app/ .

# Copy frontend build into the static folder
COPY --from=frontend-build /frontend/dist/ ./static/

RUN mkdir -p /app/outputs
EXPOSE 8000

# Updated entry point: now it's just main:app
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
