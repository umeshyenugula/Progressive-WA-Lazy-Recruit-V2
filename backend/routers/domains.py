"""Domain and criteria management."""
from fastapi import APIRouter, Depends, HTTPException
from models.schemas import DomainCreate, DomainUpdate, DomainOut, CriteriaCreate, CriteriaOut
from services.auth_service import require_superadmin, require_admin_or_superadmin
from services.supabase_client import get_service_client

router = APIRouter()

DOMAIN_WITH_ADMINS_SELECT = (
    "*, domain_admins(admin_id, users!domain_admins_admin_id_fkey(id, full_name, email))"
)


# ── Domains ────────────────────────────────────────────────────

@router.get("/", response_model=list[dict])
async def list_domains(user=Depends(require_admin_or_superadmin)):
    svc = get_service_client()
    if user["role"] == "superadmin":
        res = svc.table("domains").select(DOMAIN_WITH_ADMINS_SELECT).order("name").execute()
    else:
        # Admin sees only their assigned domains
        da_res = svc.table("domain_admins").select("domain_id").eq("admin_id", user["id"]).execute()
        domain_ids = [r["domain_id"] for r in (da_res.data or [])]
        if not domain_ids:
            return []
        res = svc.table("domains").select(DOMAIN_WITH_ADMINS_SELECT).in_("id", domain_ids).execute()
    return res.data or []


@router.post("/", response_model=DomainOut)
async def create_domain(body: DomainCreate, superadmin=Depends(require_superadmin)):
    svc = get_service_client()
    payload = {"name": body.name, "description": body.description}
    res = svc.table("domains").insert(payload).execute()
    if not res.data:
        raise HTTPException(status_code=500, detail="Failed to create domain")
    domain = res.data[0]

    # Assign admins if provided
    if body.admin_ids:
        records = [
            {"domain_id": domain["id"], "admin_id": str(aid), "assigned_by": superadmin["id"]}
            for aid in body.admin_ids
        ]
        svc.table("domain_admins").upsert(records, on_conflict="domain_id,admin_id").execute()

    return domain


@router.patch("/{domain_id}", response_model=DomainOut)
async def update_domain(domain_id: str, body: DomainUpdate, superadmin=Depends(require_superadmin)):
    svc = get_service_client()
    data = {}
    if body.name is not None:
        data["name"] = body.name
    if body.description is not None:
        data["description"] = body.description

    if data:
        res = svc.table("domains").update(data).eq("id", domain_id).execute()
        if not res.data:
            raise HTTPException(status_code=404, detail="Domain not found")
        domain = res.data[0]
    else:
        dom_res = svc.table("domains").select("*").eq("id", domain_id).single().execute()
        if not dom_res.data:
            raise HTTPException(status_code=404, detail="Domain not found")
        domain = dom_res.data

    # Replace admin assignments if admin_ids is provided
    if body.admin_ids is not None:
        svc.table("domain_admins").delete().eq("domain_id", domain_id).execute()
        if body.admin_ids:
            records = [
                {"domain_id": domain_id, "admin_id": str(aid), "assigned_by": superadmin["id"]}
                for aid in body.admin_ids
            ]
            svc.table("domain_admins").upsert(records, on_conflict="domain_id,admin_id").execute()

    return domain


@router.delete("/{domain_id}")
async def delete_domain(domain_id: str, _=Depends(require_superadmin)):
    svc = get_service_client()
    svc.table("domains").delete().eq("id", domain_id).execute()
    return {"deleted": True}


# ── Criteria ───────────────────────────────────────────────────

@router.get("/{domain_id}/criteria", response_model=list[CriteriaOut])
async def get_criteria(domain_id: str, _=Depends(require_admin_or_superadmin)):
    svc = get_service_client()
    res = svc.table("criteria").select("*").eq("domain_id", domain_id).order("created_at").execute()
    return res.data or []


@router.post("/criteria", response_model=CriteriaOut)
async def create_criteria(body: CriteriaCreate, _=Depends(require_superadmin)):
    svc = get_service_client()
    payload = {"domain_id": str(body.domain_id), "name": body.name, "max_score": body.max_score}
    res = svc.table("criteria").insert(payload).execute()
    if not res.data:
        raise HTTPException(status_code=500, detail="Failed to create criteria")
    return res.data[0]


@router.delete("/criteria/{criteria_id}")
async def delete_criteria(criteria_id: str, _=Depends(require_superadmin)):
    svc = get_service_client()
    svc.table("criteria").delete().eq("id", criteria_id).execute()
    return {"deleted": True}
