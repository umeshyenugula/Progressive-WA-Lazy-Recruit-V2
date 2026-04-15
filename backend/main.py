"""
Club Recruitment Management System - FastAPI Backend
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from routers import auth, candidates, evaluations, admins, domains, upload, shortlist, sync
from services.supabase_client import init_supabase
from config import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_supabase()
    yield


app = FastAPI(
    title="Club Recruitment API",
    version="1.0.0",
    description="REST API for Club Recruitment Management System",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router,       prefix="/api/auth",       tags=["Auth"])
app.include_router(candidates.router, prefix="/api/candidates", tags=["Candidates"])
app.include_router(evaluations.router,prefix="/api/evaluations",tags=["Evaluations"])
app.include_router(admins.router,     prefix="/api/admins",     tags=["Admins"])
app.include_router(domains.router,    prefix="/api/domains",    tags=["Domains"])
app.include_router(upload.router,     prefix="/api/upload",     tags=["Upload"])
app.include_router(shortlist.router,  prefix="/api/shortlist",  tags=["Shortlist"])
app.include_router(sync.router,       prefix="/api/sync",       tags=["Sync"])


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "Club Recruitment API"}
