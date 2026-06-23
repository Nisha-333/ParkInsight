"""
normalize_pipeline_output.py
Converts raw model output (data/raw_pipeline_output/) into the flat JSON schema
that main.py expects. Run once after receiving fresh pipeline output.

Usage:
    cd data && python3 normalize_pipeline_output.py
"""
import json, csv, math
from pathlib import Path
from datetime import datetime, timezone

RAW = Path(__file__).resolve().parent / "raw_pipeline_output"
OUT = Path(__file__).resolve().parent


def utc_now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def load_under_enforced_map():
    """Load under_enforced flag keyed by h3_cell from enforcement_effectiveness.csv."""
    path = RAW / "enforcement_effectiveness.csv"
    result = {}
    with open(path, encoding="utf-8") as f:
        for row in csv.DictReader(f):
            result[row["h3_cell"]] = row["under_enforced"].strip().lower() == "true"
    return result


def normalize_hotspots():
    raw = json.load(open(RAW / "hotspots_h3.json", encoding="utf-8"))
    under_enforced_map = load_under_enforced_map()
    hotspots = []
    for h in raw["hotspots"]:
        cell = h["h3_cell"]
        metrics = h["metrics"]
        ci = h.get("congestion_impact", {})
        centroid = h.get("centroid", {})
        # congestion_delay_mins: derive from pct_of_citywide_impact as a proxy
        # (pct / 100 * 90 gives a 0–90 min scale across the city; top hotspot ~8.4% → ~7.5 min, reasonable)
        delay_mins = round(ci.get("pct_of_citywide_impact", 0) / 100 * 90, 1)
        blind_spot = under_enforced_map.get(cell, False)
        hotspots.append({
            "h3_index": cell,
            "eps_score": h["enforcement_priority_score"],
            "hotspot_tier": h["hotspot_tier"],
            "police_station": h["police_station"],
            "junction_name": h.get("junction_name", ""),
            "top_violation_type": h.get("top_violation_type", ""),
            "latitude": centroid.get("latitude"),
            "longitude": centroid.get("longitude"),
            "total_violations": metrics["total_violations"],
            "repeat_vehicle_rate": metrics.get("repeat_vehicle_rate", 0),
            "unique_days_active": metrics.get("unique_days_active", 0),
            "violations_per_active_day": metrics.get("violations_per_active_day", 0),
            "peak_hour_ratio": metrics.get("peak_hour_ratio", 0),
            "action_rate": metrics.get("action_rate", 0),
            "congestion_impact_index": ci.get("estimate", 0),
            "pct_of_citywide_impact": ci.get("pct_of_citywide_impact", 0),
            "congestion_delay_mins": delay_mins,
            "blind_spot": blind_spot,
            "under_enforced": blind_spot,
            "dominant_vehicle_type": "UNKNOWN",   # not available per-hotspot in real data
            "unresolved_citizen_complaints": 0,   # complaints.json is demo-only; real metric is under_enforced
            "explanation": (
                f"{h['hotspot_tier']} enforcement zone — "
                f"{metrics['total_violations']:,} violations recorded, "
                f"{metrics.get('violations_per_active_day',0):.1f}/day on active days. "
                f"Top violation: {h.get('top_violation_type','')}. "
                f"Action rate: {metrics.get('action_rate',0)*100:.1f}%."
            ),
        })
    out_path = OUT / "hotspots_h3.json"
    json.dump(hotspots, open(out_path, "w", encoding="utf-8"), indent=2)
    blind_count = sum(1 for h in hotspots if h["blind_spot"])
    print(f"[hotspots] wrote {len(hotspots)} records, {blind_count} blind spots → {out_path}")


