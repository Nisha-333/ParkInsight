/* ════════════════════════════════════════════════════════════════════════
   ADMIN-OTHER.JS — EPS Rankings table, Risk Forecast, Officer Routing map,
   Config & Export page
   ════════════════════════════════════════════════════════════════════════ */

// ── EPS TABLE ─────────────────────────────────────────────────────────────────
function renderAdminEPS(c){
  c.innerHTML=`<div class="page active"><div class="panel">
    <div class="panel-title">📊 Enforcement Priority Score Rankings</div>
    <div style="font-size:11px;color:var(--text2);background:var(--panel2);border:1px solid var(--border);border-radius:7px;padding:9px 13px;margin-bottom:12px;line-height:1.7">
      <b>Real EPS formula (LightGBM+CatBoost pipeline):</b> violation volume <b>35%</b> · daily persistence <b>20%</b> · peak-hour concentration <b>15%</b> · junction proximity <b>20%</b> · repeat-offender rate <b>10%</b>.
      Tiers are <b>percentile-based</b>: CRITICAL = top 3%, HIGH = top 15%, MEDIUM = top 40%. Citizen complaints are <b>not</b> part of the EPS formula.
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
      <div style="background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:12px">
        <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">🔬 Two-Stage DBSCAN Validation</div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <div style="background:var(--surface);border-radius:6px;padding:8px 10px">
            <div style="font-size:10px;color:var(--muted);margin-bottom:2px">Stage A — Point-level (~100 m radius)</div>
            <div style="font-size:13px;font-weight:800;color:var(--accent)">733 clusters</div>
            <div style="font-size:10px;color:var(--text2);margin-top:2px">from 298,445 raw records · each = one block-level parking pocket</div>
          </div>
          <div style="background:var(--surface);border-radius:6px;padding:8px 10px">
            <div style="font-size:10px;color:var(--muted);margin-bottom:2px">Stage B — Centroid-level (~550 m, H3 cells)</div>
            <div style="font-size:13px;font-weight:800;color:var(--accent)">137 patrol-zone clusters</div>
            <div style="font-size:10px;color:var(--text2);margin-top:2px">from 776 H3 cell centroids · silhouette = <b style="color:var(--accent)">0.6983</b> &gt; 0.5 → strong geographic structure</div>
          </div>
        </div>
        <div style="font-size:10px;color:var(--muted);margin-top:8px;padding-top:6px;border-top:1px solid var(--border)">Silhouette range −1 to 1. &gt;0.5 confirms hotspots form real geographic clusters, not random scatter. Production upgrade: switch to haversine metric for exact radii.</div>
      </div>
      <div style="background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:12px">
        <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">📐 EPS Weight Sensitivity</div>
        <div style="display:flex;flex-direction:column;gap:5px">
          ${[['Baseline (current)','vol 35 · persist 20 · peak 15 · jxn 20 · repeat 10','1.0000','var(--accent)'],['Junction-heavy','vol 25 · persist 15 · peak 10 · jxn 40 · repeat 10','0.9956','var(--text)'],['Volume-heavy','vol 50 · persist 15 · peak 10 · jxn 15 · repeat 10','0.9957','var(--text)'],['Peak-hour-heavy','vol 25 · persist 20 · peak 35 · jxn 10 · repeat 10','0.9699','var(--text)']].map(([name,weights,corr,col])=>`
          <div style="background:var(--surface);border-radius:5px;padding:7px 9px;display:flex;align-items:center;justify-content:space-between;gap:8px">
            <div style="flex:1;min-width:0"><div style="font-size:11px;font-weight:600;color:${col}">${name}</div><div style="font-size:9px;color:var(--muted);margin-top:1px">${weights}</div></div>
            <div style="font-size:13px;font-weight:800;color:${col};font-family:var(--mono);flex-shrink:0">ρ ${corr}</div>
          </div>`).join('')}
        </div>
        <div style="font-size:10px;color:var(--muted);margin-top:8px;padding-top:6px;border-top:1px solid var(--border)">Rank correlation vs baseline ≥ 0.96 across all schemes — top hotspots are stable regardless of weight choices. Values &lt; 0.90 would indicate sensitivity requiring recalibration.</div>
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
      <select id="eps-sort" onchange="filterEPS()" style="background:var(--panel2);border:1px solid var(--border);color:var(--text);padding:7px 12px;border-radius:7px;font-size:12px;font-family:var(--font)">
        <option value="eps">Sort: EPS Score</option>
        <option value="violations">Sort: Total Violations</option>
        <option value="action_rate">Sort: Action Rate</option>
        <option value="delay">Sort: Congestion Proxy</option>
      </select>
      <label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--text2);cursor:pointer">
        <input type="checkbox" id="eps-blind" onchange="filterEPS()" style="width:auto"> Under-enforced Only
      </label>
    </div>
    <div class="tbl-wrap"><table><thead><tr><th>#</th><th>Zone</th><th>EPS / Tier</th><th>Violations</th><th>Action Rate</th><th>Congestion Proxy</th><th>Top Violation</th><th>Under-enforced</th><th>AI Explanation</th></tr></thead><tbody id="eps-tbody"></tbody></table></div>
  </div></div>`;
  filterEPS();
}
function filterEPS(){
  const srt=document.getElementById('eps-sort')?.value||'eps';
  const blind=document.getElementById('eps-blind')?.checked;
  const sm={eps:'eps_score',violations:'total_violations',action_rate:'action_rate',delay:'congestion_delay_mins'};
  let data=[..._hotspots];
  if(blind) data=data.filter(h=>h.blind_spot||h.under_enforced);
  data.sort((a,b)=>b[sm[srt]]-a[sm[srt]]);
  const tb=document.getElementById('eps-tbody');if(!tb) return;
  tb.innerHTML=data.map((h,i)=>{
    const col=epsColorHex(h.eps_score);
    const tier=h.hotspot_tier||'';
    const tierTag=tier==='CRITICAL'?'<span class="tag critical">CRITICAL</span>':tier==='HIGH'?'<span class="tag med">HIGH</span>':tier==='MEDIUM'?'<span class="tag low">MED</span>':'<span class="tag low">LOW</span>';
    const bs=h.blind_spot?'<span class="tag blind" style="margin-left:3px">UNDER-ENF</span>':'';
    const ar=(h.action_rate||0)*100;
    const arCol=ar<30?'var(--danger)':ar<60?'var(--warn)':'var(--accent)';
    return `<tr><td style="color:var(--muted);font-size:11px">${i+1}</td><td><b>${h.police_station}</b><div style="font-size:10px;color:var(--muted)">${h.junction_name||''}</div></td><td>${tierTag}${bs}<div class="eps-bar"><div class="eps-fill" style="width:${h.eps_score*100}%;background:${col}"></div></div><span style="font-size:11px;color:${col};font-family:var(--mono)">${(h.eps_score*100).toFixed(1)}</span></td><td>${(h.total_violations||0).toLocaleString()}</td><td style="color:${arCol};font-weight:600">${ar.toFixed(1)}%</td><td style="font-size:11px;color:var(--text2)">${(h.congestion_delay_mins||0).toFixed(1)}m proxy<div style="font-size:10px;color:var(--muted)">${(h.pct_of_citywide_impact||0).toFixed(2)}% citywide</div></td><td style="font-size:11px;font-family:var(--mono)">${h.top_violation_type||'—'}</td><td style="text-align:center">${(h.blind_spot||h.under_enforced)?'<span style="color:var(--warn);font-weight:700">⚠ Yes</span>':'<span style="color:var(--accent)">✓ No</span>'}</td><td style="font-size:11px;color:var(--text2);max-width:240px;line-height:1.5">${h.explanation||''}</td></tr>`;
  }).join('');
}

