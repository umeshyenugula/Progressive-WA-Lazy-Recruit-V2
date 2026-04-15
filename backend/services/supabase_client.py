"""Supabase client singleton."""
from supabase import create_client, Client
from config import settings

_service_client: Client | None = None
_anon_client: Client | None = None


def init_supabase():
    global _service_client, _anon_client
    _service_client = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_KEY)
    _anon_client = create_client(settings.SUPABASE_URL, settings.SUPABASE_ANON_KEY)


def get_service_client() -> Client:
    if _service_client is None:
        raise RuntimeError("Supabase not initialised. Call init_supabase() first.")
    return _service_client


def get_anon_client() -> Client:
    if _anon_client is None:
        raise RuntimeError("Supabase not initialised.")
    return _anon_client
