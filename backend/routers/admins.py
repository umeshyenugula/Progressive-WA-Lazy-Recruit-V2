"""Admin management — super admin only."""
from fastapi import APIRouter, Depends, HTTPException
from models.schemas import AdminCreate, AdminOut, DomainAdminAssign
from services.auth_service import require_superadmin
from services.supabase_client import get_service_client

router = APIRouter()


@router.get("/", response_model=list[dict])
async def list_admins(_=Depends(require_superadmin)):
    svc = get_service_client()
    # Get all admins with their assigned domains via domain_admins join
    res = svc.table("users").select("*").eq("role", "admin").order("created_at", desc=True).execute()
    admins = res.data or []

    # Attach domain assignments
    if admins:
        admin_ids = [a["id"] for a in admins]
        da_res = svc.table("domain_admins").select(
            "admin_id, domain_id, domains(id, name)"
        ).in_("admin_id", admin_ids).execute()
        da_map: dict[str, list] = {}
        for row in (da_res.data or []):
            aid = row["admin_id"]
            da_map.setdefault(aid, []).append(row.get("domains"))
        for a in admins:
            a["domains"] = da_map.get(a["id"], [])

    return admins


@router.post("/", response_model=AdminOut)
async def create_admin(body: AdminCreate, superadmin=Depends(require_superadmin)):
    svc = get_service_client()

    # Create auth user
    try:
        auth_res = svc.auth.admin.create_user({
            "email": body.email,
            "password": body.password,
            "email_confirm": True,
        })
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to create auth user: {e}")

    user_id = auth_res.user.id

    try:
        user_payload = {
            "id": user_id,
            "email": body.email,
            "full_name": body.full_name,
            "role": "admin",
            "is_active": True,
        }
        user_res = svc.table("users").insert(user_payload).execute()

        # Assign to domains if provided
        if body.domain_ids:
            domain_records = [
                {"domain_id": str(did), "admin_id": user_id, "assigned_by": superadmin["id"]}
                for did in body.domain_ids
            ]
            svc.table("domain_admins").upsert(
                domain_records, on_conflict="domain_id,admin_id"
            ).execute()

        return user_res.data[0]
    except Exception as e:
        svc.auth.admin.delete_user(user_id)
        raise HTTPException(status_code=500, detail=f"Failed to create admin record: {e}")


@router.post("/{admin_id}/assign-domains")
async def assign_admin_to_domains(admin_id: str, body: DomainAdminAssign, superadmin=Depends(require_superadmin)):
    """Assign (or replace) domains for an admin. Removes old assignments and sets new ones."""
    svc = get_service_client()

    # Verify admin exists
    existing = svc.table("users").select("id, role").eq("id", admin_id).single().execute()
    if not existing.data or existing.data["role"] != "admin":
        raise HTTPException(status_code=404, detail="Admin not found")

    # Remove all current domain assignments for this admin
    svc.table("domain_admins").delete().eq("admin_id", admin_id).execute()

    # Insert new assignments
    if body.admin_ids:  # reuse field for domain_ids list
        records = [
            {"domain_id": str(did), "admin_id": admin_id, "assigned_by": superadmin["id"]}
            for did in body.admin_ids
        ]
        svc.table("domain_admins").upsert(records, on_conflict="domain_id,admin_id").execute()

    return {"assigned": True, "admin_id": admin_id}


@router.post("/domains/{domain_id}/assign")
async def assign_admins_to_domain(domain_id: str, body: DomainAdminAssign, superadmin=Depends(require_superadmin)):
    """Assign multiple admins to a domain (replaces existing assignments)."""
    svc = get_service_client()

    # Verify domain exists
    dom = svc.table("domains").select("id").eq("id", domain_id).single().execute()
    if not dom.data:
        raise HTTPException(status_code=404, detail="Domain not found")

    # Remove all current admins for this domain
    svc.table("domain_admins").delete().eq("domain_id", domain_id).execute()

    # Insert new admin assignments
    if body.admin_ids:
        records = [
            {"domain_id": domain_id, "admin_id": str(aid), "assigned_by": superadmin["id"]}
            for aid in body.admin_ids
        ]
        svc.table("domain_admins").upsert(records, on_conflict="domain_id,admin_id").execute()

    return {"assigned": len(body.admin_ids), "domain_id": domain_id}


@router.patch("/{admin_id}/toggle")
async def toggle_admin(admin_id: str, _=Depends(require_superadmin)):
    svc = get_service_client()
    existing = svc.table("users").select("is_active").eq("id", admin_id).single().execute()
    if not existing.data:
        raise HTTPException(status_code=404, detail="Admin not found")
    new_state = not existing.data["is_active"]
    res = svc.table("users").update({"is_active": new_state}).eq("id", admin_id).execute()
    return {"is_active": new_state, "admin": res.data[0]}


@router.delete("/{admin_id}")
async def delete_admin(admin_id: str, _=Depends(require_superadmin)):
    svc = get_service_client()
    # Remove from domain_admins
    svc.table("domain_admins").delete().eq("admin_id", admin_id).execute()
    # Delete user record
    svc.table("users").delete().eq("id", admin_id).execute()
    # Delete auth user
    try:
        svc.auth.admin.delete_user(admin_id)
    except Exception:
        pass
    return {"deleted": True}
