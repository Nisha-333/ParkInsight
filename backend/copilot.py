"""
copilot.py — server-side AI Copilot
─────────────────────────────────────────────────────────────────────────────
Provider chain (tries each in order until one succeeds):
  1. Groq  — free, fast, cloud API, no install (llama-3.1-8b-instant)
  2. Gemini — free 1500 req/day (gemini-1.5-flash → gemini-1.5-flash-8b)
  3. Rule-based fallback — always works, answers from real hotspot data

Get a free Groq key at: https://console.groq.com (no credit card)
Get a free Gemini key at: https://aistudio.google.com/apikey
Set either (or both) in backend/.env
"""
import asyncio
import json
import logging
import os
from pathlib import Path

import httpx

logger = logging.getLogger("copilot")

# Lazy import of auth to avoid circular deps — only used in build_snapshot
def _get_auth_module():
    try:
        from backend import auth as _auth
        return _auth
    except ImportError:
        try:
            import auth as _auth
            return _auth
        except ImportError:
            return None
logging.basicConfig(level=logging.INFO)

DATA_DIR = Path(__file__).resolve().parent.parent / "data"

try:
    from dotenv import load_dotenv as _ld
    _ld(Path(__file__).resolve().parent / ".env")
except ImportError:
    pass


def _get_key(name: str) -> str:
    key = os.environ.get(name, "").strip()
    if not key or key.startswith("your-"):
        env_path = Path(__file__).resolve().parent / ".env"
        if env_path.exists():
            for line in env_path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line.startswith(f"{name}="):
                    key = line.split("=", 1)[1].strip()
                    break
    return key if (key and not key.startswith("your-")) else ""


def _load(name, default=None):
    path = DATA_DIR / name
    if not path.exists():
        return default if default is not None else []
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def build_snapshot(role: str, page, user) -> str:
    hotspots    = _load("hotspots_h3.json", [])
    complaints  = _load("complaints.json", [])
    _deployment_raw = _load("officer_deployment.json", [])
    # officer_deployment.json is a dict with a "deployment" key (list of routes)
    allocations = _deployment_raw.get("deployment", _deployment_raw) if isinstance(_deployment_raw, dict) else _deployment_raw
    sos         = _load("sos_queue.json", [])

    top_hotspots = sorted(hotspots, key=lambda h: -h.get("eps_score", 0))[:8]
    hotspot_lines = "; ".join(
        f"{h['police_station']} ({h.get('junction_name','')}) EPS={h['eps_score']:.2f} "
        f"violations={h['total_violations']} tier={h.get('hotspot_tier','')} "
        f"blind_spot={h.get('blind_spot',False)} top_violation={h.get('top_violation_type','')}"
        for h in top_hotspots
    )

    blind_spots = [h for h in hotspots if h.get("blind_spot")][:5]
    blind_lines = "; ".join(
        f"{h['police_station']} EPS={h['eps_score']:.2f} action_rate={h.get('action_rate',0):.0%}"
        for h in blind_spots
    ) or "none detected"

    open_complaints = [c for c in complaints if c.get("status") in ("Pending", "Verified")][:6]
    complaint_lines = "; ".join(
        f"{c.get('complaint_id')}: {c.get('category')} at {c.get('zone')} ({c.get('status')})"
        for c in open_complaints
    ) or "none open"

    active_sos = [s for s in sos if not s.get("resolved")][:3]
    sos_lines = "; ".join(f"{s.get('flag_id')}: {s.get('issue')}" for s in active_sos) or "none"

    officer_route_line = ""
    if user and role == "police":
        # Resolve the officer's assigned route_id from their user record (same
        # logic as the /api/v1/police/my-route endpoint).  The deployment list
        # uses internal IDs like "OFFICER_01" stored in the user's `route_id`
        # field — they do NOT match the JWT `user_id` (e.g. "USR_994821").
        auth_mod = _get_auth_module()
        my_route_id = None
        if auth_mod:
            full_user = auth_mod.find_user_by_id(user.get("user_id")) or {}
            my_route_id = full_user.get("route_id")
        if my_route_id:
            my_alloc = next(
                (a for a in allocations
                 if a.get("route_id", a.get("officer_id")) == my_route_id),
                None,
            )
        else:
            # Fallback: try direct officer_id match (covers future schemas)
            my_alloc = next(
                (a for a in allocations if a.get("officer_id") == user.get("user_id")),
                None,
            )
        if my_alloc:
            officer_route_line = (
                f"\nOfficer route ({my_alloc['route_id']}): "
                f"{' -> '.join(my_alloc.get('station_sequence', []))}, "
                f"vehicle={my_alloc.get('assigned_vehicle_type')}."
            )

    return (
        f"TOP HOTSPOTS: {hotspot_lines}\n"
        f"BLIND SPOTS (high violations, low action rate): {blind_lines}\n"
        f"OPEN COMPLAINTS: {complaint_lines}\n"
        f"ACTIVE SOS: {sos_lines}"
        f"{officer_route_line}\n"
        f"USER PAGE: {page or 'unknown'}"
    )


