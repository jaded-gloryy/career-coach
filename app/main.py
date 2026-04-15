# main.py — FastAPI application entry point.
from pathlib import Path
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.responses import Response, FileResponse
from fastapi.staticfiles import StaticFiles

import db
from config import SUPABASE_URL, SUPABASE_ANON_KEY
from routers import chat, files, upload

@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_pool()
    yield
    await db.close_pool()

app = FastAPI(title="Career Coach", lifespan=lifespan)

# 1. API Routers
app.include_router(chat.router)
app.include_router(files.router)
app.include_router(upload.router)

# 2. Configuration & Health Routes
@app.get("/env.js", include_in_schema=False)
def env_js():
    """Serves Supabase public config as a JS snippet."""
    js = (
        f"window.__ENV__ = {{"
        f'  SUPABASE_URL: "{SUPABASE_URL}",'
        f'  SUPABASE_ANON_KEY: "{SUPABASE_ANON_KEY}"'
        f"}};"
    )
    return Response(content=js, media_type="application/javascript")

@app.get("/health")
def health():
    return {"status": "ok"}

# 3. Static File Setup
BASE_DIR = Path(__file__).resolve().parent
static_path = BASE_DIR / "static"

# Explicitly serve index.html at the root
@app.get("/")
async def serve_index():
    return FileResponse(static_path / "index.html")

# 4. Catch-all for React Router
# If a user refreshes on /dashboard, this sends them back to index.html
@app.exception_handler(404)
async def not_found_exception_handler(request: Request, exc):
    return FileResponse(static_path / "index.html")

# 5. Mount Static Directory (Must be at the bottom)
# We mount to "/" so assets like /assets/index.js work correctly
app.mount("/", StaticFiles(directory=str(static_path), html=True), name="static")
