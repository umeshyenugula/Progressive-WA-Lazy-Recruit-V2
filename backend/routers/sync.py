"""Offline sync endpoints for participant/evaluation upserts with conflict checks."""
from datetime import datetime
from fastapi import APIRouter, Depends
from models.schemas import SyncUploadRequest
from services.auth_service import require_admin_or_superadmin
from services.supabase_client import get_service_client

router = APIRouter()


def _parse_dt(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except Exception:
        return None


def _as_str(value):
    return None if value is None else str(value)


@router.post("/upload")
async def upload_unsynced_records(body: SyncUploadRequest, user=Depends(require_admin_or_superadmin)):
    svc = get_service_client()

    participants_uploaded = 0
    participants_skipped = 0
    participant_skipped_ids = []
    participant_errors = []

    for rec in body.participants:
        try:
            rec_id = rec.get("id")
            if not rec_id or not rec.get("name") or not rec.get("email"):
                participant_errors.append({"id": _as_str(rec_id), "error": "Missing required participant fields"})
                participants_skipped += 1
                if rec_id:
                    participant_skipped_ids.append(str(rec_id))
                continue

            incoming_ts = _parse_dt(rec.get("updated_at"))
            existing = svc.table("candidates").select("id, updated_at").eq("id", str(rec_id)).execute()
            existing_row = (existing.data or [None])[0]
            existing_ts = _parse_dt(existing_row.get("updated_at")) if existing_row else None

            if existing_ts and incoming_ts and existing_ts > incoming_ts:
                participants_skipped += 1
                participant_skipped_ids.append(str(rec_id))
                continue

            payload = {
                "id": str(rec_id),
                "name": rec.get("name"),
                "email": rec.get("email"),
                "phone": rec.get("phone"),
                "roll_number": rec.get("roll_number"),
                "branch": rec.get("branch"),
                "section": rec.get("section"),
                "year": rec.get("year"),
                "skills": rec.get("skills"),
                "experience": rec.get("experience"),
                "status": rec.get("status") or "pending",
                "extra_data": rec.get("extra_data") or {},
                "created_by": str(rec.get("created_by")) if rec.get("created_by") else user["id"],
            }
            existing_candidate = svc.table("candidates").select("id").eq("id", str(rec_id)).execute()
            if existing_candidate.data:
                svc.table("candidates").update(payload).eq("id", str(rec_id)).execute()
            else:
                svc.table("candidates").insert(payload).execute()

            # Replace candidate-domain mapping only when client explicitly sends it.
            # This avoids accidental domain wipe when older payloads omit this field.
            if "candidate_domains" in rec and rec.get("candidate_domains") is not None:
                svc.table("candidate_domains").delete().eq("candidate_id", str(rec_id)).execute()
                cd_rows = [
                    {
                        "candidate_id": str(rec_id),
                        "domain_id": str(did),
                        "assigned_by": user["id"],
                    }
                    for did in (rec.get("candidate_domains") or [])
                    if did
                ]
                if cd_rows:
                    svc.table("candidate_domains").insert(cd_rows).execute()

            participants_uploaded += 1
        except Exception as e:
            participant_errors.append({"id": _as_str(rec.get("id")), "error": str(e)})

    evaluations_uploaded = 0
    evaluations_skipped = 0
    evaluation_skipped_ids = []
    evaluation_errors = []

    for rec in body.evaluations:
        try:
            rec_id = rec.get("id")
            rec_candidate_id = rec.get("candidate_id")
            rec_domain_id = rec.get("domain_id")
            rec_admin_id = rec.get("admin_id")
            if not rec_id or not rec_candidate_id or not rec_domain_id or not rec_admin_id:
                evaluation_errors.append({"id": _as_str(rec_id), "error": "Missing required evaluation fields"})
                evaluations_skipped += 1
                if rec_id:
                    evaluation_skipped_ids.append(str(rec_id))
                continue

            incoming_ts = _parse_dt(rec.get("updated_at"))
            existing = (
                svc.table("evaluations")
                .select("id, updated_at")
                .eq("candidate_id", str(rec_candidate_id))
                .eq("domain_id", str(rec_domain_id))
                .eq("admin_id", str(rec_admin_id))
                .execute()
            )
            existing_row = (existing.data or [None])[0]
            existing_ts = _parse_dt(existing_row.get("updated_at")) if existing_row else None

            if existing_ts and incoming_ts and existing_ts > incoming_ts:
                evaluations_skipped += 1
                evaluation_skipped_ids.append(str(rec_id))
                continue

            payload = {
                "id": str(rec_id),
                "candidate_id": str(rec_candidate_id),
                "domain_id": str(rec_domain_id),
                "admin_id": str(rec_admin_id),
                "round_number": int(rec.get("round_number") or 1),
                "scores": rec.get("scores") or {},
                "total_score": float(rec.get("total_score") or 0),
                "remarks": rec.get("remarks"),
            }
            if rec.get("updated_at"):
                payload["updated_at"] = rec.get("updated_at")

            existing_eval = (
                svc.table("evaluations")
                .select("id")
                .eq("candidate_id", str(rec_candidate_id))
                .eq("domain_id", str(rec_domain_id))
                .eq("admin_id", str(rec_admin_id))
                .execute()
            )

            if existing_eval.data:
                existing_id = existing_eval.data[0].get("id")
                svc.table("evaluations").update(payload).eq("id", existing_id).execute()
            else:
                svc.table("evaluations").insert(payload).execute()

            evaluations_uploaded += 1
        except Exception as e:
            evaluation_errors.append({"id": _as_str(rec.get("id")), "error": str(e)})

    return {
        "participants": {
            "uploaded": participants_uploaded,
            "skipped": participants_skipped,
            "skipped_ids": participant_skipped_ids,
            "errors": participant_errors,
        },
        "evaluations": {
            "uploaded": evaluations_uploaded,
            "skipped": evaluations_skipped,
            "skipped_ids": evaluation_skipped_ids,
            "errors": evaluation_errors,
        },
    }
