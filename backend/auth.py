"""
auth.py — minimal, dependency-free auth for ParkingIntel
─────────────────────────────────────────────────────────────────────────────
- Passwords: PBKDF2-HMAC-SHA256 (stdlib `hashlib`), random salt per user.
- Sessions: JWT (HS256), implemented with stdlib `hmac`/`hashlib`/`base64`
  so we don't need a new pip dependency. Tokens expire after TOKEN_TTL_HOURS.
- Roles: guest (no account) | citizen (self-signup) | police (admin-seeded
  only — cannot self-register) | admin (seeded only).
"""
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
from pathlib import Path

from fastapi import Header, HTTPException

DATA_DIR = Path(__file__).resolve().parent.parent / "data"
USERS_FILE = DATA_DIR / "users.json"

JWT_SECRET = os.environ.get("JWT_SECRET_KEY", "change-this-in-production")
TOKEN_TTL_HOURS = 12
PBKDF2_ITERATIONS = 200_000

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


# ── user store ─────────────────────────────────────────────────────────────
def _load_users():
    if not USERS_FILE.exists():
        return []
    with open(USERS_FILE, encoding="utf-8") as f:
        return json.load(f)


def _save_users(users):
    with open(USERS_FILE, "w", encoding="utf-8") as f:
        json.dump(users, f, indent=2)


def find_user(email: str):
    email = email.lower().strip()
    return next((u for u in _load_users() if u["email"] == email), None)


def find_user_by_id(user_id: str):
    return next((u for u in _load_users() if u["user_id"] == user_id), None)


# ── password hashing ─────────────────────────────────────────────────────────
def hash_password(password: str, salt: str | None = None):
    salt = salt or secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), PBKDF2_ITERATIONS)
    return salt, base64.b64encode(dk).decode()


def verify_password(password: str, salt: str, expected_hash: str) -> bool:
    _, computed = hash_password(password, salt)
    return hmac.compare_digest(computed, expected_hash)


def validate_password_strength(password: str):
    if len(password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters.")
    if not re.search(r"[A-Za-z]", password) or not re.search(r"[0-9]", password):
        raise HTTPException(400, "Password must contain both letters and numbers.")


# ── JWT (HS256, stdlib only) ──────────────────────────────────────────────────
def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _b64url_decode(s: str) -> bytes:
    padding = "=" * (-len(s) % 4)
    return base64.urlsafe_b64decode(s + padding)


def create_token(user: dict) -> str:
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "user_id": user["user_id"],
        "email": user["email"],
        "role": user["role"],
        "name": user["name"],
        "exp": int(time.time()) + TOKEN_TTL_HOURS * 3600,
        "iat": int(time.time()),
    }
    segments = [_b64url(json.dumps(header).encode()), _b64url(json.dumps(payload).encode())]
    signing_input = ".".join(segments).encode()
    sig = hmac.new(JWT_SECRET.encode(), signing_input, hashlib.sha256).digest()
    segments.append(_b64url(sig))
    return ".".join(segments)


def decode_token(token: str) -> dict:
    try:
        header_b64, payload_b64, sig_b64 = token.split(".")
        signing_input = f"{header_b64}.{payload_b64}".encode()
        expected_sig = hmac.new(JWT_SECRET.encode(), signing_input, hashlib.sha256).digest()
        if not hmac.compare_digest(_b64url(expected_sig), sig_b64):
            raise HTTPException(401, "Invalid token signature.")
        payload = json.loads(_b64url_decode(payload_b64))
        if payload.get("exp", 0) < time.time():
            raise HTTPException(401, "Session expired. Please log in again.")
        return payload
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(401, "Invalid or malformed token.")


# ── FastAPI dependencies ──────────────────────────────────────────────────────
def get_current_user(authorization: str | None = Header(default=None)) -> dict:
    """Requires a valid Bearer token. Use for any citizen/police/admin-only route."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Missing or malformed Authorization header.")
    token = authorization.removeprefix("Bearer ").strip()
    return decode_token(token)


def optional_user(authorization: str | None = Header(default=None)) -> dict | None:
    """Returns the decoded user if a valid token is present, else None (for guest-aware routes)."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    try:
        return decode_token(authorization.removeprefix("Bearer ").strip())
    except HTTPException:
        return None


# ── seeding ──────────────────────────────────────────────────────────────────
def seed_default_accounts():
    """Creates the initial admin + one demo police account on first run only.
    Police accounts can ONLY be created this way or via /api/v1/admin/officers
    (admin-only endpoint) — there is no public police signup."""
    users = _load_users()
    if users:
        return
    admin_salt, admin_hash = hash_password("Admin@2024")
    police_salt, police_hash = hash_password("Police@2024")
    users = [
        {
            "user_id": "USR_ADMIN_01", "email": "admin@parkinsight.ai",
            "name": "Commissioner Venkat R.", "role": "admin",
            "salt": admin_salt, "password_hash": admin_hash,
            "assigned_unit": "BBMP Traffic Command", "status": "active",
        },
        {
            "user_id": "USR_994821", "email": "ramesh.kumar@bengalurupolice.gov.in",
            "name": "Ramesh Kumar", "role": "police",
            "salt": police_salt, "password_hash": police_hash,
            "assigned_unit": "Madiwala Traffic Police Station",
            "vehicle_access": "TOW_TRUCK_LIGHT", "route_id": "ROUTE-0",
            "status": "active",
        },
    ]
    _save_users(users)
    print("[auth] Seeded default admin (admin@parkinsight.ai / Admin@2024) "
          "and demo police (ramesh.kumar@bengalurupolice.gov.in / Police@2024). "
          "CHANGE THESE PASSWORDS before any real deployment.")
