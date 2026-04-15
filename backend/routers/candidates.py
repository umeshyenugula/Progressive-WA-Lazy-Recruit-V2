"""Candidate CRUD + assignment + export."""
import io
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from typing import List, Optional
import openpyxl
from models.schemas import (
    CandidateCreate, CandidateUpdate, CandidateOut,
    AssignCandidates, BulkStatusUpdate
)
from services.auth_service import require_superadmin, require_admin_or_superadmin, get_current_user
from services.supabase_client import get_service_client

router = APIRouter()


@router.get("/", response_model=List[dict])
async def list_candidates(
    user=Depends(get_current_user),
    domain_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    branch: Optional[str] = Query(None),
    search: Optional[str] = Query(None),
):
    svc = get_service_client()

    # ALL admins and superadmin see ALL candidates — no domain restriction
    query = svc.table("candidates").select(
        "*, "
        "candidate_domains(domain_id, domains(id, name)), "
        "evaluations(id, candidate_id, domain_id, admin_id, round_number, scores, total_score, remarks, created_at, updated_at, users(full_name, email))"
    )

    # Optional domain filter (for UI filter bar)
    if domain_id:
        cd_res = svc.table("candidate_domains").select("candidate_id").eq("domain_id", domain_id).execute()
        ids = list({r["candidate_id"] for r in (cd_res.data or [])})
        if not ids:
            return []
        query = query.in_("id", ids)

    if status:
        query = query.eq("status", status)
    if branch:
        query = query.eq("branch", branch)

    res = query.order("created_at", desc=True).execute()
    data = res.data or []

    if search:
        s = search.lower()
        data = [
            c for c in data
            if s in (c.get("name") or "").lower()
            or s in (c.get("email") or "").lower()
            or s in (c.get("roll_number") or "").lower()
        ]

    return data


@router.get("/{candidate_id}")
async def get_candidate(candidate_id: str, _=Depends(require_admin_or_superadmin)):
    svc = get_service_client()
    res = svc.table("candidates").select(
        "*, "
        "candidate_domains(domain_id, domains(id, name)), "
        "evaluations(*, users(full_name, email))"
    ).eq("id", candidate_id).single().execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return res.data


@router.post("/", response_model=CandidateOut)
async def create_candidate(body: CandidateCreate, user=Depends(require_admin_or_superadmin)):
    """Both superadmin and admins can create a candidate."""
    svc = get_service_client()

    payload = body.model_dump(exclude={"domain_ids"})
    payload["created_by"] = user["id"]
    if payload.get("extra_data") is None:
        payload["extra_data"] = {}

    try:
        res = svc.table("candidates").insert(payload).execute()
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to create candidate: {e}")

    candidate = res.data[0]
    cid = candidate["id"]

    domain_ids_to_assign = [str(did) for did in (body.domain_ids or [])]
    if domain_ids_to_assign:
        records = [
            {"candidate_id": cid, "domain_id": did, "assigned_by": user["id"]}
            for did in domain_ids_to_assign
        ]
        svc.table("candidate_domains").upsert(records, on_conflict="candidate_id,domain_id").execute()

    return candidate


@router.patch("/{candidate_id}")
async def update_candidate(candidate_id: str, body: CandidateUpdate, user=Depends(require_admin_or_superadmin)):
    svc = get_service_client()
    data = body.model_dump(exclude_none=True)

    # Admins cannot change status (only superadmin does bulk status)
    if user["role"] == "admin":
        data.pop("status", None)

    if not data:
        raise HTTPException(status_code=400, detail="No fields to update")

    res = svc.table("candidates").update(data).eq("id", candidate_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return res.data[0]


# ── Domain assignment per candidate ────────────────────────────

@router.post("/{candidate_id}/domains/{domain_id}")
async def add_candidate_domain(
    candidate_id: str,
    domain_id: str,
    user=Depends(require_admin_or_superadmin)
):
    """Assign an existing candidate to a domain. Any admin or superadmin can do this."""
    svc = get_service_client()

    # Verify both exist
    cand = svc.table("candidates").select("id").eq("id", candidate_id).execute()
    if not cand.data:
        raise HTTPException(status_code=404, detail="Candidate not found")
    dom = svc.table("domains").select("id").eq("id", domain_id).execute()
    if not dom.data:
        raise HTTPException(status_code=404, detail="Domain not found")

    record = {"candidate_id": candidate_id, "domain_id": domain_id, "assigned_by": user["id"]}
    svc.table("candidate_domains").upsert(record, on_conflict="candidate_id,domain_id").execute()
    return {"assigned": True, "candidate_id": candidate_id, "domain_id": domain_id}


@router.delete("/{candidate_id}/domains/{domain_id}")
async def remove_candidate_domain(
    candidate_id: str,
    domain_id: str,
    _=Depends(require_admin_or_superadmin)
):
    """Remove a candidate from a domain."""
    svc = get_service_client()
    svc.table("candidate_domains").delete()\
        .eq("candidate_id", candidate_id)\
        .eq("domain_id", domain_id)\
        .execute()
    return {"removed": True, "candidate_id": candidate_id, "domain_id": domain_id}


# ── Bulk operations ─────────────────────────────────────────────

@router.post("/assign")
async def assign_candidates(body: AssignCandidates, user=Depends(require_admin_or_superadmin)):
    svc = get_service_client()
    records = [
        {"candidate_id": str(cid), "domain_id": str(body.domain_id), "assigned_by": user["id"]}
        for cid in body.candidate_ids
    ]
    res = svc.table("candidate_domains").upsert(records, on_conflict="candidate_id,domain_id").execute()
    return {"assigned": len(res.data or [])}


@router.post("/bulk-status")
async def bulk_status_update(body: BulkStatusUpdate, _=Depends(require_superadmin)):
    svc = get_service_client()
    ids = [str(i) for i in body.candidate_ids]
    svc.table("candidates").update({"status": body.status}).in_("id", ids).execute()
    return {"updated": len(ids), "status": body.status}


@router.get("/export/shortlisted")
async def export_shortlisted(_=Depends(require_superadmin)):
    svc = get_service_client()
    res = svc.table("candidates").select(
        "name, email, phone, roll_number, branch, section, year, skills, experience, status"
    ).in_("status", ["shortlisted", "selected"]).execute()

    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Shortlisted"
    headers = ["Name", "Email", "Phone", "Roll Number", "Branch", "Section", "Year", "Skills", "Experience", "Status"]
    ws.append(headers)
    for c in (res.data or []):
        ws.append([c.get(h.lower().replace(" ", "_")) for h in headers])

    stream = io.BytesIO()
    wb.save(stream)
    stream.seek(0)
    return StreamingResponse(
        stream,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=shortlisted_candidates.xlsx"},
    )