// ── RISK FORECAST ─────────────────────────────────────────────────────────────
function renderAdminForecast(c){
  const ghosts=_forecasts.filter(f=>f.is_ghost_violation&&f.window_minutes===0);
  const trueGhosts=_forecasts.filter(f=>f.ghost_type==='TRUE_GHOST'&&f.window_minutes===0);
  const intermittent=_forecasts.filter(f=>f.ghost_type==='INTERMITTENT'&&f.window_minutes===0);
  c.innerHTML=`<div class="page active">
    <div class="panel">
      <div class="panel-title">⚡ 7-Day Violation Risk Forecast</div>
      <div style="font-size:11px;color:var(--text2);background:var(--panel2);border:1px solid var(--border);border-radius:7px;padding:9px 13px;margin-bottom:12px;line-height:1.7">
        <b>Real model:</b> LightGBM + CatBoost ensemble trained on Jan–May 2024 data, predicting per-H3-cell risk for the current window. Each police zone contains several H3 cells, so the score shown is a <b>violation-weighted average</b> across that zone's cells — not a single cell's score — and daily totals are <b>summed</b> across the zone. Windows: <b>Now</b> (model output, current), <b>+24h</b> (model output, next-day). <b>+7d is a rough estimate</b> — a fixed decay applied to the current score, not a separate model prediction (the source model treats 7-day forecasting as a stretch feature, not the core deliverable).
      </div>
      ${trueGhosts.length||intermittent.length?`<div class="alert-card ghost" style="margin-bottom:14px"><div class="alert-z" style="color:var(--purple)">👻 ${trueGhosts.length} True Ghost Zones + ${intermittent.length} Intermittent</div><div class="alert-m">True ghosts: prior_avg ≥ 1.0 viol/day + ≥5 active days in prior window, but <b>zero</b> recent activity — genuine enforcement blind spots. Intermittent: sporadic recent activity, possible seasonal variation.</div></div>`:''}
      <div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap" id="win-btns">
        ${[['all','All Windows'],['0','Now (risk score)'],['1440','+24h (next day)'],['10080','+7 days (est.)']].map(([w,label],i)=>`<button class="sub-tab${i===0?' active':''}" onclick="selWin(this,${w==='all'?'"all"':w})">${label}</button>`).join('')}
      </div>
      <div class="fc-grid" id="fc-cards"></div>
    </div>
  </div>`;
  renderFcCards('all');
}
function selWin(btn,w){document.querySelectorAll('#win-btns .sub-tab').forEach(b=>b.classList.remove('active'));btn.classList.add('active');renderFcCards(w);}

