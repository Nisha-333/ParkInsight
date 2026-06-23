"""
ParkingIntel — FastAPI Backend v3
Bengaluru Traffic Enforcement Intelligence Platform
Role-based API: Admin | Police | Citizen

Schema aligned to real pipeline output (hotspots_h3.json, forecast_risk.json,
officer_deployment.json) normalized by data/normalize_pipeline_output.py.
"""
try:
    from dotenv import load_dotenv as _ld
    import pathlib as _pl
    _ld(_pl.Path(__file__).resolve().parent / ".env")
except ImportError:
    pass

from fastapi import FastAPI, HTTPException, Query, Body, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse
import json, os, math, time, uuid
from pathlib import Path
from datetime import datetime, timezone
from typing import Optional

try:
    # Works when launched as `uvicorn backend.main:app` from the project root.
    from backend import auth as auth_module
    from backend import copilot as copilot_module
except ImportError:
    # Works when launched as `uvicorn main:app` from inside backend/ (see README).
    import auth as auth_module
    import copilot as copilot_module


app = FastAPI(title="ParkingIntel API v3", version="3.0.0", docs_url="/docs")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
auth_module.seed_default_accounts()


def require_roles(*allowed_roles):
    def _dep(authorization: Optional[str] = Header(default=None)):
        user = auth_module.get_current_user(authorization)
        if user["role"] not in allowed_roles:
            raise HTTPException(403, f"Role '{user['role']}' is not permitted.")
        return user
    return _dep

# ── Cache ─────────────────────────────────────────────────────────────────────
_cache: dict = {}
_cache_ts: dict = {}
CACHE_TTL = 30

def load(filename: str):
    now = time.time()
    if filename in _cache and now - _cache_ts.get(filename, 0) < CACHE_TTL:
        return _cache[filename]
    path = DATA_DIR / filename
    if not path.exists():
        raise HTTPException(status_code=503, detail=f"Data file '{filename}' not found.")
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    _cache[filename] = data
    _cache_ts[filename] = now
    return data

def save(filename: str, data):
    path = DATA_DIR / filename
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)
    _cache[filename] = data
    _cache_ts[filename] = time.time()

def utc_now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

