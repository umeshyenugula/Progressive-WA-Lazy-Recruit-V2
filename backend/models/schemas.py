"""Pydantic models for request/response validation."""
from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List, Dict, Any
from uuid import UUID
from datetime import datetime


# ── Auth ─────────────────────────────────────────────────────
class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: Dict[str, Any]


# ── Domain ───────────────────────────────────────────────────
class DomainCreate(BaseModel):
    name: str
    description: Optional[str] = None
    admin_ids: Optional[List[UUID]] = []   # multiple admins


class DomainUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    admin_ids: Optional[List[UUID]] = None  # replace admin list if provided


class DomainOut(BaseModel):
    id: UUID
    name: str
    description: Optional[str]
    created_at: datetime


# ── Criteria ─────────────────────────────────────────────────
class CriteriaCreate(BaseModel):
    domain_id: UUID
    name: str
    max_score: int = Field(default=10, ge=1, le=100)


class CriteriaOut(BaseModel):
    id: UUID
    domain_id: UUID
    name: str
    max_score: int
    created_at: datetime


# ── Admin (user) ─────────────────────────────────────────────
class AdminCreate(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    full_name: str
    domain_ids: Optional[List[UUID]] = []   # assign to multiple domains


class AdminOut(BaseModel):
    id: UUID
    email: str
    full_name: Optional[str]
    role: str
    is_active: bool
    created_at: datetime


class DomainAdminAssign(BaseModel):
    """Assign/remove admins for a domain."""
    domain_id: Optional[UUID] = None
    admin_ids: List[UUID] = Field(default_factory=list)


# ── Candidate ────────────────────────────────────────────────
class CandidateCreate(BaseModel):
    name: str
    email: EmailStr
    phone: Optional[str] = None
    roll_number: Optional[str] = None
    branch: Optional[str] = None
    section: Optional[str] = None
    year: Optional[str] = None
    skills: Optional[str] = None
    experience: Optional[str] = None
    extra_data: Optional[Dict[str, Any]] = {}
    domain_ids: Optional[List[UUID]] = []   # auto-assign to these domains


class CandidateUpdate(BaseModel):
    status: Optional[str] = None
    skills: Optional[str] = None
    experience: Optional[str] = None
    name: Optional[str] = None
    phone: Optional[str] = None
    branch: Optional[str] = None
    section: Optional[str] = None
    year: Optional[str] = None


class CandidateOut(BaseModel):
    id: UUID
    name: str
    email: str
    phone: Optional[str]
    roll_number: Optional[str]
    branch: Optional[str]
    section: Optional[str]
    year: Optional[str]
    skills: Optional[str]
    experience: Optional[str]
    status: str
    extra_data: Optional[Dict[str, Any]]
    created_by: Optional[UUID]
    created_at: datetime


# ── Evaluation ───────────────────────────────────────────────
class EvaluationCreate(BaseModel):
    candidate_id: UUID
    domain_id: UUID
    round_number: int = 1
    scores: Dict[str, float] = Field(default_factory=dict)   # { criteria_id: score } or { overall_rating: score }
    overall_rating: Optional[float] = None
    remarks: Optional[str] = None
    final_general_remarks: Optional[str] = None


class EvaluationUpdate(BaseModel):
    scores: Optional[Dict[str, float]] = None
    overall_rating: Optional[float] = None
    remarks: Optional[str] = None
    final_general_remarks: Optional[str] = None


class EvaluationOut(BaseModel):
    id: UUID
    candidate_id: UUID
    domain_id: UUID
    admin_id: UUID
    round_number: int
    scores: Dict[str, Any]
    total_score: float
    remarks: Optional[str]
    created_at: datetime
    updated_at: datetime


# ── Assignment ───────────────────────────────────────────────
class AssignCandidates(BaseModel):
    candidate_ids: List[UUID]
    domain_id: UUID


# ── Status Bulk Update ───────────────────────────────────────
class BulkStatusUpdate(BaseModel):
    candidate_ids: List[UUID]
    status: str = Field(..., pattern="^(pending|shortlisted|selected|rejected)$")


# ── Offline Sync ─────────────────────────────────────────────
class SyncCandidateRecord(BaseModel):
    id: UUID | str
    name: str
    email: str
    phone: Optional[str] = None
    roll_number: Optional[str] = None
    branch: Optional[str] = None
    section: Optional[str] = None
    year: Optional[str] = None
    skills: Optional[str] = None
    experience: Optional[str] = None
    status: str = Field(default="pending", pattern="^(pending|shortlisted|selected|rejected)$")
    extra_data: Optional[Dict[str, Any]] = Field(default_factory=dict)
    created_by: Optional[UUID | str] = None
    updated_at: datetime | str
    candidate_domains: List[UUID | str] = Field(default_factory=list)


class SyncEvaluationRecord(BaseModel):
    id: UUID | str
    candidate_id: UUID | str
    domain_id: UUID | str
    admin_id: UUID | str
    round_number: int = 1
    scores: Dict[str, Any] = Field(default_factory=dict)
    total_score: float = 0
    remarks: Optional[str] = None
    updated_at: datetime | str


class SyncUploadRequest(BaseModel):
    participants: List[Dict[str, Any]] = Field(default_factory=list)
    evaluations: List[Dict[str, Any]] = Field(default_factory=list)
