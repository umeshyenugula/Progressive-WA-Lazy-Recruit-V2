"""Parse uploaded Excel files into candidate records."""
import pandas as pd
import io
import re
import math
from typing import List, Dict, Any

# Known header aliases after normalization (spaces/punctuation ignored)
ALIAS_MAP = {
    "name": "name",
    "fullname": "name",
    "studentname": "name",
    "candidatename": "name",
    "email": "email",
    "emailaddress": "email",
    "mail": "email",
    "phonenumber": "phone",
    "phone": "phone",
    "mobile": "phone",
    "mobilenumber": "phone",
    "contact": "phone",
    "contactnumber": "phone",
    "rollnumber": "roll_number",
    "rollno": "roll_number",
    "rollnum": "roll_number",
    "registrationnumber": "roll_number",
    "regno": "roll_number",
    "branch": "branch",
    "department": "branch",
    "dept": "branch",
    "section": "section",
    "sec": "section",
    "year": "year",
    "academicyear": "year",
    "batch": "year",
    "interesteddomains": "domains",
    "domain": "domains",
    "domains": "domains",
    "domainpreference": "domains",
    "skills": "skills",
    "skill": "skills",
    "technicalskills": "skills",
    "experience": "experience",
    "workexperience": "experience",
    "relevantskillsorexperience": "experience",
    "exp": "experience",
}

CORE_FIELDS = {"name", "email", "phone", "roll_number", "branch", "section", "year", "skills", "experience", "domains"}


def parse_excel(file_bytes: bytes) -> List[Dict[str, Any]]:
    df = pd.read_excel(io.BytesIO(file_bytes), dtype=str)
    df.columns = [str(c).strip() for c in df.columns]
    df = df.dropna(how="all")

    # Map columns
    col_rename = {}
    for col in df.columns:
        canonical = _canonical_column(col)
        if canonical:
            col_rename[col] = canonical

    df = df.rename(columns=col_rename)

    records = []
    for _, row in df.iterrows():
        raw_row = row.where(pd.notna(row), None).to_dict()

        candidate = {
            "name": "",
            "email": "",
            "phone": "",
            "roll_number": "",
            "branch": "",
            "section": "",
            "year": "",
            "skills": "",
            "experience": "",
            "domains": [],
            "extra_data": {},
        }

        for original_col, raw_val in raw_row.items():
            cleaned = _clean_cell(raw_val)
            canonical = _canonical_column(original_col)

            if canonical is None:
                if cleaned is not None:
                    candidate["extra_data"][original_col] = cleaned
                continue

            if canonical == "domains":
                candidate["domains"].extend(_split_domains(cleaned))
                continue

            if canonical == "email":
                if cleaned and not candidate["email"]:
                    candidate["email"] = cleaned.lower()
                continue

            if canonical in ("skills", "experience"):
                if not cleaned:
                    continue
                if not candidate[canonical]:
                    candidate[canonical] = cleaned
                elif cleaned.lower() not in candidate[canonical].lower():
                    candidate[canonical] = f"{candidate[canonical]} | {cleaned}"
                continue

            if canonical in candidate and cleaned and not candidate[canonical]:
                candidate[canonical] = cleaned

        candidate["domains"] = _unique_ci(candidate["domains"])

        if candidate["name"] and candidate["email"]:
            records.append(candidate)

    return records


def _split_domains(value) -> List[str]:
    if not value:
        return []
    text = str(value).replace("\r", "\n")
    parts = re.split(r"[,;/|\n]+|\band\b|&", text, flags=re.IGNORECASE)
    return [d.strip() for d in parts if d and d.strip()]


def _clean_cell(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    s = str(value).strip()
    if not s or s.lower() in ("nan", "none", "null", "n/a", "na"):
        return None
    return s


def _unique_ci(values: List[str]) -> List[str]:
    seen = set()
    out = []
    for value in values:
        key = value.strip().lower()
        if key and key not in seen:
            seen.add(key)
            out.append(value.strip())
    return out


def _normalize_header(value: str) -> str:
    """Normalize column header for fuzzy alias matching."""
    return re.sub(r"[^a-z0-9]", "", str(value).strip().lower())


def _canonical_column(column_name: str) -> str | None:
    normalized = _normalize_header(column_name)
    if not normalized:
        return None

    direct = ALIAS_MAP.get(normalized)
    if direct:
        return direct

    # Heuristic fallback for uncommon variants.
    if "email" in normalized or normalized.endswith("mail"):
        return "email"
    if any(k in normalized for k in ("phone", "mobile", "contact")):
        return "phone"
    if "roll" in normalized and any(k in normalized for k in ("no", "num", "number", "id", "reg")):
        return "roll_number"
    if "domain" in normalized:
        return "domains"
    if "skill" in normalized:
        return "skills"
    if "experien" in normalized or normalized == "exp":
        return "experience"
    if "depart" in normalized or normalized in ("branch", "dept"):
        return "branch"
    if "section" in normalized or normalized == "sec":
        return "section"
    if "year" in normalized or "batch" in normalized:
        return "year"
    if "name" in normalized:
        return "name"

    return None
