"""Evaluation CRUD — one admin can evaluate a candidate across multiple domains."""
from fastapi import APIRouter, Depends, HTTPException
from typing import List
from uuid import UUID
from models.schemas import EvaluationCreate, EvaluationUpdate, EvaluationOut
from services.auth_service import require_admin_or_superadmin
from services.supabase_client import get_service_client
from pydantic import BaseModel
from typing import Optional, Dict

router = APIRouter()


class MultiDomainEvaluationCreate(BaseModel):
    """Submit evaluations for multiple domains in one call."""
    candidate_id: UUID
    evaluations: List[EvaluationCreate]   # one per domain


@router.post("/", response_model=EvaluationOut)
async def submit_evaluation(body: EvaluationCreate, user=Depends(require_admin_or_superadmin)):
    """Submit/update evaluation for ONE domain. Upserts so concurrent admins don't clash."""
    svc = get_service_client()

    # New mode: question-based evaluation with one overall rating.
    # Backward compatibility: criteria-based scoring still supported.
    scores = dict(body.scores or {})
    if body.overall_rating is not None:
        scores["overall_rating"] = float(body.overall_rating)

    total = 0.0
    uses_overall_rating = "overall_rating" in scores
    if uses_overall_rating:
        try:
            overall = float(scores.get("overall_rating", 0))
        except Exception:
            raise HTTPException(400, "overall_rating must be numeric")
        if overall < 0 or overall > 10:
            raise HTTPException(400, "overall_rating must be between 0 and 10")
        total = overall
    else:
        criteria_res = svc.table("criteria").select("*").eq("domain_id", str(body.domain_id)).execute()
        criteria_map = {str(c["id"]): c["max_score"] for c in (criteria_res.data or [])}

        for cid, score in scores.items():
            max_s = criteria_map.get(cid)
            if max_s is None:
                raise HTTPException(400, f"Unknown criteria id: {cid}")
            if score < 0 or score > max_s:
                raise HTTPException(400, f"Score {score} out of range for criteria {cid} (max {max_s})")
            total += score

    if body.final_general_remarks:
        scores["final_general_remarks"] = body.final_general_remarks

    data = {
        "candidate_id": str(body.candidate_id),
        "domain_id": str(body.domain_id),
        "admin_id": user["id"],
        "round_number": body.round_number,
        "scores": scores,
        "total_score": total,
        "remarks": body.remarks,
    }

    # UNIQUE(candidate_id, domain_id, admin_id) — each admin gets their own row per domain
    res = svc.table("evaluations").upsert(
        data,
        on_conflict="candidate_id,domain_id,admin_id"
    ).execute()
    return res.data[0]


@router.post("/multi")
async def submit_multi_domain_evaluation(
    body: MultiDomainEvaluationCreate,
    user=Depends(require_admin_or_superadmin)
):
    """
    Submit evaluations for ALL domains of a candidate at once.
    Each domain is validated and upserted independently.
    Returns list of saved evaluation records.
    """
    svc = get_service_client()
    saved = []
    errors = []

    for ev in body.evaluations:
        # Validate candidate matches
        if str(ev.candidate_id) != str(body.candidate_id):
            errors.append({"domain_id": str(ev.domain_id), "error": "candidate_id mismatch"})
            continue

        scores = dict(ev.scores or {})
        if ev.overall_rating is not None:
            scores["overall_rating"] = float(ev.overall_rating)
        if ev.final_general_remarks:
            scores["final_general_remarks"] = ev.final_general_remarks

        total = 0.0
        valid = True
        if "overall_rating" in scores:
            try:
                total = float(scores.get("overall_rating", 0))
            except Exception:
                errors.append({"domain_id": str(ev.domain_id), "error": "overall_rating must be numeric"})
                valid = False
            if total < 0 or total > 10:
                errors.append({"domain_id": str(ev.domain_id), "error": "overall_rating must be between 0 and 10"})
                valid = False
        else:
            criteria_res = svc.table("criteria").select("*").eq("domain_id", str(ev.domain_id)).execute()
            criteria_map = {str(c["id"]): c["max_score"] for c in (criteria_res.data or [])}

            for cid, score in scores.items():
                max_s = criteria_map.get(cid)
                if max_s is None:
                    errors.append({"domain_id": str(ev.domain_id), "error": f"Unknown criteria {cid}"})
                    valid = False
                    break
                if score < 0 or score > max_s:
                    errors.append({"domain_id": str(ev.domain_id), "error": f"Score {score} out of range for {cid}"})
                    valid = False
                    break
                total += score

        if not valid:
            continue

        data = {
            "candidate_id": str(body.candidate_id),
            "domain_id": str(ev.domain_id),
            "admin_id": user["id"],
            "round_number": ev.round_number,
            "scores": scores,
            "total_score": total,
            "remarks": ev.remarks,
        }
        res = svc.table("evaluations").upsert(
            data,
            on_conflict="candidate_id,domain_id,admin_id"
        ).execute()
        if res.data:
            saved.append(res.data[0])

    return {"saved": len(saved), "errors": errors, "evaluations": saved}


@router.get("/candidate/{candidate_id}")
async def get_candidate_evaluations(candidate_id: str, _=Depends(require_admin_or_superadmin)):
    """All evaluations for a candidate, grouped with evaluator name."""
    svc = get_service_client()
    res = svc.table("evaluations").select(
        "*, users(id, full_name, email), domains(id, name)"
    ).eq("candidate_id", candidate_id).order("domain_id").order("updated_at", desc=True).execute()
    return res.data or []


@router.patch("/{eval_id}", response_model=EvaluationOut)
async def update_evaluation(eval_id: str, body: EvaluationUpdate, user=Depends(require_admin_or_superadmin)):
    svc = get_service_client()

    existing = svc.table("evaluations").select("*").eq("id", eval_id).single().execute()
    if not existing.data:
        raise HTTPException(404, "Evaluation not found")
    if existing.data["admin_id"] != user["id"] and user["role"] != "superadmin":
        raise HTTPException(403, "Cannot edit another admin's evaluation")

    update_data = {}
    if body.scores is not None or body.overall_rating is not None or body.final_general_remarks is not None:
        scores = dict(existing.data.get("scores") or {})
        if body.scores is not None:
            scores = dict(body.scores)
        if body.overall_rating is not None:
            scores["overall_rating"] = float(body.overall_rating)
        if body.final_general_remarks is not None:
            scores["final_general_remarks"] = body.final_general_remarks
        total = float(scores.get("overall_rating", sum(v for v in scores.values() if isinstance(v, (int, float)))))
        update_data["scores"] = scores
        update_data["total_score"] = total
    if body.remarks is not None:
        update_data["remarks"] = body.remarks

    if not update_data:
        raise HTTPException(400, "Nothing to update")

    res = svc.table("evaluations").update(update_data).eq("id", eval_id).execute()
    return res.data[0]
