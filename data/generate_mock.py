"""
ParkingIntel — Mock Data Generator
Generates production-grade JSON files that simulate ML notebook outputs.
All data grounded in real Bengaluru geography, station names, and violation statistics.

Usage:
    python3 data/generate_mock.py

Outputs (written to data/ directory):
    hotspots_h3.json
    forecast_risk.json
    officer_deployment.json
"""
import json, random, math, hashlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

random.seed(42)
OUTPUT_DIR = Path(__file__).resolve().parent

# ══════════════════════════════════════════════════════════════════════════════
# REFERENCE DATA  (grounded in real Bengaluru enforcement records)
# ══════════════════════════════════════════════════════════════════════════════

STATIONS = [
    # name, lat, lon, historical_violations, zone_type
    ("Upparpet",          12.9767, 77.5774, 34468, "commercial"),
    ("Shivajinagar",      12.9821, 77.6070, 28044, "mixed"),
    ("Malleshwaram",      13.0055, 77.5598, 22200, "residential_commercial"),
    ("HAL Old Airport",   12.9434, 77.6968, 20819, "transit"),
    ("City Market",       12.9645, 77.5771, 17646, "commercial"),
    ("Vijayanagara",      12.9778, 77.5428, 14652, "residential"),
    ("Rajajinagar",       12.9986, 77.5486, 10998, "mixed"),
    ("Kodigehalli",       13.0603, 77.5863, 10916, "residential"),
    ("Magadi Road",       12.9749, 77.5537,  8558, "arterial"),
    ("Jeevanbheemanagar", 12.9684, 77.6470,  6736, "residential"),
    ("Koramangala",       12.9355, 77.6245,  5200, "it_commercial"),
    ("Bellandur",         12.9252, 77.6780,  4100, "it_commercial"),
    ("Outer Ring Road",   12.9343, 77.6901,  3950, "arterial"),
    ("Madiwala",          12.9235, 77.6185,  3700, "commercial"),
    ("Whitefield",        12.9698, 77.7499,  3800, "it_commercial"),
    ("Electronic City",   12.8452, 77.6602,  3200, "it_commercial"),
    ("Yelahanka",         13.1004, 77.5963,  2900, "residential"),
    ("HSR Layout",        12.9116, 77.6389,  2600, "residential_commercial"),
    ("Jayanagar",         12.9252, 77.5938,  2400, "residential_commercial"),
    ("Indiranagar",       12.9784, 77.6408,  2200, "mixed"),
]

VEHICLE_TYPES   = ["CAR", "SCOOTER", "MOTOR CYCLE", "PASSENGER AUTO", "MAXI-CAB", "LGV", "GOODS AUTO", "BUS"]
VEHICLE_WEIGHTS = [0.290, 0.310, 0.137, 0.120, 0.048, 0.030, 0.010, 0.055]

JUNCTIONS = [
    "Silk Board Junction", "KR Puram Junction", "Marathahalli Bridge",
    "Hebbal Flyover", "Tin Factory", "Madiwala Checkpost",
    "Koramangala 80ft Road", "Outer Ring Road-Bellandur", "No Junction",
    "Ejipura Junction", "Richmond Circle", "Trinity Circle",
    "Bannerghatta Road", "Sarjapur Road Junction",
]

VIOLATION_TYPES = [
    "WRONG PARKING", "PARKING IN NO PARKING ZONE", "DOUBLE PARKING",
    "BLOCKING ENTRANCE", "PARKING ON FOOTPATH", "PARKING ON BUS STOP",
    "PARKING IN BUS BAY", "NO PARKING ZONE",
]

LIFECYCLES = ["Escalating", "Stable", "Declining", "Emerging", "Volatile"]
LIFECYCLE_WEIGHTS = [0.15, 0.40, 0.20, 0.15, 0.10]

EFF_TIERS = ["Highly Effective", "Effective", "Moderate", "Ineffective"]

