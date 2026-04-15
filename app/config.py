# config.py — Environment variables and app-wide constants.

from dotenv import load_dotenv
import os

load_dotenv()

ANTHROPIC_API_KEY: str = os.environ.get("ANTHROPIC_API_KEY", "")
OLLAMA_BASE_URL: str = os.environ.get("OLLAMA_BASE_URL", "")  # e.g. http://host.docker.internal:11434
OUTPUTS_DIR: str = "/app/outputs"

SUPABASE_PROJECT_ID: str = os.getenv("SUPABASE_PROJECT_ID", "")
SUPABASE_URL: str = f"https://{os.getenv('SUPABASE_PROJECT_ID', '')}.supabase.co"
SUPABASE_ANON_KEY: str = os.getenv("SUPABASE_PUBLISHABLE_API_KEY", "")
SUPABASE_SERVICE_ROLE_KEY: str = os.getenv("SUPABASE_SECRET_API_KEY", "")

# Model used for simple/general queries to save cost.
GENERAL_MODEL: str = "claude-haiku-4-5-20251001"

# Per-agent model routing.
# Agent 2 uses a two-tier split: Sonnet for the first (main rewrite) call,
# Haiku for subsequent targeted single-section edits.
AGENT_MODELS: dict[str, dict] = {
    "agent1": {"model": "claude-sonnet-4-6", "mode": "single"},
    "agent2": {"main": "claude-sonnet-4-6", "targeted": "claude-haiku-4-5"},
    "agent3": {"model": "claude-sonnet-4-6", "mode": "single"},
    "agent4": {"model": "claude-sonnet-4-6", "mode": "single"},
    "agent4_validation": {"model": "claude-haiku-4-5-20251001", "mode": "single"},
    "agent4_eval": {"model": "claude-haiku-4-5-20251001", "mode": "single"},
    "agent4_coaching": {"model": "claude-sonnet-4-6", "mode": "single"},
}