SYSTEM_PROMPTS = {
    "police": (
        "You are ParkInsight Police Copilot for Bengaluru Traffic Police. "
        "Help officers make real-time enforcement decisions using the live data snapshot. "
        "Be concise: 2-4 sentences, no bullet points, cite actual zone names and numbers from the snapshot."
    ),
    "citizen": (
        "You are ParkInsight Citizen Assistant for Bengaluru. Help residents with parking risk, "
        "violation reporting, and complaint tracking using the live data snapshot. "
        "Be friendly and brief: 2-4 sentences, cite actual zone names from the snapshot."
    ),
    "admin": (
        "You are ParkInsight Command Center Copilot for Bengaluru Traffic Police administration. "
        "Help commanders prioritize enforcement resources using the live data snapshot. "
        "Be strategic: 2-5 sentences, cite specific zones and numbers."
    ),
    "guest": (
        "You are ParkInsight Assistant. Discuss public hotspot and safety info using the live data snapshot. "
        "Be helpful and brief: 2-4 sentences, cite actual zone names."
    ),
}


# ── Provider 1: Groq (free, fast, llama-3.1-8b) ──────────────────────────────

async def _try_groq(client: httpx.AsyncClient, question: str, system: str) -> str | None:
    key = _get_key("GROQ_API_KEY")
    if not key:
        logger.info("Groq: no key configured")
        return None
    try:
        resp = await client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}", "content-type": "application/json"},
            json={
                "model": "llama-3.1-8b-instant",
                "messages": [
                    {"role": "system", "content": system},
                    {"role": "user", "content": question},
                ],
                "max_tokens": 350,
                "temperature": 0.3,
            },
        )
        logger.info(f"Groq response: {resp.status_code}")
        if resp.status_code == 200:
            return resp.json()["choices"][0]["message"]["content"].strip()
        logger.warning(f"Groq error: {resp.status_code} {resp.text[:200]}")
        return None
    except Exception as e:
        logger.warning(f"Groq exception: {e}")
        return None


# ── Provider 2: Gemini free tier ──────────────────────────────────────────────

async def _try_gemini(client: httpx.AsyncClient, question: str, system: str) -> str | None:
    key = _get_key("GEMINI_API_KEY")
    if not key:
        logger.info("Gemini: no key configured")
        return None

    models = ["gemini-1.5-flash", "gemini-1.5-flash-8b"]
    payload = {
        "contents": [{"role": "user", "parts": [{"text": question}]}],
        "system_instruction": {"parts": [{"text": system}]},
        "generationConfig": {"maxOutputTokens": 350, "temperature": 0.3},
    }

    for model in models:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
        try:
            for attempt in range(2):
                resp = await client.post(
                    url,
                    headers={"x-goog-api-key": key, "content-type": "application/json"},
                    json=payload,
                )
                logger.info(f"Gemini {model} attempt {attempt+1}: {resp.status_code}")
                if resp.status_code == 503 and attempt == 0:
                    await asyncio.sleep(2)
                    continue
                break

            if resp.status_code == 200:
                candidates = resp.json().get("candidates", [])
                if candidates:
                    parts = candidates[0].get("content", {}).get("parts", [])
                    text = "".join(p.get("text", "") for p in parts).strip()
                    if text:
                        return text
            else:
                logger.warning(f"Gemini {model}: {resp.status_code} {resp.text[:200]}")
        except Exception as e:
            logger.warning(f"Gemini {model} exception: {e}")

    return None


# ── Rule-based fallback ───────────────────────────────────────────────────────