EXPLANATION_TEMPLATES = [
    ("commercial", [
        "High commercial footfall in {zone} creates sustained double-parking. "
        "Dominant vehicle: {veh}. Congestion delay ~{delay:.0f} mins during peak hours (07:00–10:00, 16:00–21:00). "
        "EPS elevated by persistent junction activity ({jn}) and {complaints} unresolved citizen complaints.",

        "Market cluster with chronic wrong-parking in {zone}. MAXI-CAB and {veh} overstay "
        "creates ~{delay:.0f}-min bottleneck. Recurrence across all 5 months signals structural enforcement gap. "
        "Validation rate: {val_rate:.0%} — {complaints} complaints remain unactioned.",
    ]),
    ("it_commercial", [
        "IT corridor peak-hour overflow in {zone}. Vehicles spilling onto service road "
        "and blocking bus bays. {veh} dominance during 09:00–10:30 and 18:00–20:00. "
        "EPS={eps:.2f}. Towing truck deployment recommended for LGV clusters.",

        "Bellandur–{zone} corridor: informal parking on footpath and entrance blockage. "
        "{veh} clusters during shift-change windows. {complaints} open complaints, "
        "validation rate {val_rate:.0%} — blind spot flagged.",
    ]),
    ("arterial", [
        "Arterial road misuse in {zone}. Vehicles parked on {jn} approach reducing "
        "effective carriageway. Congestion shadow extends ~400m upstream during peak. "
        "Delay estimate: {delay:.0f} mins. Ghost violations detected in adjacent H3 cell.",

        "Outer Ring Road segment near {zone}: persistent blocking of bus bay and emergency lane. "
        "{veh} and GOODS AUTO overstay flagged. EPS={eps:.2f}, recurrence in 5/5 months.",
    ]),
    ("transit", [
        "Transit zone enforcement gap at {zone}. Metro station proximity drives "
        "kiss-and-ride overstay. Challan closure rate: {val_rate:.0%}. "
        "{complaints} unresolved — citizen accountability blind spot.",

        "{zone} transit cluster: MAXI-CAB and {veh} dominate. Peak congestion "
        "08:00–09:30. {jn} proximity amplifies risk. EPS={eps:.2f}.",
    ]),
    ("mixed", [
        "Mixed-use zone {zone}: residential spillover + commercial loading zone conflicts. "
        "{veh} accounts for majority of violations. {complaints} open complaints. "
        "Enforcement response score indicates {eff} outcomes historically.",

        "{zone} enforcement zone: mid-block and junction violations ({jn}). "
        "Temporal density {td:.1f} violations/active week. Peak concentration {pk:.0%}.",
    ]),
    ("residential_commercial", [
        "School/hospital zone spillover in {zone} during morning hours (08:00–09:30). "
        "Recurrence across consecutive weeks detected. {veh} cluster near {jn}. "
        "{complaints} complaints, validation rate {val_rate:.0%}.",

        "Narrow lane commercial cluster in {zone}. 4-wheeler dominance with MAXI-CAB "
        "overstay creating bottleneck near {jn}. Delay: {delay:.0f} mins. "
        "EPS={eps:.2f}, persistence {persist:.0%}.",
    ]),
    ("residential", [
        "Residential zone {zone}: weekend spike violations. {veh} clusters near {jn}. "
        "Low officer presence detected — blind spot risk. "
        "{complaints} complaints unresolved.",

        "Low-enforcement residential pocket in {zone}. High recurrence ({recur:.0%} of months) "
        "despite moderate violation count suggests systematic under-patrolling.",
    ]),
]


def make_h3_index(i: int, lat: float, lon: float) -> str:
    """Generate a deterministic plausible-looking H3 index."""
    seed = f"{i}{lat:.4f}{lon:.4f}"
    h = hashlib.md5(seed.encode()).hexdigest()
    return f"8b{h[:14]}ff"


