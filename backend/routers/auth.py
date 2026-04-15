"""Auth endpoints — login via Supabase."""
from fastapi import APIRouter, HTTPException
from models.schemas import LoginRequest, TokenResponse
from services.supabase_client import get_anon_client, get_service_client

router = APIRouter()


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest):
    try:
        anon = get_anon_client()
        resp = anon.auth.sign_in_with_password({"email": body.email, "password": body.password})
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid credentials: {e}")

    if not resp.session:
        raise HTTPException(status_code=401, detail="Login failed — check email/password")

    token = resp.session.access_token
    user_id = resp.user.id

    # Fetch role from public.users
    svc = get_service_client()
    result = svc.table("users").select("*").eq("id", user_id).single().execute()
    if not result.data:
        raise HTTPException(status_code=403, detail="User not registered in system. Contact super admin.")

    user_data = result.data
    if not user_data.get("is_active", True):
        raise HTTPException(status_code=403, detail="Account is deactivated. Contact super admin.")

    return TokenResponse(access_token=token, user=user_data)


@router.post("/logout")
async def logout():
    return {"message": "Logged out"}
