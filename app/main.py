# main.py — FastAPI application entry point.
# Mounts static files, includes routers, and manages the DB connection pool lifecycle.

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles

from app import db
from app.config import SUPABASE_URL, SUPABASE_ANON_KEY
from app.routers import chat, files, upload


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init_pool()
    yield
    await db.close_pool()


app = FastAPI(title="Career Coach", lifespan=lifespan)

app.include_router(chat.router)
app.include_router(files.router)
app.include_router(upload.router)


@app.get("/env.js", include_in_schema=False)
def env_js():
    """Serves Supabase public config as a JS snippet so the frontend can bootstrap auth."""
    js = (
        f"window.__ENV__ = {{"
        f'  SUPABASE_URL: "{SUPABASE_URL}",'
        f'  SUPABASE_ANON_KEY: "{SUPABASE_ANON_KEY}"'
        f"}};"
    )
    return Response(content=js, media_type="application/javascript")


app.mount("/", StaticFiles(directory="app/static", html=True), name="static")


@app.get("/health")
def health():
    return {"status": "ok"}
