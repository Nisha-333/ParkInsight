# ParkingIntel — Bengaluru Traffic Enforcement Command

AI-driven parking intelligence dashboard. Production-grade prototype over ML notebook outputs.

## Directory Structure

```
parking-intel/
├── data/
│   ├── generate_mock.py        ← Run once to populate JSON files
│   ├── hotspots_h3.json        ← (generated) H3 clusters + EPS scores
│   ├── forecast_risk.json      ← (generated) 30-min risk forecast + ghost violations
│   └── officer_deployment.json ← (generated) optimized patrol routes
├── backend/
│   ├── main.py                 ← FastAPI server (reads data/ directly)
│   └── requirements.txt
└── frontend/
    └── public/
        └── index.html          ← Single-file dashboard (zero npm, CDN-only)
```

## Quick Start

### Step 1 — Install backend dependencies
```bash
cd backend
pip install -r requirements.txt
```

### Step 2 — Generate mock data
```bash
cd ..         # back to parking-intel/
python3 data/generate_mock.py
```

> **From your ML notebook:** write outputs directly to:
> - `data/hotspots_h3.json`
> - `data/forecast_risk.json`
> - `data/officer_deployment.json`
>
> The backend reads these files on each request. No restart needed.

### Step 3 — Start the backend
```bash
cd backend
uvicorn main:app --reload --port 8000
```

Dashboard: http://localhost:8000  
Swagger:   http://localhost:8000/docs  
Health:    http://localhost:8000/api/v1/health

### Step 4 (optional) — Frontend hot-reload dev mode
```bash
cd frontend/public
python3 -m http.server 3000
```
Then update `const API = 'http://localhost:8000'` at the top of `index.html`.

---

## API Reference

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/dashboard/summary` | KPIs: gridlock cost, blind spots, ghost violations |
| GET | `/api/v1/hotspots` | H3 clusters with EPS scores and AI explanations |
| GET | `/api/v1/forecast` | 30-min risk forecast + ghost violation flags |
| GET | `/api/v1/allocations` | Optimized patrol routes by vehicle type |
| GET | `/api/v1/congestion-zones` | Ultra-low latency public rerouting API |
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
  "confidence_interval": {"lower": 0.73, "upper": 0.89}
}
```

### officer_deployment.json
```json
{
  "route_id": "ROUTE-01",
  "officer_id": "OFF-0017",
  "officers_count": 2,
  "station_sequence": ["Upparpet", "Shivajinagar", "City Market"],
  "optimized_path_coordinates": [[77.577, 12.976], [77.607, 12.982], [77.577, 12.964]],
  "assigned_vehicle_type": "TOWING TRUCK",
  "shift_priority": "Immediate",
  "estimated_coverage_mins": 38,
  "total_route_km": 4.2,
  "avg_eps_score": 0.87,
  "explanation_text": "Route optimized for MAXI-CAB cluster dominance..."
}
```