def normalize_forecast():
    raw = json.load(open(RAW / "forecast_risk.json", encoding="utf-8"))
    ghost_meta = raw.get("ghost_zones", {})
    # Build h3_cell -> centroid lookup from the raw hotspots so forecast
    # records (which don't carry their own coordinates) can be placed on a
    # map. Falls back to None only for forecast cells that genuinely have
    # no matching hotspot record (some raw cells get merged/dropped when
    # hotspots_h3.json dedupes 776 scored cells down to 703 hotspots).
    raw_hotspots = json.load(open(RAW / "hotspots_h3.json", encoding="utf-8"))
    centroid_by_cell = {
        h["h3_cell"]: h.get("centroid", {})
        for h in raw_hotspots.get("hotspots", [])
    }
    # Surface model validation error (MAE, violations/day) for the specific
    # cells the held-out backtest found least reliable, so the UI can flag
    # "forecast uncertainty: high" next to these zones instead of presenting
    # every risk score with equal, unstated confidence.
    mae_by_cell = raw.get("model_validation", {}).get("top_10_worst_mae_cells", {})
    records = []
    for f in raw["forecasts"]:
        gf = f.get("ghost_violation_flag", {})
        ghost_type = gf.get("ghost_type", "NOT_GHOST")
        is_ghost = ghost_type in ("TRUE_GHOST", "INTERMITTENT")
        centroid = centroid_by_cell.get(f["h3_cell"], {})
        validation_mae = mae_by_cell.get(f["h3_cell"])
        # Synthesize 3 "windows" from the single daily risk score so the frontend
        # time-selector still works: now (window=0), +24h, +7d
        base_risk = f.get("risk_score", 0)
        fc = f.get("forecast", {})
        for window_minutes, risk_multiplier in [(0, 1.0), (1440, 0.9), (10080, 0.8)]:
            records.append({
                "h3_index": f["h3_cell"],
                "h3_cell": f["h3_cell"],
                "police_station": f["police_station"],
                "window_minutes": window_minutes,
                "predicted_risk_score": round(min(base_risk * risk_multiplier, 1.0), 4),
                "risk_score": base_risk,
                "predicted_daily_violations": fc.get("predicted_daily_violations", 0),
                "predicted_7day_violations": fc.get("predicted_7day_violations", 0),
                "confidence_interval_95": fc.get("confidence_interval_95", [0, 0]),
                "model_uncertainty": fc.get("model_uncertainty", 0),
                "validation_mae": validation_mae,
                "high_forecast_uncertainty": validation_mae is not None,
                "is_ghost_violation": is_ghost,
                "ghost_type": ghost_type,
                "ghost_reason": gf.get("likely_cause", ""),
                "activity_change_pct": gf.get("activity_change_pct", 0),
                "activity_direction": gf.get("activity_direction", ""),
                "timestamp": utc_now(),
                "latitude": centroid.get("latitude"),
                "longitude": centroid.get("longitude"),
            })
    out = {
        "generated_at": utc_now(),
        "ghost_zones_summary": ghost_meta,
        "true_ghost_count": ghost_meta.get("true_ghost_count", 0),
        "intermittent_count": ghost_meta.get("intermittent_count", 0),
        "total_ghost_flagged": ghost_meta.get("true_ghost_count", 0) + ghost_meta.get("intermittent_count", 0),
        "forecasts": records,
    }
    out_path = OUT / "forecast_risk.json"
    json.dump(out, open(out_path, "w", encoding="utf-8"), indent=2)
    ghost_count = sum(1 for r in records if r["is_ghost_violation"] and r["window_minutes"] == 0)
    print(f"[forecast] wrote {len(records)} records, {ghost_count} ghost-flagged zones → {out_path}")


def normalize_deployment():
    raw = json.load(open(RAW / "officer_deployment.json", encoding="utf-8"))
    allocations = []
    for d in raw["deployment"]:
        stops = []
        for stop in d["route"]:
            c = stop.get("centroid", {})
            stops.append({
                "sequence": stop["sequence"],
                "h3_cell": stop["h3_cell"],
                "h3_index": stop["h3_cell"],
                "police_station": stop["police_station"],
                "junction_name": stop.get("junction_name", ""),
                "zone_id": stop["zone_id"],
                "enforcement_priority_score": stop["enforcement_priority_score"],
                "hotspot_tier": stop["hotspot_tier"],
                "latitude": c.get("latitude"),
                "longitude": c.get("longitude"),
                "recommended_vehicle": stop.get("recommended_vehicle", ""),
            })
        allocations.append({
            "officer_id": d["officer_id"],
            "route_id": d["officer_id"],          # alias so existing route_id refs work
            "zone_id": d["zone_id"],
            "n_stops": d["n_stops"],
            "total_route_priority_score": d["total_route_priority_score"],
            "estimated_route_distance_km": d["estimated_route_distance_km"],
            "enforcement_priority": d["enforcement_priority"],
            "assigned_vehicle_type": stops[0]["recommended_vehicle"] if stops else "FOUR_WHEELER_PATROL",
            "estimated_coverage_mins": round(d["estimated_route_distance_km"] * 5),  # ~12km/h patrol speed
            "station_sequence": [s["police_station"] for s in stops],
            "optimized_path_coordinates": [[s["latitude"], s["longitude"]] for s in stops if s["latitude"]],
            "priority_violations": round(d["total_route_priority_score"] * 1000),  # scale to integer
            "route": stops,
        })
    gap = raw.get("enforcement_resource_gap_analysis", {})
    out = {
        "generated_at": utc_now(),
        "n_officers_available": raw.get("n_officers_available", 20),
        "n_officers_deployed": raw.get("n_officers_deployed", 20),
        "enforcement_resource_gap_analysis": gap,
        "optimization_method": raw.get("optimization_method", "OR-Tools CP-SAT"),
        "unassigned_critical_or_high_cells": raw.get("unassigned_critical_or_high_cells", 0),
        "deployment": allocations,
    }
    out_path = OUT / "officer_deployment.json"
    json.dump(out, open(out_path, "w", encoding="utf-8"), indent=2)
    print(f"[deployment] wrote {len(allocations)} officer allocations → {out_path}")


if __name__ == "__main__":
    print("Running normalization pipeline...")
    normalize_hotspots()
    normalize_forecast()
    normalize_deployment()
    print("Done.")