def pick_explanation(zone_type, veh, jn, eps, delay, complaints, val_rate, persist, recur, td, pk, eff):
    templates = dict(EXPLANATION_TEMPLATES).get(zone_type, EXPLANATION_TEMPLATES[4][1])
    tmpl = random.choice(templates if isinstance(templates, list) else [templates])
    return tmpl.format(
        zone=random.choice(["this zone", "the area", "this cluster"]),
        veh=veh, jn=jn, eps=eps, delay=delay, complaints=complaints,
        val_rate=val_rate, persist=persist, recur=recur, td=td, pk=pk, eff=eff,
    )


# ══════════════════════════════════════════════════════════════════════════════
# GENERATE hotspots_h3.json
# ══════════════════════════════════════════════════════════════════════════════
def generate_hotspots():
    hotspots = []
    for i, (name, base_lat, base_lon, hist_count, zone_type) in enumerate(STATIONS):
        # Small jitter so each hex is distinct
        lat = round(base_lat + random.uniform(-0.004, 0.004), 6)
        lon = round(base_lon + random.uniform(-0.004, 0.004), 6)

        violations = hist_count + random.randint(-300, 300)
        eps = round(min(0.97, max(0.35, 0.42 + (violations / 38000) * 0.55 + random.gauss(0, 0.04))), 3)
        delay = round(random.uniform(6, 44), 1)
        complaints = random.randint(10, 290)
        val_rate = round(random.uniform(0.14, 0.72), 3)
        persist = round(random.uniform(0.3, 1.0), 3)
        recur = round(random.uniform(0.4, 1.0), 3)
        peak_conc = round(random.uniform(0.3, 0.75), 3)
        td = round(violations / max(1, random.randint(12, 22)), 1)
        dom_veh = random.choices(VEHICLE_TYPES, VEHICLE_WEIGHTS)[0]
        jn = random.choice(JUNCTIONS)
        lc = random.choices(LIFECYCLES, LIFECYCLE_WEIGHTS)[0]
        eff = random.choices(EFF_TIERS, [0.15, 0.35, 0.30, 0.20])[0]
        num_violations_list = random.randint(1, 3)
        viol_list = random.sample(VIOLATION_TYPES, num_violations_list)

        blind_spot = complaints > 130 and val_rate < 0.40 and eps < 0.72

        expl = pick_explanation(zone_type, dom_veh, jn, eps, delay, complaints,
                                val_rate, persist, recur, td, peak_conc, eff)

        hotspots.append({
            "h3_index"                    : make_h3_index(i, lat, lon),
            "latitude"                    : lat,
            "longitude"                   : lon,
            "eps_score"                   : eps,
            "eps_tier"                    : (
                "A – Critical" if eps >= 0.75 else
                "B – High"     if eps >= 0.55 else
                "C – Moderate" if eps >= 0.35 else
                "D – Low"
            ),
            "hotspot_rank"                : i + 1,            # re-ranked after sort
            "total_violations"            : violations,
            "congestion_delay_mins"       : delay,
            "persistence"                 : persist,
            "recurrence"                  : recur,
            "peak_concentration"          : peak_conc,
            "temporal_density"            : td,
            "dominant_vehicle_type"       : dom_veh,
            "violation_types"             : viol_list,
            "police_station"              : name,
            "junction_name"               : jn,
            "zone_type"                   : zone_type,
            "lifecycle"                   : lc,
            "unresolved_citizen_complaints": complaints,
            "validation_rate"             : val_rate,
            "enforcement_effectiveness"   : eff,
            "blind_spot"                  : blind_spot,
            "explanation"                 : expl,
        })

    hotspots.sort(key=lambda x: -x["eps_score"])
    for rank, h in enumerate(hotspots, 1):
        h["hotspot_rank"] = rank

    return hotspots


