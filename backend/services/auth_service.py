"""Auth helpers - verify Supabase access tokens."""
from fastapi import HTTPException, Security
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from services.supabase_client import get_service_client, get_anon_client

bearer = HTTPBearer()


async def get_current_user(credentials: HTTPAuthorizationCredentials = Security(bearer)) -> dict:
    token = credentials.credentials

    # Validate token using Supabase Auth. Prefer service client and fallback to anon.
    auth_res = None
    err_detail = None
    try:
        auth_res = get_service_client().auth.get_user(token)
    except Exception as service_err:
        err_detail = str(service_err)
        try:
            auth_res = get_anon_client().auth.get_user(token)
        except Exception as anon_err:
            err_detail = str(anon_err) or err_detail

    if auth_res is None:
        raise HTTPException(status_code=401, detail=f"Invalid token: {err_detail}")

    sb_user = getattr(auth_res, "user", None)
    user_id = getattr(sb_user, "id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    sb = get_service_client()
    result = sb.table("users").select("*").eq("id", user_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="User not found in system")
    return result.data


async def require_superadmin(user: dict = Security(get_current_user)) -> dict:
    if user.get("role") != "superadmin":
        raise HTTPException(status_code=403, detail="Super admin access required")
    return user


async def require_admin_or_superadmin(user: dict = Security(get_current_user)) -> dict:
    if user.get("role") not in ("superadmin", "admin"):
        raise HTTPException(status_code=403, detail="Admin access required")
    return user