// Aggregates the many H3 cells that make up a police_station zone into one
// honest zone-level figure for a given window. Previously this code picked
// whichever single cell had the highest predicted_risk_score and displayed
// it as the zone's score — which is how a zone could show "100/100" off one
// outlier hexagon while its other cells sat near 0.4. Risk score is now a
// violation-weighted average (so one extreme cell can't dominate a zone with
// many calmer cells); violation counts are summed, since those are real
// per-cell counts that genuinely add up across a zone.
function aggregateForecastByStation(records){
  const byStation = new Map();
  records.forEach(f=>{
    if(!byStation.has(f.police_station)) byStation.set(f.police_station, []);
    byStation.get(f.police_station).push(f);
  });
  const out = [];
  byStation.forEach((cells, station)=>{
    const totalDaily = cells.reduce((s,c)=>s+(c.predicted_daily_violations||0),0);
    const totalWeek  = cells.reduce((s,c)=>s+(c.predicted_7day_violations||0),0);
    // Weight each cell's risk score by its own violation volume so a single
    // near-empty outlier cell can't define the whole zone's risk number.
    const weightSum  = cells.reduce((s,c)=>s+(c.predicted_daily_violations||0),0) || cells.length;
    const weightedRisk = cells.reduce((s,c)=>s+(c.predicted_risk_score||0)*((c.predicted_daily_violations||0)||1),0) / weightSum;
    const ghostCell = cells.find(c=>c.is_ghost_violation);
    const uncertainCell = cells.find(c=>c.high_forecast_uncertainty);
    out.push({
      police_station: station,
      predicted_risk_score: weightedRisk,
      predicted_daily_violations: totalDaily,
      predicted_7day_violations: totalWeek,
      cell_count: cells.length,
      is_ghost_violation: !!ghostCell,
      ghost_type: ghostCell?.ghost_type,
      ghost_reason: ghostCell?.ghost_reason,
      high_forecast_uncertainty: !!uncertainCell,
      validation_mae: uncertainCell?.validation_mae,
    });
  });
  return out;
}