# ══════════════════════════════════════════════════════════════════════════════
# GENERATE forecast_risk.json
# ══════════════════════════════════════════════════════════════════════════════
def generate_forecast(hotspots):
    forecasts = []
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    windows = [0, 5, 10, 15, 20, 25]  # 30-min horizon in 5-min steps

    GHOST_REASONS = [
        "Sudden speed drop >40% detected in adjacent H3 cell — possible unreported blockage.",
        "Violation spike without officer log entry — discrepancy flagged by anomaly detector.",
        "Citizen report cluster without corresponding challan — enforcement gap detected.",
        "Traffic probe data shows queuing; no active enforcement record for this H3 cell.",
        "H3 cell violation rate 3× baseline with zero officer check-ins in last 90 minutes.",
    ]

    for hs in hotspots[:15]:  # forecast for top 15 hotspots
        base_risk = hs["eps_score"]

        for w in windows:
            ts = now + timedelta(minutes=w)

            # Risk decays slightly or fluctuates over 30-min horizon
            noise = random.gauss(0, 0.05)
            decay = -0.008 * w  # slight decay over time
            risk = round(min(1.0, max(0.0, base_risk + noise + decay)), 3)

            # Ghost violation: anomalous spike with no officer log
            is_ghost = (
                risk >= 0.65
                and w <= 10
                and random.random() < 0.18
                and hs.get("blind_spot", False)
            )

            forecasts.append({
                "h3_index"              : hs["h3_index"],
                "police_station"        : hs["police_station"],
                "latitude"              : hs["latitude"],
                "longitude"             : hs["longitude"],
                "timestamp"             : ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
                "window_minutes"        : w,
                "predicted_risk_score"  : risk,
                "risk_tier"             : (
                    "CRITICAL" if risk >= 0.85 else
                    "HIGH"     if risk >= 0.70 else
                    "MEDIUM"   if risk >= 0.50 else
                    "LOW"
                ),
                "dominant_vehicle_type" : hs["dominant_vehicle_type"],
                "eps_score"             : hs["eps_score"],
                "is_ghost_violation"    : is_ghost,
                "ghost_reason"          : random.choice(GHOST_REASONS) if is_ghost else None,
                "model"                 : "LightGBM+CatBoost 55/45 blend",
                "confidence_interval"   : {
                    "lower": round(max(0.0, risk - 0.08), 3),
                    "upper": round(min(1.0, risk + 0.08), 3),
                },
            })

    return forecasts


