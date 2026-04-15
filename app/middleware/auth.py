# middleware/auth.py — Supabase JWT verification dependency for FastAPI routes.
from fastapi import Depends, HTTPException, Header
from supabase import create_client, Client
from app.config import SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

# Module-level admin client — initialized once at import time.
# Uses service role key to verify user tokens server-side.
_supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


async def get_current_user(authorization: str = Header(...)) -> str:
    """
    FastAPI dependency. Verifies a Supabase JWT and returns the user's Supabase UUID (auth_id).
    Raises HTTP 401 if the Authorization header is missing, malformed, or the token is invalid.
    """
    try:
        token = authorization.removeprefix("Bearer ")
        response = _supabase.auth.get_user(token)
        if not response.user:
            raise HTTPException(status_code=401, detail="Invalid or expired token")
        return response.user.id
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
