# Club Recruitment Management System

A full-stack web application for managing club recruitment, built with **FastAPI**, **Supabase**, and **Vanilla JS**.

---

## Tech Stack

| Layer     | Technology                          |
|-----------|-------------------------------------|
| Frontend  | HTML5, CSS3, Vanilla JavaScript     |
| Backend   | FastAPI (Python 3.11+)              |
| Database  | Supabase (PostgreSQL + RLS)         |
| Auth      | Supabase Auth + JWT                 |
| Excel     | openpyxl + pandas                   |

---

## Project Structure

```
club-recruitment/
├── supabase_schema.sql          # Run this in Supabase SQL Editor
├── backend/
│   ├── main.py                  # FastAPI app entry point
│   ├── config.py                # Settings / env vars
│   ├── requirements.txt
│   ├── .env.example             # Copy to .env and fill in values
│   ├── routers/
│   │   ├── auth.py              # Login / logout
│   │   ├── candidates.py        # Candidate CRUD, assign, export
│   │   ├── evaluations.py       # Submit / update evaluations
│   │   ├── admins.py            # Admin management (superadmin only)
│   │   ├── domains.py           # Domain & criteria management
│   │   └── upload.py            # Excel parsing & bulk import
│   ├── models/
│   │   └── schemas.py           # Pydantic request/response models
│   └── services/
│       ├── supabase_client.py   # Supabase client singleton
│       ├── auth_service.py      # JWT decode + role guards
│       └── excel_parser.py      # Excel → candidate records
└── frontend/
    ├── index.html               # Login page
    ├── css/
    │   ├── main.css             # Design system, layout, components
    │   ├── tables.css           # Table & pagination styles
    │   └── login.css            # Login page styles
    ├── js/
    │   ├── api.js               # Fetch wrapper + API modules
    │   ├── utils.js             # Toast, DOM helpers, pagination
    │   └── sidebar.js           # Dynamic sidebar renderer
    ├── superadmin/
    │   ├── dashboard.html       # Stats overview + Excel upload
    │   ├── candidates.html      # Full candidate table + bulk actions
    │   ├── admins.html          # Create & manage admins
    │   └── domains.html         # Domains + criteria management
    └── admin/
        ├── dashboard.html       # Domain overview + my progress
        └── candidates.html      # Evaluate assigned candidates
```

---

## Setup Instructions

### 1. Supabase Setup

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** → paste and run `supabase_schema.sql`
3. In **Authentication → Settings**, configure your site URL
4. Create the first **Super Admin** user:
   - Go to **Authentication → Users** → Invite user (e.g. `superadmin@club.com`)
   - After user is created, note the UUID
   - Run in SQL Editor:
     ```sql
     INSERT INTO public.users (id, email, full_name, role)
     VALUES ('PASTE-UUID-HERE', 'superadmin@club.com', 'Super Admin', 'superadmin');
     ```
5. Collect from **Settings → API**:
   - `Project URL`
   - `anon` key
   - `service_role` key
   - `JWT Secret` (from **Settings → API → JWT Settings**)

### 2. Backend Setup

```bash
cd backend
cp .env.example .env
# Edit .env with your Supabase credentials
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

The API will be available at `http://localhost:8000`  
Interactive docs: `http://localhost:8000/docs`

### 3. Frontend Setup

Serve the `frontend/` directory with any static server:

```bash
# Using Python
cd frontend
python -m http.server 5500

# Using VS Code Live Server (recommended)
# Right-click index.html → Open with Live Server
```

Open `http://localhost:5500` in your browser.

> **Note:** Make sure `CORS_ORIGINS` in `.env` includes your frontend URL.

---

## Usage Guide

### Super Admin Workflow

1. **Login** at `index.html` with superadmin credentials
2. **Create Domains** → `Domains & Criteria` page → Add domains (e.g. "Web Dev", "AI/ML")
3. **Add Criteria** → Under each domain, add evaluation criteria (e.g. "Technical", "Communication", max score 10)
4. **Create Admins** → `Admins` page → Add admin users and assign them to domains
5. **Upload Candidates** → Dashboard → Upload Excel button
6. **Assign Candidates** → `Candidates` page → Select candidates → Assign to Domain
7. **Review Results** → View all evaluations and marks given by admins
8. **Shortlist/Select** → Bulk-select candidates → Mark as Shortlisted / Selected
9. **Export** → Download shortlisted candidates as Excel

### Admin Workflow

1. **Login** with admin credentials (created by Super Admin)
2. **Dashboard** shows your domain's candidates and evaluation criteria
3. **Candidates** page → browse, search, filter your assigned candidates
4. Click **Evaluate** on any candidate → fill in scores per criteria + remarks
5. Scores are saved and visible to super admin immediately

---

## Excel File Format

Upload `.xlsx` files with these column headers (case-insensitive):

| Column | Required | Notes |
|--------|----------|-------|
| Name | ✅ | Full name |
| Email | ✅ | Must be unique |
| Phone | | Mobile number |
| Roll Number | | Student roll no |
| Branch | | e.g. CSE, ECE |
| Section | | e.g. A, B |
| Year | | e.g. 2nd Year |
| Interested Domains | | Comma-separated: "Web Dev, AI/ML" |
| Skills | | Technologies, tools |
| Experience | | Projects, internships |

Any extra columns are stored in `extra_data` (JSONB field).

---

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/auth/login` | Public | Login |
| GET | `/api/candidates/` | Admin+ | List candidates |
| PATCH | `/api/candidates/{id}` | Super Admin | Update candidate |
| POST | `/api/candidates/assign` | Super Admin | Assign to domain |
| POST | `/api/candidates/bulk-status` | Super Admin | Bulk status update |
| GET | `/api/candidates/export/shortlisted` | Super Admin | Download Excel |
| POST | `/api/evaluations/` | Admin+ | Submit evaluation |
| PATCH | `/api/evaluations/{id}` | Admin+ | Update evaluation |
| GET | `/api/admins/` | Super Admin | List admins |
| POST | `/api/admins/` | Super Admin | Create admin |
| GET | `/api/domains/` | Admin+ | List domains |
| POST | `/api/domains/criteria` | Super Admin | Add criteria |
| POST | `/api/upload/excel` | Super Admin | Upload & parse Excel |

Full interactive docs: `http://localhost:8000/docs`