# ══════════════════════════════════════════════════════════════════════════════
# GENERATE officer_deployment.json
# ══════════════════════════════════════════════════════════════════════════════
def generate_deployment(hotspots):
    allocations = []

    # Group hotspots into patrol routes (3 zones per route)
    critical = [h for h in hotspots if h["eps_tier"] == "A – Critical"]
    high     = [h for h in hotspots if h["eps_tier"] == "B – High"]
    combined = (critical + high)[:18]  # max 6 routes × 3 zones

    VEHICLE_OPTIONS = ["TOWING TRUCK", "PATROL CAR", "TWO-WHEELER", "PATROL CAR", "PATROL CAR", "TOWING TRUCK"]
    PRIORITIES = ["Immediate", "Immediate", "Next shift", "Next shift", "Standby", "Standby"]

    for route_id in range(min(6, len(combined) // 3)):
        cluster = combined[route_id * 3: route_id * 3 + 3]
        if not cluster:
            continue

        dom_vehs = [h["dominant_vehicle_type"] for h in cluster]
        dom = max(set(dom_vehs), key=dom_vehs.count)
        assigned_veh = (
            "TOWING TRUCK" if dom in ("MAXI-CAB", "LGV", "GOODS AUTO", "BUS")
            else VEHICLE_OPTIONS[route_id]
        )

        officers = 2 if cluster[0]["eps_tier"] == "A – Critical" else 1
        avg_eps  = round(sum(h["eps_score"] for h in cluster) / len(cluster), 3)
        priority = PRIORITIES[route_id]

        # Waypoints: start at first zone, route through others
        path_coords = [[h["longitude"], h["latitude"]] for h in cluster]

        # Haversine distance proxy for estimated patrol time
        def haversine(lat1, lon1, lat2, lon2):
            R = 6371
            dlat = math.radians(lat2 - lat1)
            dlon = math.radians(lon2 - lon1)
            a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1))*math.cos(math.radians(lat2))*math.sin(dlon/2)**2
            return 2 * R * math.asin(math.sqrt(a))

        total_km = sum(
            haversine(cluster[j]["latitude"], cluster[j]["longitude"],
                      cluster[j+1]["latitude"], cluster[j+1]["longitude"])
            for j in range(len(cluster)-1)
        )
        est_mins = round(total_km * 4.5 + len(cluster) * 8 + random.uniform(-3, 6))  # 4.5 min/km + dwell

        expl = (
            f"Route optimized for {dom} cluster dominance across {len(cluster)} zones. "
            f"{assigned_veh} assigned — matched to vehicle type mix. "
            f"Zones: {', '.join(h['police_station'] for h in cluster)}. "
            f"Combined avg EPS={avg_eps}. "
            f"Estimated patrol window: {est_mins} mins. "
            f"Priority: {priority}. "
            f"{'Towing unit pre-positioned for expected heavy-vehicle removal.' if 'TOWING' in assigned_veh else 'Standard patrol with challan authority.'}"
        )

        allocations.append({
            "route_id"                 : f"ROUTE-{route_id+1:02d}",
            "officer_id"               : f"OFF-{(route_id+1)*17:04d}",
            "officers_count"           : officers,
            "h3_cluster_sequence"      : [h["h3_index"] for h in cluster],
            "station_sequence"         : [h["police_station"] for h in cluster],
            "optimized_path_coordinates": path_coords,
            "assigned_vehicle_type"    : assigned_veh,
            "shift_priority"           : priority,
            "estimated_coverage_mins"  : int(est_mins),
            "total_route_km"           : round(total_km, 2),
            "priority_violations"      : sum(h["total_violations"] for h in cluster),
            "avg_eps_score"            : avg_eps,
            "dominant_vehicle_type"    : dom,
            "zone_types"               : list({h["zone_type"] for h in cluster}),
            "explanation_text"         : expl,
            "zone_details"             : [
                {
                    "police_station" : h["police_station"],
                    "h3_index"       : h["h3_index"],
                    "eps_score"      : h["eps_score"],
                    "eps_tier"       : h["eps_tier"],
                    "latitude"       : h["latitude"],
                    "longitude"      : h["longitude"],
                    "violations"     : h["total_violations"],
                    "delay_mins"     : h["congestion_delay_mins"],
                    "blind_spot"     : h.get("blind_spot", False),
                }
                for h in cluster
            ],
        })

    return allocations


# ══════════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    print("ParkingIntel Mock Data Generator")
    print("=" * 45)

    hotspots    = generate_hotspots()
    forecasts   = generate_forecast(hotspots)
    allocations = generate_deployment(hotspots)

    files = {
        "hotspots_h3.json"       : hotspots,
        "forecast_risk.json"     : forecasts,
        "officer_deployment.json": allocations,
    }

    for fname, data in files.items():
        path = OUTPUT_DIR / fname
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"  ✓ {fname:<28} {len(data):>4} records  →  {path}")

    print()
    blind = sum(1 for h in hotspots if h["blind_spot"])
    ghost = sum(1 for f in forecasts if f["is_ghost_violation"])
    print(f"  Hotspots       : {len(hotspots)} zones | {sum(1 for h in hotspots if h['eps_tier']=='A – Critical')} Critical")
    print(f"  Blind spots    : {blind}")
    print(f"  Ghost violations: {ghost}")
    print(f"  Patrol routes  : {len(allocations)}")
    print()
    print("  Done. Start the backend: cd backend && uvicorn main:app --reload --port 8000")