function renderFcCards(w){
  // "All Windows" should still mean "Now" per zone (the model's current risk
  // read), not a free-for-all max across mixed windows — picking different
  // windows per station made the peak-window label meaningless.
  const windowToShow = w==='all' ? 0 : Number(w);
  const data = _forecasts.filter(f=>f.window_minutes===windowToShow);
  const arr = aggregateForecastByStation(data).sort((a,b)=>b.predicted_risk_score-a.predicted_risk_score);
  const winLabel = windowToShow===0?'Now':windowToShow===1440?'Next 24h':'+7 days';
  document.getElementById('fc-cards').innerHTML=arr.map(f=>{
    const s=f.predicted_risk_score,col=s>=.80?'var(--danger)':s>=.60?'var(--warn)':'var(--accent)';
    const daily=f.predicted_daily_violations;
    return `<div class="fc-card" style="border-left:3px solid ${s>=.80?'#ef4444':s>=.60?'#f97316':'#00b87a'}"><div class="fc-zone">${f.police_station}${f.high_forecast_uncertainty?` <span title="Highest prediction error in backtesting (±${Math.round(f.validation_mae)} violations/day for this cell)" style="font-size:9px;font-weight:700;color:var(--warn);background:var(--warn-light);border:1px solid rgba(249,115,22,.25);border-radius:4px;padding:1px 6px;margin-left:4px;vertical-align:middle">⚠ forecast uncertainty: high</span>`:''}</div><div class="fc-time">${winLabel} · ${f.cell_count} cell${f.cell_count===1?'':'s'}</div><div class="fc-score" style="color:${col}">${(s*100).toFixed(0)}<span style="font-size:12px;color:var(--muted);font-weight:400"> / 100</span></div><div class="risk-bar"><div class="risk-fill" style="width:${s*100}%;background:${col}"></div></div>${daily?`<div style="font-size:10px;color:var(--text2);margin-top:4px">~${daily.toFixed(0)} violations/day across zone</div>`:''} ${f.is_ghost_violation?`<span class="ghost-badge">👻 ${f.ghost_type==='TRUE_GHOST'?'Has a true ghost cell — zero recent activity':(f.ghost_reason||'Intermittent activity in part of zone')}</span>`:''}</div>`;
  }).join('');
}

