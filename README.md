# ParkInsight — Bengaluru Traffic Enforcement Command

AI-driven parking intelligence dashboard. Production-grade prototype over ML notebook outputs, with role-based access, JWT auth, an AI Copilot, and citizen/police/admin workflows.

🌐 **Live Demo:** [https://parkinsight.onrender.com](https://parkinsight.onrender.com) *(replace with your actual Render URL)*

---

## Directory Structure

```
proj/
├── backend/
│   ├── main.py                     ← FastAPI server — all API routes (Auth, Admin, Police, Citizen, Copilot)
│   ├── auth.py                     ← JWT auth (PBKDF2-HMAC-SHA256 passwords, HS256 tokens, role system)
│   ├── copilot.py                  ← AI Copilot (Groq → Gemini → rule-based fallback chain)
│   └── .env                        ← Environment variables (DB, JWT secret, Gemini/Groq API keys)
│
├── data/
│   ├── generate_mock.py            ← Run once to populate all JSON data files with mock data
│   ├── normalize_pipeline_output.py← Converts raw ML outputs → flat JSON schema for the backend
│   ├── hotspots_h3.json            ← H3 clusters with EPS scores, lifecycle, blind spots, AI explanations
│   ├── forecast_risk.json          ← 30-min risk forecast + ghost violation flags
│   ├── officer_deployment.json     ← Optimized patrol routes by vehicle type
│   ├── junctions.json              ← Bengaluru junction metadata
│   ├── complaints.json             ← Citizen-submitted parking complaints
│   ├── citizens.json               ← Citizen profile data
│   ├── users.json                  ← All user accounts (admin, police, citizen) with hashed passwords
│   ├── officers_live.json          ← Live officer location feed
│   ├── sos_queue.json              ← Emergency flags raised by police officers
│   ├── vouchers.json               ← Reward vouchers (Namma Metro, BMTC) for citizens
│   ├── admin_config.json           ← Tunable EPS weights and algorithm thresholds (editable via API)
│   └── raw_pipeline_output/        ← Raw ML model output (input to normalize_pipeline_output.py)
│       ├── hotspots_h3.json
│       ├── forecast_risk.json
│       ├── officer_deployment.json
│       ├── enforcement_effectiveness.csv
│       └── unassigned_cells.csv
│
├── frontend/
│   └── public/
│       ├── index.html              ← Single-file SPA (zero npm, CDN-only: Leaflet, Chart.js, MarkerCluster)
│       ├── logo.png                ← App logo / favicon
│       ├── css/
│       │   ├── base.css            ← Global styles, theme variables, login screen
│       │   ├── map-page.css        ← Admin map dashboard styles
│       │   ├── police-page.css     ← Police officer view styles
│       │   └── citizen-page.css    ← Citizen portal styles
│       └── js/
│           ├── core.js             ← Auth, API client, shared utilities
│           ├── admin-map.js        ← Admin map: H3 hotspot layer, forecast overlay, officer markers
│           ├── admin-cmd.js        ← Admin command panel: SOS queue, config editor, blind-spot export
│           ├── admin-other.js      ← Admin tables: deployment list, police requests, officer management
│           ├── police.js           ← Police view: my route, evidence submission, emergency flag, complaints
│           └── citizen.js          ← Citizen portal: parking check, complaint filing, community feed, vouchers
│
└── requirements.txt                ← Python dependencies
```

---

## Roles & Access

| Role | How to get it | What they can do |
|------|--------------|-----------------|
| **Admin** | Pre-seeded account | Full dashboard, config, SOS queue, officer management, data export |
| **Police** | Self-register → admin approval | View assigned route, submit evidence, raise SOS, manage complaints |
| **Citizen** | Self-register (instant) | Parking check, file complaints, community feed, reward vouchers |
| **Guest** | No account needed | Submit anonymous complaint only |

Default admin credentials (change in production):
- Email: `admin@parkinsight.ai`
- Password: set in `data/users.json` (seeded via `auth.py`)

---

## Quick Start (Local)

### Step 1 — Install backend dependencies
```bash
pip install -r requirements.txt
```

### Step 2 — Configure environment variables
Copy `.env` to `backend/.env` and fill in your keys:
```
PGHOST=...
PGDATABASE=postgres
PGUSER=postgres
PGPASSWORD=...
JWT_SECRET_KEY=your-secret-here
GEMINI_API_KEY=...   # https://aistudio.google.com/apikey (free)
GROQ_API_KEY=...     # https://console.groq.com (free, no credit card)
```

### Step 3 — Generate mock data (first run only)
```bash
python3 data/generate_mock.py
```

> **From your ML notebook:** write normalized outputs directly to:
> - `data/hotspots_h3.json`
> - `data/forecast_risk.json`
> - `data/officer_deployment.json`
>
> Or place raw pipeline output in `data/raw_pipeline_output/` and run:
> ```bash
> cd data && python3 normalize_pipeline_output.py
> ```
> The backend reads these files on each request — no restart needed.

### Step 4 — Start the backend
```bash
# From project root:
uvicorn backend.main:app --reload --port 8000

# Or from inside backend/:
uvicorn main:app --reload --port 8000
```

Dashboard: http://localhost:8000  
Swagger:   http://localhost:8000/docs  
Health:    http://localhost:8000/api/v1/health

### Step 5 (optional) — Frontend hot-reload dev mode
```bash
cd frontend/public
python3 -m http.server 3000
```
Then update `const API = 'http://localhost:8000'` at the top of `core.js`.

---

## API Reference

### Auth
| Method | Endpoint | Description | Access |
|--------|----------|-------------|--------|
| POST | `/api/v1/auth/signup` | Register as citizen | Public |
| POST | `/api/v1/auth/login` | Login (all roles) | Public |
| GET | `/api/v1/auth/me` | Get current user info | Authenticated |
| POST | `/api/v1/auth/police-signup` | Request police account (pending admin approval) | Public |

### Admin
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/dashboard/summary` | KPIs: gridlock cost, blind spots, ghost violations |
| GET | `/api/v1/admin/officers` | List all officers |
| POST | `/api/v1/admin/officers` | Add a new officer account |
| GET | `/api/v1/admin/officers/live` | Live officer location feed |
| POST | `/api/v1/admin/officers/{user_id}/assign-route` | Assign patrol route to officer |
| GET | `/api/v1/admin/police-requests` | Pending police signup requests |
| POST | `/api/v1/admin/police-requests/{user_id}/approve` | Approve police request |
| POST | `/api/v1/admin/police-requests/{user_id}/reject` | Reject police request |
| GET | `/api/v1/admin/config` | View algorithm config (EPS weights, thresholds) |
| POST | `/api/v1/admin/config` | Update algorithm config |
| GET | `/api/v1/admin/sos-queue` | View emergency flags from officers |
| GET | `/api/v1/admin/export/blind-spots` | Export blind-spot hotspots as CSV |
| GET | `/api/v1/admin/unassigned-cells` | H3 cells with no assigned officer |

### Intelligence
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/hotspots` | H3 clusters with EPS scores and AI explanations |
| GET | `/api/v1/forecast` | 30-min risk forecast + ghost violation flags |
| GET | `/api/v1/allocations` | Optimized patrol routes by vehicle type |
| GET | `/api/v1/congestion-zones` | Public rerouting API |
| GET | `/api/v1/junctions` | Junction metadata |

### Police
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/police/my-route` | Officer's assigned patrol route |
| POST | `/api/v1/police/evidence` | Submit evidence (photo/notes for a violation) |
| POST | `/api/v1/police/emergency-flag` | Raise SOS / emergency flag |
| GET | `/api/v1/police/complaints` | View complaints in assigned area |
| PATCH | `/api/v1/police/complaints/{complaint_id}` | Update complaint status |

### Citizen
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/citizen/profile` | View profile + reward vouchers |
| POST | `/api/v1/citizen/complaint` | File a parking complaint (authenticated) |
| POST | `/api/v1/guest/complaint` | File a complaint anonymously |
| GET | `/api/v1/citizen/complaint/{complaint_id}` | Track a complaint |
| POST | `/api/v1/citizen/parking-check` | Check if a location is a hotspot / risky |
| GET | `/api/v1/citizen/community-feed` | Community complaint/activity feed |

### AI Copilot
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/copilot` | Ask the AI Copilot (public, snapshot context) |
| POST | `/api/v1/copilot/authed` | Ask the AI Copilot (authenticated, richer context) |

### Meta
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/health` | Data file status check |

### Query Parameters

```
GET /api/v1/hotspots?min_eps=0.75
GET /api/v1/hotspots?blind_spot_only=true
GET /api/v1/hotspots?lifecycle=Escalating

GET /api/v1/forecast?window_minutes=0
GET /api/v1/forecast?ghost_only=true

GET /api/v1/allocations?vehicle_type=TOWING+TRUCK
GET /api/v1/allocations?priority_only=true

GET /api/v1/congestion-zones?min_delay=10
```

---

## AI Copilot

The copilot (`backend/copilot.py`) answers natural-language questions about the live enforcement data. It tries providers in this order:

1. **Groq** (llama-3.1-8b-instant) — free, fast, cloud API
2. **Gemini** (gemini-1.5-flash / flash-8b) — free 1500 req/day
3. **Rule-based fallback** — always works, answers from real hotspot data

Set either or both API keys in `backend/.env`. If neither is configured, the rule-based fallback is used automatically.

---

## JSON Schema Contract

### hotspots_h3.json
```json
{
  "h3_index": "8b3d4a1a2b3c4dff",
  "latitude": 12.9767,
  "longitude": 77.5774,
  "eps_score": 0.872,
  "eps_tier": "A – Critical",
  "hotspot_rank": 1,
  "total_violations": 34468,
  "congestion_delay_mins": 28.4,
  "persistence": 0.91,
  "recurrence": 1.0,
  "peak_concentration": 0.62,
  "dominant_vehicle_type": "CAR",
  "violation_types": ["WRONG PARKING", "DOUBLE PARKING"],
  "police_station": "Upparpet",
  "junction_name": "Richmond Circle",
  "zone_type": "commercial",
  "lifecycle": "Escalating",
  "unresolved_citizen_complaints": 187,
  "validation_rate": 0.31,
  "enforcement_effectiveness": "Moderate",
  "blind_spot": true,
  "explanation": "AI-generated plain text reason..."
}
```

### forecast_risk.json
```json
{
  "h3_index": "8b3d4a...",
  "police_station": "Koramangala",
  "timestamp": "2024-06-17T10:35:00Z",
  "window_minutes": 5,
  "predicted_risk_score": 0.81,
  "risk_tier": "HIGH",
  "is_ghost_violation": false,
  "ghost_reason": null,
  "model": "LightGBM+CatBoost 55/45 blend",
  "confidence_interval": { "lower": 0.73, "upper": 0.89 }
}
```

### officer_deployment.json
```json
{
  "route_id": "ROUTE-01",
  "officer_id": "OFF-0017",
  "officers_count": 2,
  "station_sequence": ["Upparpet", "Shivajinagar", "City Market"],
  "optimized_path_coordinates": [[77.577, 12.976], [77.607, 12.982]],
  "assigned_vehicle_type": "TOWING TRUCK",
  "shift_priority": "Immediate",
  "estimated_coverage_mins": 38,
  "total_route_km": 4.2,
  "avg_eps_score": 0.87,
  "explanation_text": "Route optimized for MAXI-CAB cluster dominance..."
}
```

### admin_config.json
```json
{
  "eps_weight_violations": 0.4,
  "eps_weight_delay": 0.35,
  "eps_weight_complaints": 0.25,
  "ghost_violation_speed_drop_threshold_pct": 50,
  "urgent_eps_threshold": 0.75,
  "blind_spot_complaint_minimum": 120,
  "cache_ttl_seconds": 30,
  "updated_at": "2026-06-17T05:22:45Z"
}
```

---

## Deploying on Render

This project is deployed on [Render](https://render.com). For a fresh deployment:

1. Push the project to a GitHub repository.
2. In Render, create a new **Web Service** and point it to your repo.
3. Set the build command: `pip install -r requirements.txt`
4. Set the start command: `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
5. Add your environment variables (from `backend/.env`) in the Render dashboard under **Environment**.
6. On first deploy, SSH into the service shell (or add a one-off job) to run:
   ```bash
   python3 data/generate_mock.py
   ```

> **Note:** Render's free tier has ephemeral storage — JSON data files written at runtime (complaints, SOS flags, etc.) will reset on redeploy. For persistence, migrate those writes to the configured PostgreSQL database.
