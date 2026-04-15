"""
Auto-Shortlisting Engine
========================
Strategy: Per-Domain Normalized Score Shortlisting

Why normalization?
  Each domain has different criteria with different max_scores.
  Comparing raw totals across domains is unfair.
  Normalization converts every candidate's score to a 0-100 % scale
  so the threshold is domain-agnostic.

Key constraint honoured:
  One candidate is evaluated by exactly ONE admin per domain
  (UNIQUE candidate_id, domain_id, admin_id in evaluations table).
  So per (candidate, domain) there is at most one score row — no
  averaging across multiple admins needed.

Algorithm (per domain):
  1. sum all criteria.max_score  → domain_max_possible
  2. normalized = (total_score / domain_max_possible) × 100
  3. rank by normalized DESC
  4. shortlist: score ≥ threshold  OR  top-N (whichever mode is chosen)

Final shortlist = union of candidates qualifying in ANY domain.
"""

from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
import secrets
import string
from services.auth_service import require_superadmin
from services.supabase_client import get_service_client

router = APIRouter()


def _generate_password(length: int = 12) -> str:
    """Generate a secure random password for new candidate accounts."""
    alphabet = string.ascii_letters + string.digits + "!@#$%"
    return ''.join(secrets.choice(alphabet) for _ in range(length))


@router.post("/auto")
async def auto_shortlist(
    threshold: float = Query(
        60.0,
        ge=0, le=100,
        description="Min normalized score (0–100 %) to shortlist. Used when top_n is not set.",
    ),
    top_n: Optional[int] = Query(
        None,
        ge=1,
        description="If set, shortlist the top-N candidates per domain instead of using threshold.",
    ),
    dry_run: bool = Query(
        False,
        description="Preview results without writing to the database.",
    ),
    create_accounts: bool = Query(
        False,
        description="When True (and dry_run=False), create Supabase Auth login accounts for shortlisted candidates.",
    ),
    _=Depends(require_superadmin),
):
    """
    Auto-shortlist candidates using normalized per-domain scores.

    - **threshold** (default 60): candidates scoring ≥ threshold % are shortlisted.
    - **top_n**: override threshold — take best N per domain.
    - **dry_run**: returns the preview without changing any status.
    - **create_accounts**: (Apply only) create login accounts for shortlisted candidates.

    Returns a breakdown per domain and the final shortlisted candidate IDs.
    """
    svc = get_service_client()

    # ── 1. Build domain max-possible scores from criteria ────────────
    criteria_res = svc.table("criteria").select("domain_id, max_score").execute()
    domain_max: dict[str, float] = {}
    for c in (criteria_res.data or []):
        did = c["domain_id"]
        domain_max[did] = domain_max.get(did, 0.0) + float(c["max_score"])

    if not domain_max:
        raise HTTPException(
            status_code=400,
            detail="No criteria found. Please set up domain criteria before running auto-shortlist.",
        )

    # ── 2. Fetch all evaluations (one row per candidate–domain pair) ─
    evals_res = svc.table("evaluations").select(
        "candidate_id, domain_id, total_score, admin_id"
    ).execute()
    all_evals = evals_res.data or []

    if not all_evals:
        return {
            "message": "No evaluations found yet.",
            "shortlisted_count": 0,
            "dry_run": dry_run,
            "by_domain": [],
            "candidate_ids": [],
            "accounts_created": 0,
        }

    # ── 3. Fetch domain names for readable output ────────────────────
    domains_res = svc.table("domains").select("id, name").execute()
    domain_names: dict[str, str] = {
        d["id"]: d["name"] for d in (domains_res.data or [])
    }

    # ── 4. Group evaluations by domain ──────────────────────────────
    by_domain: dict[str, list[dict]] = {}
    for ev in all_evals:
        by_domain.setdefault(ev["domain_id"], []).append(ev)

    # ── 5. Per-domain shortlisting ───────────────────────────────────
    shortlisted_ids: set[str] = set()
    domain_reports: list[dict] = []

    for domain_id, evals in by_domain.items():
        max_possible = domain_max.get(domain_id)

        if not max_possible or max_possible <= 0:
            domain_reports.append({
                "domain_id": domain_id,
                "domain_name": domain_names.get(domain_id, "Unknown"),
                "skipped": True,
                "reason": "No criteria configured for this domain.",
                "total_evaluated": len(evals),
                "shortlisted_count": 0,
                "candidates": [],
            })
            continue

        scored = []
        for ev in evals:
            raw = float(ev["total_score"] or 0)
            norm = round((raw / max_possible) * 100, 2)
            scored.append({
                "candidate_id": ev["candidate_id"],
                "raw_score": raw,
                "max_possible": max_possible,
                "normalized_pct": norm,
            })

        scored.sort(key=lambda x: x["normalized_pct"], reverse=True)

        if top_n is not None:
            selected = scored[:top_n]
        else:
            selected = [s for s in scored if s["normalized_pct"] >= threshold]

        for s in selected:
            shortlisted_ids.add(s["candidate_id"])

        domain_reports.append({
            "domain_id": domain_id,
            "domain_name": domain_names.get(domain_id, "Unknown"),
            "skipped": False,
            "max_possible_score": max_possible,
            "mode": f"top_{top_n}" if top_n else f"threshold_{threshold}%",
            "total_evaluated": len(scored),
            "shortlisted_count": len(selected),
            "candidates": [
                {
                    "candidate_id": s["candidate_id"],
                    "raw_score": s["raw_score"],
                    "max_possible": s["max_possible"],
                    "normalized_pct": s["normalized_pct"],
                    "shortlisted": s in selected,
                }
                for s in scored
            ],
        })

    # ── 6. Commit if not a dry run ───────────────────────────────────
    written = 0
    accounts_created = 0
    accounts_skipped = 0
    account_errors: list[dict] = []

    if not dry_run and shortlisted_ids:
        # Update candidate statuses
        svc.table("candidates").update({"status": "shortlisted"}).in_(
            "id", list(shortlisted_ids)
        ).execute()
        written = len(shortlisted_ids)

        # ── 7. Optionally create login accounts ──────────────────────
        if create_accounts:
            # Fetch candidate emails for account creation
            cands_res = svc.table("candidates").select("id, name, email").in_(
                "id", list(shortlisted_ids)
            ).execute()
            candidates_to_process = cands_res.data or []

            # Get existing auth users to avoid duplicate creation
            existing_users_res = svc.table("users").select("id, email").in_(
                "id", list(shortlisted_ids)
            ).execute()
            existing_user_ids = {u["id"] for u in (existing_users_res.data or [])}

            for cand in candidates_to_process:
                cand_id = cand["id"]
                email = cand.get("email", "")
                name = cand.get("name", "Candidate")

                if not email:
                    account_errors.append({"candidate_id": cand_id, "reason": "No email on record"})
                    continue

                # Skip if already has a login account
                if cand_id in existing_user_ids:
                    accounts_skipped += 1
                    continue

                temp_password = _generate_password()
                try:
                    auth_res = svc.auth.admin.create_user({
                        "email": email,
                        "password": temp_password,
                        "email_confirm": True,
                        "user_metadata": {"full_name": name, "role": "candidate"},
                    })
                    created_id = auth_res.user.id

                    # Insert into public.users so they can log in
                    svc.table("users").insert({
                        "id": created_id,
                        "email": email,
                        "full_name": name,
                        "role": "candidate",
                        "is_active": True,
                    }).execute()

                    accounts_created += 1
                except Exception as e:
                    err_str = str(e)
                    # User already exists in Supabase Auth — that's fine, just skip
                    if "already been registered" in err_str or "already exists" in err_str:
                        accounts_skipped += 1
                    else:
                        account_errors.append({"candidate_id": cand_id, "email": email, "reason": err_str})

    return {
        "dry_run": dry_run,
        "mode": f"top_{top_n}_per_domain" if top_n else f"threshold_{threshold}_pct",
        "shortlisted_count": len(shortlisted_ids),
        "written_to_db": written,
        "by_domain": domain_reports,
        "candidate_ids": list(shortlisted_ids),
        "accounts_created": accounts_created,
        "accounts_skipped": accounts_skipped,
        "account_errors": account_errors,
    }