def haversine_meters(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance between two lat/lon points, in metres.
    Used instead of raw Euclidean degree-distance, which is not a uniform
    metric — at Bengaluru's latitude (~13°N), 0.01° of longitude is ~970m
    while 0.01° of latitude is ~1113m, so a degree-based radius is a
    non-circular ellipse rather than a consistent real-world distance."""
    R = 6371000  # Earth radius in metres
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * R * math.asin(math.sqrt(a))

# ── Data accessors (encapsulate all schema field names here) ──────────────────

def get_hotspots() -> list:
    """Returns flat list of hotspot dicts (normalized schema)."""
    data = load("hotspots_h3.json")
    # Supports both flat list (normalized) and wrapped dict (raw pipeline output)
    if isinstance(data, list):
        return data
    return data.get("hotspots", [])

def get_forecasts() -> list:
    """Returns flat list of forecast records."""
    data = load("forecast_risk.json")
    if isinstance(data, list):
        return data
    return data.get("forecasts", [])

def get_forecast_meta() -> dict:
    data = load("forecast_risk.json")
    if isinstance(data, dict):
        return {k: v for k, v in data.items() if k != "forecasts"}
    return {}

def get_allocations() -> list:
    data = load("officer_deployment.json")
    if isinstance(data, list):
        return data
    return data.get("deployment", [])

def get_junctions() -> list:
    """Returns the full named-junction gazetteer (junction_name, display_name,
    latitude, longitude) used for search/autocomplete across citizen, guest,
    police and admin pages. This is the complete list of named junctions from
    the source dataset — independent of (and a superset of) the named entries
    inside hotspots_h3.json, since most dataset rows are unnamed grid cells
    ("No Junction") while every named junction is kept here regardless of
    whether it happens to carry a high EPS score."""
    try:
        data = load("junctions.json")
    except HTTPException:
        return []
    return data if isinstance(data, list) else data.get("junctions", [])

def get_deployment_meta() -> dict:
    data = load("officer_deployment.json")
    if isinstance(data, dict):
        return {k: v for k, v in data.items() if k != "deployment"}
    return {}

# ══════════════════════════════════════════════════════════════════════════════
# AUTH
# ══════════════════════════════════════════════════════════════════════════════

@app.post("/api/v1/auth/signup", tags=["Auth"])
def signup(payload: dict = Body(...)):
    name     = (payload.get("name") or "").strip()
    email    = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""
    if not name or not email:
        raise HTTPException(400, "Name and email are required.")
    if not auth_module.EMAIL_RE.match(email):
        raise HTTPException(400, "Enter a valid email address.")
    auth_module.validate_password_strength(password)
    if auth_module.find_user(email):
        raise HTTPException(409, "An account with this email already exists.")
    users = auth_module._load_users()
    salt, pw_hash = auth_module.hash_password(password)
    user_id = f"USR_{uuid.uuid4().hex[:8].upper()}"
    record = {"user_id": user_id, "email": email, "name": name, "role": "citizen",
              "salt": salt, "password_hash": pw_hash, "status": "active"}
    users.append(record)
    auth_module._save_users(users)
    citizens = load("citizens.json")
    citizens.append({"user_id": user_id, "name": name, "tier": "Bronze Sentinel",
                      "credits": 0, "verified_reports": 0, "redeemed": 0})
    save("citizens.json", citizens)
    token = auth_module.create_token(record)
    return {"token": token, "user": {"user_id": user_id, "name": name, "role": "citizen", "email": email}}


@app.post("/api/v1/auth/login", tags=["Auth"])
def login_endpoint(payload: dict = Body(...)):
    email    = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""
    user = auth_module.find_user(email)
    if not user or not auth_module.verify_password(password, user["salt"], user["password_hash"]):
        raise HTTPException(401, "Invalid email or password.")
    if user.get("status") != "active":
        if user.get("status") == "pending":
            raise HTTPException(403, "Your officer account is awaiting admin approval.")
        raise HTTPException(403, "This account is not active.")
    token = auth_module.create_token(user)
    safe_user = {k: v for k, v in user.items() if k not in ("password_hash", "salt")}
    return {"token": token, "user": safe_user}


@app.get("/api/v1/auth/me", tags=["Auth"])
def auth_me(authorization: Optional[str] = Header(default=None)):
    user = auth_module.get_current_user(authorization)
    full = auth_module.find_user_by_id(user["user_id"]) or {}
    safe_user = {k: v for k, v in full.items() if k not in ("password_hash", "salt")}
    return safe_user or user


@app.post("/api/v1/admin/officers", tags=["Admin"])
def admin_create_officer(payload: dict = Body(...), admin=Depends(require_roles("admin"))):
    name     = (payload.get("name") or "").strip()
    email    = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""
    if not name or not email:
        raise HTTPException(400, "Name and email are required.")
    if not auth_module.EMAIL_RE.match(email):
        raise HTTPException(400, "Enter a valid email address.")
    auth_module.validate_password_strength(password)
    if auth_module.find_user(email):
        raise HTTPException(409, "An account with this email already exists.")
    users = auth_module._load_users()
    salt, pw_hash = auth_module.hash_password(password)
    user_id = f"USR_{uuid.uuid4().hex[:8].upper()}"
    record = {"user_id": user_id, "email": email, "name": name, "role": "police",
              "salt": salt, "password_hash": pw_hash, "status": "active",
              "assigned_unit": payload.get("assigned_unit", "Unassigned"),
              "vehicle_access": payload.get("vehicle_access", "FOUR_WHEELER_PATROL"),
              "route_id": payload.get("route_id", "OFFICER_01")}
    users.append(record)
    auth_module._save_users(users)
    return {"status": "created", "user_id": user_id, "email": email, "role": "police"}


@app.post("/api/v1/auth/police-signup", tags=["Auth"])
def police_signup(payload: dict = Body(...)):
    name     = (payload.get("name") or "").strip()
    email    = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""
    badge    = (payload.get("badge_number") or "").strip()
    unit     = (payload.get("assigned_unit") or "").strip()
    if not name or not email or not badge or not unit:
        raise HTTPException(400, "Name, email, badge number, and station are required.")
    if not auth_module.EMAIL_RE.match(email):
        raise HTTPException(400, "Enter a valid email address.")
    auth_module.validate_password_strength(password)
    if auth_module.find_user(email):
        raise HTTPException(409, "An account with this email already exists.")
    users = auth_module._load_users()
    salt, pw_hash = auth_module.hash_password(password)
    user_id = f"USR_{uuid.uuid4().hex[:8].upper()}"
    record = {"user_id": user_id, "email": email, "name": name, "role": "police",
              "salt": salt, "password_hash": pw_hash, "status": "pending",
              "badge_number": badge, "assigned_unit": unit,
              "vehicle_access": payload.get("vehicle_access", "FOUR_WHEELER_PATROL"),
              "route_id": payload.get("route_id", "UNASSIGNED"),
              "requested_at": utc_now()}
    users.append(record)
    auth_module._save_users(users)
    return {"status": "pending", "message": "Request submitted. An admin must approve your account before you can sign in."}


@app.get("/api/v1/admin/police-requests", tags=["Admin"])
def list_police_requests(admin=Depends(require_roles("admin"))):
    users = auth_module._load_users()
    pending = [{k: v for k, v in u.items() if k not in ("password_hash", "salt")}
               for u in users if u.get("role") == "police" and u.get("status") == "pending"]
    return {"requests": pending}


def _assign_least_loaded_route(users: list, user: dict) -> str:
    """Assigns this user the deployment route_id currently held by the fewest
    active officers (round-robin), so officers spread across the available
    patrol routes instead of piling onto the same one. Returns the assigned
    route_id, or 'UNASSIGNED' if no deployment routes exist."""
    all_route_ids = [a.get("route_id", a.get("officer_id")) for a in get_allocations()]
    if not all_route_ids:
        return "UNASSIGNED"
    current_counts = {rid: 0 for rid in all_route_ids}
    for u in users:
        rid = u.get("route_id")
        if rid in current_counts:
            current_counts[rid] += 1
    chosen = min(all_route_ids, key=lambda rid: current_counts[rid])
    user["route_id"] = chosen
    return chosen


@app.post("/api/v1/admin/police-requests/{user_id}/approve", tags=["Admin"])
def approve_police_request(user_id: str, admin=Depends(require_roles("admin"))):
    users = auth_module._load_users()
    user = next((u for u in users if u["user_id"] == user_id), None)
    if not user:
        raise HTTPException(404, "Request not found.")
    if user.get("role") != "police" or user.get("status") != "pending":
        raise HTTPException(400, "This request is not awaiting approval.")
    user["status"] = "active"
    # Assign a real patrol route from the deployment allocations so this
    # officer's /police/my-route view is their own, not a fallback shared
    # with everyone else.
    if user.get("route_id", "UNASSIGNED") == "UNASSIGNED":
        _assign_least_loaded_route(users, user)
    auth_module._save_users(users)
    return {"status": "approved", "user_id": user_id, "route_id": user.get("route_id", "UNASSIGNED")}


@app.post("/api/v1/admin/officers/{user_id}/assign-route", tags=["Admin"])
def assign_officer_route(user_id: str, payload: dict = Body(default={}), admin=Depends(require_roles("admin"))):
    """Assigns (or reassigns) a real patrol route to an active officer.
    Covers accounts that were approved before route assignment existed and
    are stuck at route_id=UNASSIGNED. Pass {"route_id": "OFFICER_05"} to set
    a specific route, or omit the body to auto-assign the least-loaded one."""
    users = auth_module._load_users()
    user = next((u for u in users if u["user_id"] == user_id), None)
    if not user:
        raise HTTPException(404, "Officer not found.")
    if user.get("role") != "police":
        raise HTTPException(400, "This account is not a police officer.")
    requested_route_id = (payload or {}).get("route_id")
    if requested_route_id:
        valid_ids = {a.get("route_id", a.get("officer_id")) for a in get_allocations()}
        if requested_route_id not in valid_ids:
            raise HTTPException(400, f"'{requested_route_id}' is not a known deployment route.")
        user["route_id"] = requested_route_id
        assigned = requested_route_id
    else:
        assigned = _assign_least_loaded_route(users, user)
    auth_module._save_users(users)
    return {"status": "ok", "user_id": user_id, "route_id": assigned}


@app.post("/api/v1/admin/police-requests/{user_id}/reject", tags=["Admin"])
def reject_police_request(user_id: str, admin=Depends(require_roles("admin"))):
    users = auth_module._load_users()
    user = next((u for u in users if u["user_id"] == user_id), None)
    if not user:
        raise HTTPException(404, "Request not found.")
    if user.get("role") != "police" or user.get("status") != "pending":
        raise HTTPException(400, "This request is not awaiting approval.")
    users = [u for u in users if u["user_id"] != user_id]
    auth_module._save_users(users)
    return {"status": "rejected", "user_id": user_id}


# ══════════════════════════════════════════════════════════════════════════════
# AI COPILOT
# ══════════════════════════════════════════════════════════════════════════════

@app.post("/api/v1/copilot", tags=["Copilot"])
async def copilot_ask(payload: dict = Body(...)):
    question = (payload.get("question") or "").strip()
    if not question:
        raise HTTPException(400, "question is required.")
    reply = await copilot_module.ask_copilot(question, payload.get("role", "guest"), payload.get("page"), None)
    return {"reply": reply, "generated_at": utc_now()}

@app.post("/api/v1/copilot/authed", tags=["Copilot"])
async def copilot_ask_authed(payload: dict = Body(...), user=Depends(require_roles("citizen","police","admin"))):
    question = (payload.get("question") or "").strip()
    if not question:
        raise HTTPException(400, "question is required.")
    reply = await copilot_module.ask_copilot(question, user["role"], payload.get("page"), user)
    return {"reply": reply, "generated_at": utc_now()}

# ══════════════════════════════════════════════════════════════════════════════
# ADMIN ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/api/v1/dashboard/summary", tags=["Admin"])
def dashboard_summary():
    hotspots    = get_hotspots()
    forecasts   = get_forecasts()
    forecast_meta = get_forecast_meta()
    allocations = get_allocations()
    deploy_meta = get_deployment_meta()

    total_violations  = sum(h["total_violations"] for h in hotspots)
    critical_zones    = sum(1 for h in hotspots if h["eps_score"] >= 0.75)
    blind_spots       = sum(1 for h in hotspots if h.get("blind_spot", False))

    # "Now" risk = window_minutes == 0; risk >= 0.70 → active risk zone
    now_forecasts = [f for f in forecasts if f["window_minutes"] == 0]
    active_risk_zones = sum(1 for f in now_forecasts if f["predicted_risk_score"] >= 0.70)

    # Ghost violations: unique zones flagged at window=0
    ghost_now = [f for f in now_forecasts if f.get("is_ghost_violation")]
    total_ghost_flagged = forecast_meta.get("total_ghost_flagged",
                          len({f["h3_cell"] for f in forecasts if f.get("is_ghost_violation")}))

    # Congestion proxy: weighted average pct_of_citywide_impact across hotspots
    total_viol = max(1, total_violations)
    avg_citywide_impact_pct = sum(h.get("pct_of_citywide_impact", 0) * h["total_violations"] for h in hotspots) / total_viol
    # congestion_delay_mins is derived from pct_of_citywide_impact in normalize_pipeline_output.py;
    # keep field for map coloring but do not fabricate a rupee cost from it
    avg_delay = sum(h["congestion_delay_mins"] * h["total_violations"] for h in hotspots) / total_viol
    top10_impact_pct = sum(h.get("pct_of_citywide_impact", 0) for h in hotspots[:10])

    # Enforcement gap from real resource-gap analysis
    gap_analysis = deploy_meta.get("enforcement_resource_gap_analysis", {})
    unassigned_critical = deploy_meta.get("unassigned_critical_or_high_cells", 0)

    top = hotspots[0] if hotspots else {}

    urgent_alerts = []
    seen_zones = set()
    for f in ghost_now:
        zone = f.get("police_station", "")
        if zone in seen_zones:
            continue
        seen_zones.add(zone)
        ghost_type = f.get("ghost_type", "")
        reason = f.get("ghost_reason") or (
            "No recent activity detected — possible enforcement gap or displacement"
            if ghost_type == "TRUE_GHOST"
            else "Sporadic recent activity — possible seasonal variation or irregular enforcement"
        )
        urgent_alerts.append({
            "type": "ghost_violation",
            "zone": zone,
            "ghost_type": ghost_type,
            "message": reason,
            "timestamp": f.get("timestamp", utc_now()),
            "latitude": f.get("latitude"),
            "longitude": f.get("longitude"),
        })

    return {
        "generated_at": utc_now(),
        "city": "Bengaluru",
        "data_period": "Jan–May 2024",
        "total_violations_tracked": total_violations,
        "critical_hotspot_zones": critical_zones,
        "citizen_accountability_blind_spots": blind_spots,
        "active_risk_zones_now": active_risk_zones,
        "ghost_violations_detected": total_ghost_flagged,
        "true_ghost_zones": forecast_meta.get("true_ghost_count", 0),
        "intermittent_ghost_zones": forecast_meta.get("intermittent_count", 0),
        "top10_citywide_impact_pct": round(top10_impact_pct, 1),
        "avg_congestion_impact_index": round(avg_citywide_impact_pct, 4),
        "avg_congestion_delay_mins": round(avg_delay, 1),
        "congestion_metric_note": "Proxy index (violations × junction-proximity × peak-hour multiplier). Calibrate against real traffic-speed data when available. No rupee cost is computed — that would require real dwell-time data.",
        "officers_deployed": len(allocations),
        "patrol_routes_active": len(allocations),
        "unresolved_complaints_total": 0,          # complaints.json is demo-only
        "enforcement_gap_pct": round(unassigned_critical / max(1, gap_analysis.get("critical_plus_high_cells", 1)) * 100, 1),
        "enforcement_resource_gap": gap_analysis,
        "optimized_beat_count": len(allocations),
        "total_violations_covered": sum(a.get("priority_violations", 0) for a in allocations),
        "headline_alert": {
            "zone": top.get("police_station", ""),
            "eps_score": top.get("eps_score", 0),
            "violations": top.get("total_violations", 0),
            "citywide_impact_pct": top.get("pct_of_citywide_impact", 0),
        },
        "urgent_alerts": urgent_alerts[:5],
    }


@app.get("/api/v1/admin/config", tags=["Admin"])
def get_config():
    cfg_path = DATA_DIR / "admin_config.json"
    if not cfg_path.exists():
        default = {
            "eps_weight_violations": 0.4, "eps_weight_delay": 0.35, "eps_weight_complaints": 0.25,
            "ghost_violation_speed_drop_threshold_pct": 40, "urgent_eps_threshold": 0.75,
            "blind_spot_complaint_minimum": 120, "cache_ttl_seconds": 30, "updated_at": utc_now(),
        }
        with open(cfg_path, "w") as f:
            json.dump(default, f, indent=2)
        return default
    with open(cfg_path) as f:
        return json.load(f)


@app.post("/api/v1/admin/config", tags=["Admin"])
def update_config(payload: dict = Body(...), admin=Depends(require_roles("admin"))):
    cfg_path = DATA_DIR / "admin_config.json"
    existing = {}
    if cfg_path.exists():
        with open(cfg_path) as f:
            existing = json.load(f)
    existing.update(payload)
    existing["updated_at"] = utc_now()
    with open(cfg_path, "w") as f:
        json.dump(existing, f, indent=2)
    return {"status": "ok", "config": existing}


@app.get("/api/v1/admin/officers/live", tags=["Admin"])
def officers_live(admin=Depends(require_roles("admin"))):
    return {"generated_at": utc_now(), "officers": load("officers_live.json")}


@app.get("/api/v1/admin/export/blind-spots", tags=["Admin"])
def export_blind_spots(fmt: str = Query("json"), admin=Depends(require_roles("admin"))):
    hotspots = get_hotspots()
    blind = [h for h in hotspots if h.get("blind_spot")]
    rows = [{
        "zone": h["police_station"],
        "junction": h.get("junction_name", ""),
        "eps_score": h["eps_score"],
        "hotspot_tier": h.get("hotspot_tier", ""),
        "total_violations": h["total_violations"],
        "action_rate_pct": round(h.get("action_rate", 0) * 100, 1),
        "top_violation_type": h.get("top_violation_type", ""),
        "congestion_delay_mins": h.get("congestion_delay_mins", 0),
        "under_enforced": h.get("under_enforced", True),
        "ai_explanation": h.get("explanation", ""),
    } for h in blind]
    if fmt == "csv":
        import io
        buf = io.StringIO()
        if rows:
            buf.write(",".join(rows[0].keys()) + "\n")
            for r in rows:
                buf.write(",".join(f'"{v}"' for v in r.values()) + "\n")
        from fastapi.responses import PlainTextResponse
        return PlainTextResponse(buf.getvalue(), media_type="text/csv",
                                 headers={"Content-Disposition": "attachment; filename=blind_spots.csv"})
    total_viol = sum(r["total_violations"] for r in rows)
    return {
        "generated_at": utc_now(),
        "report_type": "Enforcement Blind Spots (Under-enforced Zones)",
        "methodology": "Zones in top quartile of violation volume AND bottom quartile of action rate",
        "data_period": "Jan–May 2024",
        "summary": {
            "blind_spot_zones": len(rows),
            "total_violations_in_blind_spots": total_viol,
        },
        "blind_spots": rows,
    }

# ══════════════════════════════════════════════════════════════════════════════
# SHARED HOTSPOT / FORECAST / ALLOCATION ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/api/v1/hotspots", tags=["Hotspots"])
def get_hotspots_endpoint(min_eps: float = Query(0.0), blind_spot_only: bool = Query(False), limit: int = Query(50)):
    hotspots = get_hotspots()
    result = [h for h in hotspots if h["eps_score"] >= min_eps]
    if blind_spot_only:
        result = [h for h in result if h.get("blind_spot")]
    return {"generated_at": utc_now(), "returned": len(result[:limit]), "hotspots": result[:limit]}


@app.get("/api/v1/junctions", tags=["Public"])
def get_junctions_endpoint(q: str = Query("", description="Optional case-insensitive substring filter on junction_name")):
    """Full named-junction list for search/autocomplete widgets (citizen safe-to-park
    check, violation report forms, admin/police location search). Returns every
    named junction in the source dataset with its lat/lon so the frontend can
    autofill coordinates from a selected junction name instead of requiring the
    person to know or type raw GPS coordinates.
    """
    junctions = get_junctions()
    if q:
        q_low = q.lower()
        junctions = [j for j in junctions if q_low in j.get("junction_name", "").lower()]
    return {"count": len(junctions), "junctions": junctions}


@app.get("/api/v1/forecast", tags=["Forecast"])
def get_forecast_endpoint(window_minutes: Optional[int] = Query(None), ghost_only: bool = Query(False)):
    forecasts = get_forecasts()
    meta = get_forecast_meta()
    result = forecasts
    if window_minutes is not None:
        result = [f for f in result if f["window_minutes"] == window_minutes]
    if ghost_only:
        result = [f for f in result if f.get("is_ghost_violation")]

    ghost_list = [f for f in result if f.get("is_ghost_violation")]

    # Zone summary across all windows
    zone_summary: dict = {}
    for f in forecasts:
        z = f["police_station"]
        if z not in zone_summary:
            zone_summary[z] = {"max_risk": 0, "ghost_flag": False, "windows": [], "predicted_daily_violations": 0}
        zone_summary[z]["max_risk"] = max(zone_summary[z]["max_risk"], f["predicted_risk_score"])
        if f.get("is_ghost_violation"):
            zone_summary[z]["ghost_flag"] = True
        if f["window_minutes"] == 0:
            zone_summary[z]["predicted_daily_violations"] = f.get("predicted_daily_violations", 0)
        zone_summary[z]["windows"].append({
            "window_minutes": f["window_minutes"],
            "risk": f["predicted_risk_score"],
            "predicted_daily_violations": f.get("predicted_daily_violations", 0),
        })

    return {
        "generated_at": utc_now(),
        "total_records": len(result),
        "ghost_zones_summary": meta.get("ghost_zones_summary", {}),
        "ghost_violations": ghost_list,
        "ghost_count": len({f["h3_cell"] for f in forecasts if f.get("is_ghost_violation")}),
        "zone_summary": [
            {"zone": z, "max_risk": round(v["max_risk"], 3), "ghost_flag": v["ghost_flag"],
             "predicted_daily_violations": v["predicted_daily_violations"],
             "windows": sorted(v["windows"], key=lambda x: x["window_minutes"])}
            for z, v in sorted(zone_summary.items(), key=lambda x: -x[1]["max_risk"])
        ],
        "forecasts": result,
    }


@app.get("/api/v1/allocations", tags=["Deployment"])
def get_allocations_endpoint(vehicle_type: Optional[str] = Query(None)):
    allocations = get_allocations()
    meta = get_deployment_meta()
    result = allocations
    if vehicle_type:
        result = [a for a in result if vehicle_type.upper() in a.get("assigned_vehicle_type", "").upper()]
    return {
        "generated_at": utc_now(),
        "total_routes": len(result),
        "enforcement_resource_gap_analysis": meta.get("enforcement_resource_gap_analysis", {}),
        "optimization_method": meta.get("optimization_method", "OR-Tools CP-SAT"),
        "allocations": result,
    }


@app.get("/api/v1/congestion-zones", tags=["Public"])
def congestion_zones(min_delay: float = Query(5.0)):
    hotspots  = get_hotspots()
    forecasts = get_forecasts()
    # Build now-risk lookup by h3_cell (window_minutes == 0)
    now_risk = {f.get("h3_cell", f.get("h3_index", "")): f["predicted_risk_score"]
                for f in forecasts if f["window_minutes"] == 0}
    zones = []
    for h in hotspots:
        if h["congestion_delay_mins"] < min_delay:
            continue
        eps      = h["eps_score"]
        cell_key = h.get("h3_index", "")
        severity = "CRITICAL" if eps >= 0.85 else "HIGH" if eps >= 0.70 else "MEDIUM" if eps >= 0.50 else "LOW"
        zones.append({
            "h3_index":   cell_key,
            "lat":        h["latitude"],
            "lon":        h["longitude"],
            "zone":       h["police_station"],
            "severity":   severity,
            "delay_mins": h["congestion_delay_mins"],
            "risk_now":   round(now_risk.get(cell_key, 0.0), 3),
            "action":     "REROUTE" if severity in ("CRITICAL", "HIGH") else "CAUTION",
        })
    zones.sort(key=lambda z: -z["risk_now"])
    return {
        "generated_at": utc_now(),
        "active_zones": len(zones),
        "critical_count": sum(1 for z in zones if z["severity"] == "CRITICAL"),
        "zones": zones,
    }

# ══════════════════════════════════════════════════════════════════════════════
# POLICE ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/api/v1/police/my-route", tags=["Police"])
def my_route(officer_id: str = Query(None), officer=Depends(require_roles("police", "admin"))):
    allocations = get_allocations()

    # Resolve which route this request should return:
    # - Police users always get their OWN account's route_id (set at approval
    #   time), regardless of what officer_id query param the frontend sends.
    #   This is what connects admin's officer-routing to police's patrol view.
    # - Admins may pass officer_id explicitly to preview a specific route.
    route = None
    if officer.get("role") == "police":
        full_user = auth_module.find_user_by_id(officer["user_id"]) or {}
        my_route_id = full_user.get("route_id", "UNASSIGNED")
        route = next((a for a in allocations
                      if a.get("route_id", a.get("officer_id")) == my_route_id), None)
        if route is None:
            raise HTTPException(404, "No patrol route has been assigned to your account yet. "
                                      "Please contact an admin.")
    else:
        lookup_id = officer_id or (allocations[0]["officer_id"] if allocations else None)
        route = next((a for a in allocations
                      if a.get("route_id", a.get("officer_id")) == lookup_id
                      or a["officer_id"] == lookup_id), allocations[0] if allocations else None)
        if not route:
            raise HTTPException(404, "Officer route not found")

    stops = []
    for stop in route.get("route", []):
        eps      = stop.get("enforcement_priority_score", 0)
        priority = "Critical" if eps >= 0.80 else "High" if eps >= 0.65 else "Moderate"
        vtype    = stop.get("recommended_vehicle", "").replace("_", " ").title()
        stops.append({
            "stop_number":      stop.get("sequence", len(stops) + 1),
            "station":          stop["police_station"],
            "junction":         stop.get("junction_name", ""),
            "latitude":         stop.get("latitude"),
            "longitude":        stop.get("longitude"),
            "h3_index":         stop.get("h3_cell", ""),
            "zone_id":          stop.get("zone_id", ""),
            "eps_score":        eps,
            "hotspot_tier":     stop.get("hotspot_tier", ""),
            "priority":         priority,
            "recommended_vehicle": vtype,
            "target_issue":     f"{stop.get('hotspot_tier','')}-tier zone — {stop.get('junction_name','')}",
            "checklist":        ["Identify & photograph vehicle", "Issue challan or tow",
                                 "Clear carriage-way", "Update action in system"],
            "completed":        False,
        })

    return {
        "officer_id":             route.get("officer_id", officer_id),
        "route_id":               route.get("route_id", route["officer_id"]),
        "zone_id":                route.get("zone_id", ""),
        "assigned_vehicle":       route.get("assigned_vehicle_type", "FOUR_WHEELER_PATROL"),
        "enforcement_priority":   route.get("enforcement_priority", ""),
        "total_stops":            len(stops),
        "estimated_route_distance_km": route.get("estimated_route_distance_km", 0),
        "estimated_coverage_mins": route.get("estimated_coverage_mins", 0),
        "total_route_priority_score": route.get("total_route_priority_score", 0),
        "path_coordinates":       route.get("optimized_path_coordinates", []),
        "stops":                  stops,
    }


@app.post("/api/v1/police/evidence", tags=["Police"])
def submit_evidence(payload: dict = Body(...), officer=Depends(require_roles("police", "admin"))):
    evidence_dir = DATA_DIR / "evidence"
    evidence_dir.mkdir(exist_ok=True)
    record = {**payload, "submission_id": f"EVD-{uuid.uuid4().hex[:8].upper()}", "submitted_at": utc_now()}
    with open(evidence_dir / f"{record['submission_id']}.json", "w") as f:
        json.dump(record, f, indent=2)
    try:
        officers = load("officers_live.json")
        for o in officers:
            if o["officer_id"] == payload.get("officer_id"):
                o["checked_items"] = o.get("checked_items", 0) + 1
        save("officers_live.json", officers)
    except:
        pass
    return {"status": "submitted", "submission_id": record["submission_id"],
            "message": "Enforcement action recorded."}


@app.post("/api/v1/police/emergency-flag", tags=["Police"])
def emergency_flag(payload: dict = Body(...), officer=Depends(require_roles("police", "admin"))):
    record = {**payload, "flag_id": f"SOS-{uuid.uuid4().hex[:6].upper()}",
              "created_at": utc_now(), "resolved": False}
    sos_path = DATA_DIR / "sos_queue.json"
    queue = []
    if sos_path.exists():
        with open(sos_path) as f:
            queue = json.load(f)
    queue.insert(0, record)
    with open(sos_path, "w") as f:
        json.dump(queue[:20], f, indent=2)
    return {"status": "broadcast", "flag_id": record["flag_id"],
            "message": "Emergency broadcast sent to Command Center."}


@app.get("/api/v1/admin/sos-queue", tags=["Admin"])
def sos_queue(admin=Depends(require_roles("admin", "police"))):
    sos_path = DATA_DIR / "sos_queue.json"
    if not sos_path.exists():
        return {"count": 0, "flags": []}
    with open(sos_path) as f:
        queue = json.load(f)
    return {"count": len(queue), "flags": queue}

# ══════════════════════════════════════════════════════════════════════════════
# CITIZEN ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/api/v1/citizen/profile", tags=["Citizen"])
def citizen_profile(user_id: str = Query(None), citizen=Depends(require_roles("citizen", "admin"))):
    user_id = user_id or citizen["user_id"]
    if citizen["role"] == "citizen" and user_id != citizen["user_id"]:
        raise HTTPException(403, "You can only view your own profile.")
    citizens = load("citizens.json")
    profile  = next((c for c in citizens if c["user_id"] == user_id), None)
    if not profile:
        raise HTTPException(404, "Citizen not found")
    complaints = load("complaints.json")
    my_complaints = [c for c in complaints if c["user_id"] == user_id]
    TIERS = [("Bronze Sentinel", 0), ("Silver Warden", 400), ("Gold Traffic Marshal", 900), ("Platinum Guardian", 2000)]
    credits = profile.get("credits", 0)
    tier = TIERS[0][0]
    for tname, thresh in TIERS:
        if credits >= thresh:
            tier = tname
    # A complaint that progresses from Verified → Action Taken → Resolved was still
    # verified at some point. Count any complaint that reached or passed Verified status.
    verified_statuses = {"Verified", "Action Taken", "Resolved"}
    action_statuses   = {"Action Taken", "Resolved"}
    return {**profile, "tier": tier, "my_complaints": my_complaints,
            "stats": {"total_reports": len(my_complaints),
                      "verified": sum(1 for c in my_complaints if c["status"] in verified_statuses),
                      "action_taken": sum(1 for c in my_complaints if c["status"] in action_statuses),
                      "pending": sum(1 for c in my_complaints if c["status"] == "Pending")}}


MAX_PHOTO_B64_CHARS = 2_000_000  # ~1.5MB decoded — comfortably above the ~100-300KB
                                  # the client-side compressor produces, but blocks
                                  # anything wildly oversized from bloating complaints.json


def _clean_complaint_payload(payload: dict) -> dict:
    photo = payload.get("photo_base64")
    if photo and (not isinstance(photo, str) or len(photo) > MAX_PHOTO_B64_CHARS or not photo.startswith("data:image/")):
        payload = {**payload, "photo_base64": None}
    return payload


@app.post("/api/v1/guest/complaint", tags=["Citizen"])
def submit_guest_complaint(payload: dict = Body(...)):
    payload = _clean_complaint_payload(payload)
    complaints = load("complaints.json")
    new_id = f"CMP-G{uuid.uuid4().hex[:8].upper()}"
    record = {**payload, "user_id": None, "complaint_id": new_id, "status": "Pending",
              "created_at": utc_now(), "credits_awarded": 0, "submitted_as": "guest"}
    complaints.insert(0, record)
    save("complaints.json", complaints)
    return {"status": "submitted", "complaint_id": new_id,
            "message": "Report received. Sign up to earn Civic Credits on future reports."}


@app.post("/api/v1/citizen/complaint", tags=["Citizen"])
def submit_complaint(payload: dict = Body(...), user=Depends(require_roles("citizen", "admin"))):
    payload = _clean_complaint_payload(payload)
    payload = {**payload, "user_id": user["user_id"]}
    complaints = load("complaints.json")
    new_id = f"CMP-{uuid.uuid4().hex[:8].upper()}"
    record = {**payload, "complaint_id": new_id, "status": "Pending",
              "created_at": utc_now(), "credits_awarded": 0}
    complaints.insert(0, record)
    save("complaints.json", complaints)
    return {"status": "submitted", "complaint_id": new_id,
            "message": "Report received. You'll earn 40 Civic Credits when action is taken."}


@app.get("/api/v1/citizen/complaint/{complaint_id}", tags=["Citizen"])
def track_complaint(complaint_id: str):
    complaints = load("complaints.json")
    rec = next((c for c in complaints if c["complaint_id"] == complaint_id), None)
    if not rec:
        raise HTTPException(404, "Complaint not found")
    return rec


@app.get("/api/v1/police/complaints", tags=["Police"])
def get_police_complaints(status: str = Query(None), zone: str = Query(None),
                          limit: int = Query(50), officer=Depends(require_roles("police", "admin"))):
    complaints = load("complaints.json")
    if status:
        complaints = [c for c in complaints if c.get("status", "").lower() == status.lower()]
    if zone:
        complaints = [c for c in complaints if zone.lower() in c.get("zone", "").lower()]
    return {"count": len(complaints[:limit]), "complaints": complaints[:limit]}


@app.patch("/api/v1/police/complaints/{complaint_id}", tags=["Police"])
def update_complaint_status(complaint_id: str, payload: dict = Body(...),
                            officer=Depends(require_roles("police", "admin"))):
    complaints = load("complaints.json")
    idx = next((i for i, c in enumerate(complaints) if c["complaint_id"] == complaint_id), None)
    if idx is None:
        raise HTTPException(404, "Complaint not found")
    new_status   = payload.get("status", complaints[idx]["status"])
    officer_note = payload.get("officer_note", "")
    complaints[idx]["status"]      = new_status
    complaints[idx]["updated_at"]  = utc_now()
    complaints[idx]["officer_note"] = officer_note
    if new_status in ("Action Taken", "Resolved"):
        complaints[idx]["credits_awarded"] = 40
        uid = complaints[idx].get("user_id")
        if uid:
            citizens = load("citizens.json")
            for cit in citizens:
                if cit["user_id"] == uid:
                    cit["credits"] = cit.get("credits", 0) + 40
                    break
            save("citizens.json", citizens)
    save("complaints.json", complaints)
    return {"status": "updated", "complaint_id": complaint_id, "new_status": new_status}


@app.post("/api/v1/citizen/parking-check", tags=["Citizen"])
def parking_check(payload: dict = Body(...)):
    lat = payload.get("latitude", 12.975)
    lon = payload.get("longitude", 77.580)
    hotspots = get_hotspots()

    def dist(h):
        hlat = h.get("latitude") or 0
        hlon = h.get("longitude") or 0
        return haversine_meters(hlat, hlon, lat, lon)

    nearest = min((h for h in hotspots if h.get("latitude")), key=dist) if hotspots else None
    d    = dist(nearest) if nearest else 999999
    eps  = nearest["eps_score"] if nearest else 0
    tier = nearest.get("hotspot_tier", "LOW") if nearest else "LOW"
    zone = nearest["police_station"] if nearest else "Unknown"
    junction_raw = nearest.get("junction_name", "") if nearest else ""
    junction = junction_raw if junction_raw and junction_raw != "No Junction" else ""
    location_label = junction or zone

    # NOTE ON THIS LOGIC: hotspot_tier is the pipeline's own percentile-based
    # classification (CRITICAL = top ~3% of EPS, HIGH = top ~15%, MEDIUM = top
    # ~40%, LOW = bottom ~60% — see /api/v1/dashboard "EPS Score" tooltip).
    # The previous version of this endpoint compared eps_score against fixed
    # absolute cutoffs (>=0.70 for HIGH, >=0.50 for MEDIUM). Because EPS is a
    # multi-factor blended score, those absolute values are almost never
    # reached in practice — only 1 of 703 scored cells citywide clears 0.70,
    # and only 4 clear 0.50 — so the check returned "Safe to Park" for nearly
    # every coordinate in Bengaluru, including ones right next to genuinely
    # CRITICAL/HIGH-tier junctions. Using the percentile tier (already computed
    # correctly upstream) instead of a raw EPS cutoff fixes that without
    # changing the EPS formula, the tiering thresholds, or any other endpoint.
    #
    # Distance still matters: a CRITICAL zone 2km away shouldn't flag the
    # current spot as unsafe, so risk is gated on being reasonably close to
    # the nearest scored point. Uses real ground distance (Haversine, metres)
    # rather than raw lat/lon degrees, which are not a uniform metric — a
    # degree-based radius would be a non-circular ellipse at this latitude.
    NEAR, FAR = 650, 1300  # metres

    if d < NEAR and tier in ("CRITICAL", "HIGH"):
        delay = nearest.get("congestion_delay_mins", 0)
        risk_level = "HIGH" if tier == "CRITICAL" else "MEDIUM-HIGH"
        return {"safe": False, "risk_level": risk_level, "eps_score": eps, "hotspot_tier": tier,
                "zone": zone, "junction": junction,
                "message": f"🔴 {tier}-tier enforcement zone ({nearest.get('top_violation_type','active enforcement').lower()} hotspot). "
                           f"{int(eps*100)} EPS score · congestion index ~{delay:.0f} when blocked.",
                "recommendation": "Find alternate parking 300m+ away. Nearest safe zone flagged on map."}
    elif d < FAR and tier in ("CRITICAL", "HIGH", "MEDIUM"):
        return {"safe": None, "risk_level": "MEDIUM", "eps_score": eps, "hotspot_tier": tier,
                "zone": zone, "junction": junction,
                "message": f"🟡 Caution Zone. Nearby {tier.lower()}-tier enforcement history ({location_label}). Check for time-restricted signage.",
                "recommendation": "Avoid peak hours 8–10 AM and 5–8 PM."}
    else:
        return {"safe": True, "risk_level": "LOW", "eps_score": eps, "hotspot_tier": tier,
                "zone": zone, "junction": junction,
                "message": "🟢 Safe to Park. No active peak-hour towing restrictions in this zone.",
                "recommendation": "Ensure you're within marked bay limits and check local signage."}


@app.get("/api/v1/citizen/community-feed", tags=["Citizen"])
def community_feed():
    hotspots   = get_hotspots()
    forecasts  = get_forecasts()
    complaints = load("complaints.json")
    now_risk   = {f.get("h3_cell", f.get("h3_index", "")): f["predicted_risk_score"]
                  for f in forecasts if f["window_minutes"] == 0}
    mae_now    = {f.get("h3_cell", f.get("h3_index", "")): f.get("validation_mae")
                  for f in forecasts if f["window_minutes"] == 0}
    feed = []
    for h in sorted(hotspots, key=lambda x: -x["eps_score"])[:10]:
        recent = [c for c in complaints if c.get("zone") == h["police_station"]][:3]
        cell   = h.get("h3_index", "")
        feed.append({
            "zone":             h["police_station"],
            "junction":         h.get("junction_name", ""),
            "latitude":         h.get("latitude"),
            "longitude":        h.get("longitude"),
            "severity":         "CRITICAL" if h["eps_score"] >= 0.85 else "HIGH" if h["eps_score"] >= 0.70 else "MEDIUM",
            "delay_mins":       h["congestion_delay_mins"],
            "risk_now":         round(now_risk.get(cell, 0), 3),
            "top_violation":    h.get("top_violation_type", ""),
            "community_reports": len(recent),
            "latest_report":    recent[0]["description"] if recent else None,
            "forecast_uncertainty_high": mae_now.get(cell) is not None,
            "validation_mae":   mae_now.get(cell),
        })
    return {"generated_at": utc_now(), "feed": feed}

# ══════════════════════════════════════════════════════════════════════════════
@app.get("/api/v1/admin/unassigned-cells", tags=["Admin"])
def get_unassigned_cells(admin=Depends(require_roles("admin", "police"))):
    """Returns HIGH/MEDIUM-tier cells with no assigned patrol officer — the
    enforcement coverage gap. Used by the admin map 'Coverage Gap' layer."""
    import csv as csv_module
    csv_path = DATA_DIR / "raw_pipeline_output" / "unassigned_cells.csv"
    if not csv_path.exists():
        return {"count": 0, "cells": []}
    hotspots = get_hotspots()
    coord_map = {h["h3_index"]: {"lat": h["latitude"], "lon": h["longitude"]}
                 for h in hotspots if h.get("latitude")}
    cells = []
    with open(csv_path, encoding="utf-8") as f:
        for row in csv_module.DictReader(f):
            coords = coord_map.get(row.get("h3_cell", ""), {})
            if not coords.get("lat"):
                continue
            cells.append({
                "h3_cell": row.get("h3_cell", ""),
                "hotspot_tier": row.get("hotspot_tier", ""),
                "eps_score": float(row.get("enforcement_priority_score", 0)),
                "police_station": row.get("police_station", ""),
                "junction_name": row.get("junction_name", ""),
                "latitude": coords["lat"],
                "longitude": coords["lon"],
            })
    return {"count": len(cells), "cells": cells}


# ══════════════════════════════════════════════════════════════════════════════
# HEALTH
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/api/v1/health", tags=["Meta"])
def health():
    files = ["hotspots_h3.json", "forecast_risk.json", "officer_deployment.json", "citizens.json", "complaints.json"]
    status = {f: ("ok" if (DATA_DIR / f).exists() else "missing") for f in files}
    return {"status": "healthy" if all(v == "ok" for v in status.values()) else "degraded",
            "generated_at": utc_now(), "data_files": status}

# ── Serve frontend ─────────────────────────────────────────────────────────────
from fastapi.responses import FileResponse

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend" / "public"
INDEX_HTML   = FRONTEND_DIR / "index.html"

@app.get("/", include_in_schema=False)
def serve_root():
    if INDEX_HTML.exists():
        return FileResponse(str(INDEX_HTML), media_type="text/html")
    return JSONResponse({"detail": "Frontend not built."}, status_code=404)

if FRONTEND_DIR.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)