// ── OFFICER ROUTING ───────────────────────────────────────────────────────────
const RCOLS=['#00b87a','#f59e0b','#3b82f6','#a78bfa','#f87171'];
function renderAdminRoutes(c){
  // Coverage stats derived from real allocation data
  const totalStops=_allocations.reduce((s,a)=>s+(a.n_stops||0),0);
  const totalKm=_allocations.reduce((s,a)=>s+(a.estimated_route_distance_km||0),0).toFixed(1);
  const criticalRoutes=_allocations.filter(a=>a.enforcement_priority==='CRITICAL'||a.enforcement_priority==='HIGH').length;
  const coveredHotspots=[...new Set(_allocations.flatMap(a=>a.station_sequence||[]))].length;
  c.innerHTML=`<div class="page active">
    <div class="kpi-grid" style="margin-bottom:14px">
      <div class="kpi warn"><div class="kpi-accent-bar"></div><div class="kpi-label">Patrol Routes</div><div class="kpi-val">${_allocations.length}</div><div class="kpi-sub">Deployed today</div></div>
      <div class="kpi ok"><div class="kpi-accent-bar"></div><div class="kpi-label">Total Stops</div><div class="kpi-val">${totalStops}</div><div class="kpi-sub">Across all routes</div></div>
      <div class="kpi danger"><div class="kpi-accent-bar"></div><div class="kpi-label">Critical/High Routes</div><div class="kpi-val">${criticalRoutes}</div><div class="kpi-sub">Priority enforcement</div></div>
      <div class="kpi purple"><div class="kpi-accent-bar"></div><div class="kpi-label">Zones Covered</div><div class="kpi-val">${coveredHotspots}</div><div class="kpi-sub">Unique stations</div></div>
    </div>
    <div class="two-col">
    <div><div class="panel">
      <div class="panel-title">🚔 Optimised Patrol Routes</div>
      <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap" id="route-filter-btns">
        ${[['all','All Routes'],['FOUR_WHEELER_PATROL','🚔 Four-Wheeler'],['TWO_WHEELER_PATROL','🏍 Two-Wheeler'],['TWO_WHEELER_RAPID_RESPONSE','⚡ Rapid Response']].map(([f,label],i)=>`<button class="sub-tab${i===0?' active':''}" onclick="filterAdminRoutes(this,'${f}')">${label}</button>`).join('')}
      </div>
      <div id="route-cards-list">
        ${_allocations.map((a,i)=>`<div class="route-card" data-veh="${a.assigned_vehicle_type}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <div style="font-weight:800;font-size:15px;color:${RCOLS[i%RCOLS.length]}">${a.route_id}</div>
            <div style="display:flex;gap:6px;align-items:center">
              <span style="font-size:11px;background:var(--panel2);color:var(--text2);padding:2px 8px;border-radius:4px;border:1px solid var(--border)">${a.assigned_vehicle_type}</span>
              <span style="font-size:10px;color:var(--muted)">~${a.estimated_coverage_mins}m</span>
            </div>
          </div>
          <div class="route-steps">${(a.station_sequence||[]).map((s,si)=>`${si>0?'<span class="route-arrow">→</span>':''}<span class="route-step">${s}</span>`).join('')}</div>
          <div style="font-size:10px;color:var(--muted);margin-bottom:5px">Officer: ${a.officer_id} · Priority violations: ${a.priority_violations||0}</div>
          <div style="font-size:11px;color:var(--text2);border-top:1px solid var(--border);padding-top:8px;line-height:1.6">${a.n_stops||(a.station_sequence||[]).length} stops · ${a.estimated_route_distance_km!=null?a.estimated_route_distance_km+' km':'—'} route · priority score ${(a.total_route_priority_score||0).toFixed(2)} · enforcement priority: <b style="color:${a.enforcement_priority==='CRITICAL'?'var(--danger)':a.enforcement_priority==='HIGH'?'var(--warn)':'var(--text2)'}">${a.enforcement_priority||'—'}</b></div>
        </div>`).join('')}
      </div>
    </div></div>
    <div><div class="panel" style="padding:14px">
      <div class="panel-title">🗺 Patrol Routes vs. Hotspot Coverage</div>
      <div style="font-size:11px;color:var(--text2);margin-bottom:8px">Patrol routes (coloured lines) overlaid on real enforcement hotspots. <span style="color:#ef4444;font-weight:700">●</span> CRITICAL &nbsp;<span style="color:#f97316;font-weight:700">●</span> HIGH &nbsp;<span style="color:#eab308;font-weight:700">●</span> MEDIUM</div>
      <div id="route-map" style="height:480px;border-radius:8px;overflow:hidden"></div>
      <div style="font-size:10px;color:var(--muted);margin-top:6px">Hotspot markers sized by violation volume. Click any marker or route for details.</div>
    </div></div>
  </div></div>`;
  setTimeout(initRouteMap,100);
}
function filterAdminRoutes(btn,f){
  document.querySelectorAll('#route-filter-btns .sub-tab').forEach(b=>b.classList.remove('active'));btn.classList.add('active');
  document.querySelectorAll('#route-cards-list .route-card').forEach(c=>{c.style.display=(f==='all'||c.dataset.veh.includes(f))?'block':'none';});
}
function initRouteMap(){
  if(routeMap){ try{routeMap.remove();}catch(e){} routeMap=null; }
  const el=document.getElementById('route-map');
  if(!el) return;
  routeMap=L.map('route-map',{zoomControl:true}).setView([12.975,77.580],12);
  L.tileLayer(getTileUrl(),{maxZoom:19,subdomains:'abcd'}).addTo(routeMap);

  // ── Layer 1: Hotspot danger zones from real EPS data ──────────────────────
  // Render top 80 hotspots as translucent circles sized by violation volume.
  // This gives spatial context: officers can see WHICH hotspots their routes hit.
  const maxViol=Math.max(...(_hotspots||[]).map(h=>h.total_violations),1);
  (_hotspots||[]).slice(0,80).forEach(h=>{
    if(!h.latitude||!h.longitude) return;
    const tierCol=h.hotspot_tier==='CRITICAL'?'#ef4444':h.hotspot_tier==='HIGH'?'#f97316':'#eab308';
    const r=6+Math.round((h.total_violations/maxViol)*18); // radius 6–24px
    L.circleMarker([h.latitude,h.longitude],{
      radius:r,color:tierCol,fillColor:tierCol,fillOpacity:0.18,weight:1.5
    }).addTo(routeMap).bindPopup(
      `<div style="font-size:12px"><b>${h.police_station}</b><br>`+
      `<span style="color:${tierCol};font-weight:700">${h.hotspot_tier}</span> · EPS ${(h.eps_score*100).toFixed(0)}<br>`+
      `${h.total_violations.toLocaleString()} violations · ${h.top_violation_type||''}<br>`+
      `${h.junction_name?'📍 '+h.junction_name:''}</div>`
    );
  });

  // ── Layer 2: Patrol route polylines + stop markers ───────────────────────
  // Coordinates in officer_deployment.json are [lat, lng] (Bengaluru ≈ 12.9°N, 77.5°E).
  // Leaflet expects [lat, lng], so use c[0], c[1] directly.
  _allocations.forEach((a,i)=>{
    const col=RCOLS[i%RCOLS.length],coords=a.optimized_path_coordinates||[];
    if(coords.length>1){
      const ll=coords.map(c=>[c[0],c[1]]);
      L.polyline(ll,{color:col,weight:3,opacity:.9,dashArray:a.assigned_vehicle_type.includes('TOWING')?null:'8,4'})
       .addTo(routeMap)
       .bindPopup(`<div style="font-size:12px"><b>${a.route_id}</b><br>${a.assigned_vehicle_type}<br>Officer: ${a.officer_id}<br>${a.n_stops} stops · ${a.estimated_route_distance_km||'—'} km<br>Priority: <b>${a.enforcement_priority||'—'}</b></div>`);
    }
    coords.forEach((c,ci)=>{
      if(!c[0]||!c[1]) return;
      L.circleMarker([c[0],c[1]],{radius:6,color:col,fillColor:'#fff',fillOpacity:1,weight:2})
       .addTo(routeMap)
       .bindPopup(`<div style="font-size:12px"><b>Stop ${ci+1}</b> — ${a.route_id}<br>${(a.station_sequence||[])[ci]||''}${ci===0?' 🟢 Start':ci===(coords.length-1)?' 🏁 End':''}</div>`);
    });
  });
}