def _rule_based_fallback(question: str) -> str:
    logger.info("Using rule-based fallback")
    q = question.lower()
    hotspots = _load("hotspots_h3.json", [])
    top3 = sorted(hotspots, key=lambda h: -h.get("eps_score", 0))[:3]
    top3_str = "; ".join(f"{h['police_station']} (EPS {h['eps_score']:.0%}, {h.get('hotspot_tier','')})" for h in top3)

    if any(w in q for w in ["blind spot", "blind spots", "under-enforced"]):
        blind = [h for h in hotspots if h.get("blind_spot")][:4]
        zones = ", ".join(h["police_station"] for h in blind) or "none detected"
        return (
            f"Blind spots are zones with high violation volume but very low enforcement action rate — "
            f"violations keep happening but officers rarely respond. "
            f"Current blind spots in Bengaluru: {zones}."
        )

    if any(w in q for w in ["eps", "score", "what is eps"]):
        # Try to find specific zone
        for h in hotspots:
            station = h.get("police_station", "").lower()
            if any(word in station for word in q.split() if len(word) > 3):
                return (
                    f"{h['police_station']} has EPS {h['eps_score']:.0%} ({h.get('hotspot_tier','')} tier). "
                    f"EPS (Enforcement Priority Score) is calculated from violation volume (35%), daily persistence (20%), "
                    f"peak-hour concentration (15%), junction proximity (20%), and repeat-offender rate (10%). "
                    f"A score of {h['eps_score']:.0%} means {'high' if h['eps_score']>0.65 else 'moderate'} enforcement priority."
                )
        return "EPS (Enforcement Priority Score) combines violation volume, persistence, peak-hour concentration, junction proximity, and repeat-offender rate. Top zone: " + top3_str.split(";")[0] + "."

    if any(w in q for w in ["top", "risk", "worst", "hotspot", "today", "zones"]):
        return f"Top risk zones right now: {top3_str}."

    if any(w in q for w in ["park", "safe", "parking"]):
        for h in hotspots:
            station = h.get("police_station", "").lower()
            if any(word in station for word in q.split() if len(word) > 4):
                tier = h.get("hotspot_tier", "")
                eps = h["eps_score"]
                advice = "Avoid street parking — active enforcement zone with high towing risk." if eps > 0.65 else "Moderate risk — avoid peak hours 8–10am and 5–8pm."
                return f"{h['police_station']} is a {tier}-tier zone (EPS {eps:.0%}). {advice}"
        return f"Check the map for your specific location. Highest risk areas: {top3_str}."

    if any(w in q for w in ["officer", "deploy", "route", "beat", "patrol"]):
        allocs = _load("officer_deployment.json", [])
        return f"{len(allocs)} patrol routes are active citywide. Use the Routes page for full beat assignments and stop sequences."

    if any(w in q for w in ["ghost"]):
        forecasts = _load("forecast_risk.json", [])
        ghosts = list({f.get("police_station","") for f in forecasts if f.get("is_ghost_violation")})[:3]
        zones = ", ".join(ghosts) or "none detected"
        return f"Ghost violations are zones with prior high activity that suddenly went quiet — possible enforcement displacement or seasonal shift. Current ghost zones: {zones}."

    if any(w in q for w in ["shift", "brief", "summary"]):
        blind_count = sum(1 for h in hotspots if h.get("blind_spot"))
        return (
            f"Shift brief: {len(top3)} critical zones active. Top priority: {top3[0]['police_station']} (EPS {top3[0]['eps_score']:.0%}). "
            f"{blind_count} blind spots need attention. "
            f"Deploy officers to {top3_str.split(';')[0].strip()} first."
        )

    return f"Top 3 enforcement zones: {top3_str}. Ask me about blind spots, EPS scores, patrol routes, parking safety, or ghost violations."


# ── Main entry point ──────────────────────────────────────────────────────────

async def ask_copilot(question: str, role: str, page, user) -> str:
    snapshot  = build_snapshot(role, page, user)
    system    = f"{SYSTEM_PROMPTS.get(role, SYSTEM_PROMPTS['guest'])}\n\nLIVE DATA SNAPSHOT:\n{snapshot}"

    async with httpx.AsyncClient(timeout=20.0) as client:
        # Try Groq first (fastest, most reliable free tier)
        result = await _try_groq(client, question, system)
        if result:
            return result

        # Try Gemini next
        result = await _try_gemini(client, question, system)
        if result:
            return result

    # Both APIs failed — rule-based fallback
    return _rule_based_fallback(question)