@router.get("/preview")
async def preview_shortlist(
    threshold: float = Query(60.0, ge=0, le=100),
    top_n: Optional[int] = Query(None, ge=1),
    _=Depends(require_superadmin),
):
    """
    Same as POST /auto?dry_run=true — but a GET for easy frontend polling.
    Returns a preview without modifying any data.
    """
    svc = get_service_client()

    criteria_res = svc.table("criteria").select("domain_id, max_score").execute()
    domain_max: dict[str, float] = {}
    for c in (criteria_res.data or []):
        did = c["domain_id"]
        domain_max[did] = domain_max.get(did, 0.0) + float(c["max_score"])

    evals_res = svc.table("evaluations").select(
        "candidate_id, domain_id, total_score"
    ).execute()
    all_evals = evals_res.data or []

    domains_res = svc.table("domains").select("id, name").execute()
    domain_names: dict[str, str] = {
        d["id"]: d["name"] for d in (domains_res.data or [])
    }

    cands_res = svc.table("candidates").select("id, name, email, status").execute()
    cand_info: dict[str, dict] = {
        c["id"]: c for c in (cands_res.data or [])
    }

    by_domain: dict[str, list[dict]] = {}
    for ev in all_evals:
        by_domain.setdefault(ev["domain_id"], []).append(ev)

    shortlisted_ids: set[str] = set()
    domain_summaries = []

    for domain_id, evals in by_domain.items():
        max_possible = domain_max.get(domain_id) or 0
        if max_possible <= 0:
            continue

        scored = sorted(
            [
                {
                    "candidate_id": ev["candidate_id"],
                    "name": cand_info.get(ev["candidate_id"], {}).get("name", "Unknown"),
                    "email": cand_info.get(ev["candidate_id"], {}).get("email", ""),
                    "current_status": cand_info.get(ev["candidate_id"], {}).get("status", "pending"),
                    "raw_score": float(ev["total_score"] or 0),
                    "normalized_pct": round(
                        (float(ev["total_score"] or 0) / max_possible) * 100, 2
                    ),
                }
                for ev in evals
            ],
            key=lambda x: x["normalized_pct"],
            reverse=True,
        )

        if top_n is not None:
            selected = scored[:top_n]
        else:
            selected = [s for s in scored if s["normalized_pct"] >= threshold]

        for s in selected:
            shortlisted_ids.add(s["candidate_id"])

        domain_summaries.append({
            "domain_name": domain_names.get(domain_id, "Unknown"),
            "max_possible_score": max_possible,
            "total_evaluated": len(scored),
            "will_shortlist": len(selected),
            "ranked_candidates": [
                {**s, "will_shortlist": s in selected}
                for s in scored
            ],
        })

    return {
        "mode": f"top_{top_n}_per_domain" if top_n else f"threshold_{threshold}_pct",
        "total_will_shortlist": len(shortlisted_ids),
        "by_domain": domain_summaries,
    }