// ── CONFIG & EXPORT ──────────────────────────────────────────────────────────
function renderAdminConfig(c){
  const cfg=_adminConfig;
  c.innerHTML=`<div class="page active"><div class="two-col">
    <div><div class="panel">
      <div class="panel-title">⚙️ System Threshold Configuration</div>
      <div style="font-size:12px;color:var(--text2);margin-bottom:12px">Changes take effect on next data cycle. Last updated: <span style="font-family:var(--mono)">${cfg.updated_at||'—'}</span></div>
      <div style="font-size:11px;color:var(--text2);background:var(--panel2);border:1px solid var(--border);border-radius:7px;padding:9px 13px;margin-bottom:14px;line-height:1.7">
        <b>Note:</b> These thresholds tune the display layer and alert triggers only. The underlying EPS formula weights (pipeline output) are fixed: violation volume 35%, daily persistence 20%, peak-hour concentration 15%, junction proximity 20%, repeat-offender rate 10%. Citizen complaints do <b>not</b> feed into EPS.
      </div>
      ${[['eps_weight_violations','Display: Violation Volume Weight','Visual weight for violation count in EPS breakdown display',cfg.eps_weight_violations,0,1,'0.01'],['eps_weight_delay','Display: Congestion Proxy Weight','Visual weight for congestion proxy (derived from citywide impact %)',cfg.eps_weight_delay,0,1,'0.01'],['urgent_eps_threshold','Urgent Alert Threshold','Minimum EPS to trigger a dispatch alert',cfg.urgent_eps_threshold,0.5,1,'0.01'],['ghost_violation_speed_drop_threshold_pct','Ghost Detection Sensitivity','Internally set by model. Display-only — do not modify in production.',cfg.ghost_violation_speed_drop_threshold_pct,10,80,'1'],['cache_ttl_seconds','Cache TTL (seconds)','How long data files are cached before re-reading from disk',cfg.cache_ttl_seconds||30,10,300,'10']].map(([key,label,desc,val,min,max,step])=>`<div class="cfg-row"><div class="cfg-label">${label}<div class="cfg-sub">${desc}</div></div><input class="cfg-input" type="number" id="cfg-${key}" value="${val}" min="${min}" max="${max}" step="${step}"/></div>`).join('')}
      <div style="margin-top:14px;display:flex;gap:8px">
        <button class="btn btn-primary" onclick="saveConfig()">Save Configuration</button>
        <button class="btn btn-outline" onclick="resetConfig()">Reset to Defaults</button>
      </div>
      <div id="cfg-status" style="margin-top:8px;font-size:12px;color:var(--accent);display:none">✓ Configuration saved.</div>
    </div></div>
    <div>
      <div class="panel">
        <div class="panel-title">📥 Analytics Export Engine</div>
        ${[['📋 Blind Spot Report (JSON)','Full AI explanation + complaint-to-action gaps','/api/v1/admin/export/blind-spots?fmt=json','blind-spots.json'],['📊 Blind Spot Report (CSV)','Tabular format for Excel / dashboard import','/api/v1/admin/export/blind-spots?fmt=csv','blind-spots.csv'],['🗺 Hotspot Inventory (JSON)','All H3 clusters with EPS scores','/api/v1/hotspots?limit=200','hotspots.json'],['🚦 Congestion Zones (JSON)','Pre-emptive commuter rerouting payload','/api/v1/congestion-zones','congestion.json']].map(([title,desc,url,filename])=>`<div style="background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:12px;margin-bottom:10px;display:flex;align-items:center;gap:12px"><div style="flex:1"><div style="font-weight:600;font-size:13px">${title}</div><div style="font-size:11px;color:var(--text2);margin-top:2px">${desc}</div></div><button class="btn btn-outline" style="font-size:12px;padding:7px 14px;white-space:nowrap" onclick="exportData('${url}','${filename}')">⬇ Download</button></div>`).join('')}
      </div>
      <div class="panel" id="pending-police-panel">
        <div class="panel-title">🚔 Pending Police Access Requests</div>
        <div id="pending-police-list" style="font-size:12px;color:var(--text2)">Loading…</div>
      </div>
      <div class="panel">
        <div class="panel-title">📈 Quick Stats</div>
        <div style="margin-bottom:14px">
          <div style="font-size:10px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">🧹 Data Quality & Ingestion Transparency</div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:8px">
            <div style="background:var(--surface);border-radius:6px;padding:8px;text-align:center"><div style="font-size:16px;font-weight:800;color:var(--accent)">298,445</div><div style="font-size:9px;color:var(--muted);margin-top:2px">Rows ingested</div></div>
            <div style="background:var(--surface);border-radius:6px;padding:8px;text-align:center"><div style="font-size:16px;font-weight:800;color:var(--warn)">5</div><div style="font-size:9px;color:var(--muted);margin-top:2px">Dropped (bad timestamp)</div></div>
            <div style="background:var(--surface);border-radius:6px;padding:8px;text-align:center"><div style="font-size:16px;font-weight:800;color:var(--text)">0</div><div style="font-size:9px;color:var(--muted);margin-top:2px">Dropped (bad coords/H3)</div></div>
          </div>
          <div style="background:var(--surface);border-radius:6px;padding:9px 11px;font-size:10px;color:var(--text2);line-height:1.6;border-left:3px solid var(--accent)">
            <b style="color:var(--text)">Scoring mode:</b> ALL validation statuses included (approved + pending/processing). Deliberate decision — both represent real parking events observed in the field. Approved-only run available via <code style="background:var(--panel2);padding:1px 4px;border-radius:3px">--approved-only</code> flag for cross-check.
          </div>
          <div style="background:var(--surface);border-radius:6px;padding:9px 11px;font-size:10px;color:var(--text2);line-height:1.6;margin-top:6px;border-left:3px solid var(--warn)">
            <b style="color:var(--text)">Vehicle plate note:</b> 100% of vehicle numbers are anonymized/placeholder codes in this dataset. Repeat-offender methodology is demonstrated but not actionable until integrated with real plate data.
          </div>
        </div>
        ${[['Total Violations Tracked',(_summary.total_violations_tracked||0).toLocaleString()],['Avg EPS Score',(_hotspots.reduce((s,h)=>s+h.eps_score,0)/Math.max(1,_hotspots.length)*100).toFixed(1)],['Under-enforced Zones',(_summary.citizen_accountability_blind_spots||0)+' zones'],['Data Period','Jan – May 2024']].map(([l,v])=>`<div style="display:flex;justify-content:space-between;padding:9px 0;border-bottom:1px solid var(--border);font-size:13px"><span style="color:var(--text2)">${l}</span><span style="font-weight:600;font-family:var(--mono)">${v}</span></div>`).join('')}
      </div>
    </div>
  </div></div>`;
  loadPendingPoliceRequests();
}
async function loadPendingPoliceRequests(){
  const el = document.getElementById('pending-police-list');
  if (!el) return;
  try {
    const res = await api('/api/v1/admin/police-requests');
    const reqs = res.requests || [];
    el.innerHTML = reqs.length ? reqs.map(r=>`
      <div style="background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-bottom:8px">
        <div style="font-weight:600;font-size:13px">${r.name}</div>
        <div style="font-size:11px;color:var(--text2);margin-top:2px">${r.email} · Badge ${r.badge_number||'—'} · ${r.assigned_unit||'—'}</div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn btn-primary" style="font-size:11px;padding:5px 10px" onclick="approvePoliceRequest('${r.user_id}')">Approve</button>
          <button class="btn btn-outline" style="font-size:11px;padding:5px 10px" onclick="rejectPoliceRequest('${r.user_id}')">Reject</button>
        </div>
      </div>`).join('') : `<div style="font-size:12px;color:var(--text2)">No pending requests.</div>`;
  } catch(e) {
    el.innerHTML = `<div style="font-size:12px;color:var(--danger)">Could not load requests.</div>`;
  }
}
async function approvePoliceRequest(userId){
  try { await api(`/api/v1/admin/police-requests/${userId}/approve`, {method:'POST'}); toast('Officer approved'); loadPendingPoliceRequests(); }
  catch(e) { toast('Approve failed: '+e.message, true); }
}
async function rejectPoliceRequest(userId){
  try { await api(`/api/v1/admin/police-requests/${userId}/reject`, {method:'POST'}); toast('Request rejected'); loadPendingPoliceRequests(); }
  catch(e) { toast('Reject failed: '+e.message, true); }
}
async function saveConfig(){
  const keys=['eps_weight_violations','eps_weight_delay','urgent_eps_threshold','ghost_violation_speed_drop_threshold_pct','cache_ttl_seconds'];
  const payload={};keys.forEach(k=>{const el=document.getElementById('cfg-'+k);if(el) payload[k]=parseFloat(el.value);});
  try{const res=await api('/api/v1/admin/config',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});_adminConfig=res.config;const st=document.getElementById('cfg-status');if(st){st.style.display='block';setTimeout(()=>st.style.display='none',3000);}toast('Configuration saved');}catch(e){toast('Save failed: '+e.message,true);}
}
function resetConfig(){
  const d={eps_weight_violations:0.35,eps_weight_delay:0.20,urgent_eps_threshold:0.75,ghost_violation_speed_drop_threshold_pct:40,cache_ttl_seconds:30};
  Object.entries(d).forEach(([k,v])=>{const el=document.getElementById('cfg-'+k);if(el) el.value=v;});
  toast('Defaults loaded — click Save to apply');
}
async function exportData(url,filename){
  try{const r=await fetch(API+url);const blob=await r.blob();const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=filename;a.click();toast('Downloaded '+filename);}catch(e){toast('Export failed',true);}
}