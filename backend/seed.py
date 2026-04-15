"""
seed_superadmin.py — Create the Super Admin user in Supabase Auth + public.users

Usage:
    python seed_superadmin.py

Set these in your .env (or export them) before running:
    SUPABASE_URL=https://your-project.supabase.co
    SUPABASE_SERVICE_KEY=your-service-role-key
"""

import os
import sys
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL", "").strip()
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY", "").strip()

# ── Superadmin credentials — change before running ────────────
SUPERADMIN_EMAIL    = "mgmt@csi.griet.ac.in"
SUPERADMIN_PASSWORD = "CSI@GRIET1997"   # min 6 chars
SUPERADMIN_NAME     = "Super Admin"
# ─────────────────────────────────────────────────────────────


def check_env():
    missing = []
    if not SUPABASE_URL:
        missing.append("SUPABASE_URL")
    if not SUPABASE_SERVICE_KEY:
        missing.append("SUPABASE_SERVICE_KEY")
    if missing:
        print(f"[ERROR] Missing environment variables: {', '.join(missing)}")
        print("        Copy backend/.env.example → .env and fill in the values.")
        sys.exit(1)


def seed():
    check_env()

    try:
        from supabase import create_client
    except ImportError:
        print("[ERROR] supabase-py not installed. Run: pip install supabase")
        sys.exit(1)

    print(f"\n{'='*55}")
    print("  Club Recruitment — Super Admin Seeder")
    print(f"{'='*55}\n")
    print(f"  Supabase URL : {SUPABASE_URL}")
    print(f"  Email        : {SUPERADMIN_EMAIL}")
    print(f"  Name         : {SUPERADMIN_NAME}")
    print()

    svc = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    # ── Step 1: Check if user already exists in public.users ──
    existing = svc.table("users").select("id, email, role").eq("email", SUPERADMIN_EMAIL).execute()
    if existing.data:
        u = existing.data[0]
        print(f"[INFO] Super admin already exists in public.users")
        print(f"       id   : {u['id']}")
        print(f"       email: {u['email']}")
        print(f"       role : {u['role']}")
        print("\n[DONE] Nothing to do.\n")
        return

    # ── Step 2: Create auth user via admin API ─────────────────
    print("[1/3] Creating Supabase Auth user…")
    try:
        auth_resp = svc.auth.admin.create_user({
            "email": SUPERADMIN_EMAIL,
            "password": SUPERADMIN_PASSWORD,
            "email_confirm": True,       # skip email confirmation
            "user_metadata": {"full_name": SUPERADMIN_NAME},
        })
        user_id = auth_resp.user.id
        print(f"      ✓ Auth user created — id: {user_id}")
    except Exception as e:
        err_msg = str(e)

        # If auth user already exists, fetch their id and continue
        if "already" in err_msg.lower() or "exists" in err_msg.lower():
            print(f"      ↳ Auth user already exists. Fetching id…")
            try:
                page = svc.auth.admin.list_users()
                match = next((u for u in page if u.email == SUPERADMIN_EMAIL), None)
                if not match:
                    print("[ERROR] Could not find existing auth user by email.")
                    sys.exit(1)
                user_id = match.id
                print(f"      ✓ Found existing auth user — id: {user_id}")
            except Exception as e2:
                print(f"[ERROR] Could not list auth users: {e2}")
                sys.exit(1)
        else:
            print(f"[ERROR] Failed to create auth user: {e}")
            sys.exit(1)

    # ── Step 3: Insert into public.users ───────────────────────
    print("[2/3] Inserting into public.users…")
    try:
        insert_resp = svc.table("users").insert({
            "id":        user_id,
            "email":     SUPERADMIN_EMAIL,
            "full_name": SUPERADMIN_NAME,
            "role":      "superadmin",
            "is_active": True,
        }).execute()

        if not insert_resp.data:
            print("[ERROR] Insert returned no data. Check RLS policies.")
            sys.exit(1)

        print(f"      ✓ public.users row created")
    except Exception as e:
        err_msg = str(e)
        if "duplicate" in err_msg.lower() or "unique" in err_msg.lower():
            print(f"      ↳ Row already exists in public.users (skipped)")
        else:
            print(f"[ERROR] Failed to insert into public.users: {e}")
            sys.exit(1)

    # ── Step 4: Verify ─────────────────────────────────────────
    print("[3/3] Verifying…")
    verify = svc.table("users").select("*").eq("id", user_id).single().execute()
    if verify.data:
        u = verify.data
        print(f"      ✓ Verified — id: {u['id']}, role: {u['role']}, active: {u['is_active']}")
    else:
        print("[WARN] Could not verify — check Supabase dashboard manually")

    # ── Summary ────────────────────────────────────────────────
    print(f"\n{'='*55}")
    print("  ✅  Super Admin seeded successfully!")
    print(f"{'='*55}")
    print(f"  Email    : {SUPERADMIN_EMAIL}")
    print(f"  Password : {SUPERADMIN_PASSWORD}")
    print(f"  Role     : superadmin")
    print(f"\n  → Open your frontend and log in with these credentials.")
    print(f"{'='*55}\n")


if __name__ == "__main__":
    seed()