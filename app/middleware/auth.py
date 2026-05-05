# middleware/auth.py — Clerk JWT verification dependency for FastAPI routes.
import base64

import jwt
from jwt import PyJWKClient
from fastapi import Header, HTTPException

from config import CLERK_PUBLISHABLE_KEY


def _jwks_url_from_publishable_key(publishable_key: str) -> str:
    """Derive the JWKS endpoint from the Clerk publishable key.

    Clerk publishable keys are formatted as pk_test_<base64>$ or pk_live_<base64>$.
    The base64 payload decodes to the Frontend API host (e.g. clerk.example.com).
    """
    b64 = publishable_key.split("_", 2)[2]
    # Pad to a multiple of 4
    b64 += "=" * (4 - len(b64) % 4)
    frontend_api = base64.b64decode(b64).decode("utf-8").rstrip("$")
    return f"https://{frontend_api}/.well-known/jwks.json"


_jwks_client = PyJWKClient(
    _jwks_url_from_publishable_key(CLERK_PUBLISHABLE_KEY),
    cache_keys=True,
)


async def get_current_user(authorization: str = Header(...)) -> str:
    """
    FastAPI dependency. Verifies a Clerk session JWT and returns the Clerk user ID (sub claim).
    Raises HTTP 401 if the token is missing, malformed, or invalid.
    """
    try:
        token = authorization.removeprefix("Bearer ")
        signing_key = _jwks_client.get_signing_key_from_jwt(token)
        payload = jwt.decode(
            token,
            signing_key.key,
            algorithms=["RS256"],
            options={"verify_exp": True},
        )
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token: missing sub claim")
        return user_id
    except HTTPException:
        raise
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
