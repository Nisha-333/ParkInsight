/* ════════════════════════════════════════════════════════════════════════
   POLICE.JS — Police portal.
   Pages (each wired from core.js nav, fully standalone, own map lifecycle):
   Operations · Complaints · Hotspots · Patrol Route · Analytics · Evidence · SOS
   AI Copilot · live data from _hotspots / _forecasts / _myRoute / real complaints API
   ════════════════════════════════════════════════════════════════════════ */

'use strict';

// ── State ─────────────────────────────────────────────────────────────────────
let _activeLayers = new Set(['hotspots','complaints','route']);
let _copilotOpen = false;
let _opsMapRef = null;        // leaflet map on the Operations page
let _opsMarkers = { hotspots:[], complaints:[], route:[] };
let _opsComplaints = [];      // real complaints loaded from the API for this page

// ── MAIN ENTRY POINT: Operations page ────────────────────────────────────────
function renderPoliceOps(c) {
  c.innerHTML = buildOpsShell();
  setTimeout(() => {
    initOpsMap();
    renderOpsTaskPanel();
    loadOpsComplaints();
  }, 60);
}

function buildOpsShell() {
  return `
<div class="police-shell" id="police-shell" style="height:100%;position:relative">

  <!-- KPI BAR -->
  <div class="pc-kpi-bar">
    <div class="pc-kpi"><div class="pc-kpi-label">Critical Zones</div><div class="pc-kpi-val danger" id="pkpi-critical">${(_hotspots||[]).filter(h=>h.eps_score>=0.80).length}</div></div>
    <div class="pc-kpi"><div class="pc-kpi-label">High Priority Zones</div><div class="pc-kpi-val warn" id="pkpi-high">${(_hotspots||[]).filter(h=>h.eps_score>=0.65&&h.eps_score<0.80).length}</div></div>
    <div class="pc-kpi"><div class="pc-kpi-label">Open Complaints</div><div class="pc-kpi-val warn" id="pkpi-complaints">…</div></div>
    <div class="pc-kpi"><div class="pc-kpi-label">My Route Stops</div><div class="pc-kpi-val blue" id="pkpi-stops">${(_myRoute?.stops||[]).length}</div></div>
    <div class="pc-kpi"><div class="pc-kpi-label">Route Coverage</div><div class="pc-kpi-val ok" id="pkpi-coverage">${_myRoute?.estimated_coverage_mins ? _myRoute.estimated_coverage_mins+'m' : '—'}</div></div>
  </div>

  <!-- TWO-PANEL BODY: Map | Task Queue -->
  <div class="pc-body">

    <!-- CENTER: Map -->
    <div class="pc-center">
      <div class="pc-map-hud">
        <div class="pc-map-layer-bar" id="layer-bar">
          <button class="pc-layer-btn active red"   data-layer="hotspots"   onclick="toggleLayer('hotspots')">🔴 Hotspots</button>
          <button class="pc-layer-btn active amber" data-layer="complaints" onclick="toggleLayer('complaints')">📸 Complaints</button>
          <button class="pc-layer-btn active green"  data-layer="route"      onclick="toggleLayer('route')">🗺 My Route</button>
        </div>
      </div>

      <div class="pc-map-container">
        <div id="police-ops-map"></div>
      </div>

      <div class="pc-map-legend">
        <div class="pc-legend-row"><div class="pc-legend-dot" style="background:#ef4444"></div>Critical Hotspot</div>
        <div class="pc-legend-row"><div class="pc-legend-dot" style="background:#f59e0b"></div>High Hotspot</div>
        <div class="pc-legend-row"><div class="pc-legend-dot" style="background:#3b82f6"></div>Citizen Complaint</div>
        <div class="pc-legend-row"><div class="pc-legend-dot" style="background:#00d98e;border-radius:2px"></div>Patrol Route</div>
      </div>

      <div style="position:absolute;left:16px;bottom:16px;z-index:600;display:flex;flex-direction:column;gap:6px;align-items:flex-start">
        <button class="pc-emergency-btn" style="width:auto;max-width:220px;margin:0" onclick="triggerEmergency()">🆘 BROADCAST SOS</button>
        <button onclick="openSOSHistory()" style="background:rgba(13,17,23,.85);border:1px solid #30363d;color:#8b949e;border-radius:6px;padding:5px 10px;font-size:10px;cursor:pointer;backdrop-filter:blur(4px)">🕓 Recent SOS Activity</button>
      </div>

      <button class="pc-copilot-toggle" onclick="toggleCopilot()">AI COPILOT</button>
      <div class="pc-copilot-panel" id="copilot-panel">
        <div class="pc-copilot-hdr">
          <div class="pc-copilot-title">⚡ AI POLICE COPILOT</div>
          <button class="pc-copilot-close" onclick="toggleCopilot()">✕</button>
        </div>
        <div class="pc-copilot-msgs" id="copilot-msgs">
          <div class="pc-copilot-msg ai">
            <div class="copilot-label">PARKINSIGHT AI</div>
            Ready. I can help you prioritise hotspots, review your patrol route, and surface complaints in your zone.
          </div>
        </div>
        <div class="pc-copilot-suggestions">
          <button class="pc-copilot-chip" onclick="copilotQuery('Which hotspot should I visit next?')">Which hotspot next?</button>
          <button class="pc-copilot-chip" onclick="copilotQuery('Show unresolved complaints nearby')">Complaints nearby</button>
          <button class="pc-copilot-chip" onclick="copilotQuery('Show critical violations in my zone')">Critical violations</button>
        </div>
        <div class="pc-copilot-input-row">
          <input class="pc-copilot-input" id="copilot-input" placeholder="Ask anything…" onkeydown="if(event.key==='Enter')copilotSend()"/>
          <button class="pc-copilot-send" onclick="copilotSend()">➤</button>
        </div>
      </div>
    </div>

    <!-- RIGHT: Task & Complaint Queue -->
    <div class="pc-right">
      <div id="right-panel-content" style="display:flex;flex-direction:column;height:100%;overflow:hidden"></div>
    </div>

  </div><!-- /pc-body -->
</div><!-- /police-shell -->`;
}

// ── RIGHT PANEL: real hotspot queue + real complaints ────────────────────────
function renderOpsTaskPanel() {
  const rp = document.getElementById('right-panel-content');
  if (!rp) return;
  const topHotspots = [...(_hotspots||[])].sort((a,b)=>b.eps_score-a.eps_score).slice(0,5);

  rp.innerHTML = `
    <div class="pc-section-hdr">Priority Hotspots<span class="pc-hdr-badge">${topHotspots.length}</span></div>
    <div style="flex:1;overflow-y:auto;padding:8px;max-height:45%;scrollbar-width:thin;scrollbar-color:var(--pc-border2) transparent">
      ${topHotspots.map(h => buildHotspotTaskCard(h)).join('') || '<div style="padding:16px;color:var(--pc-text2);font-size:11px">No hotspot data loaded.</div>'}
    </div>
    <div class="pc-section-hdr">Citizen Complaints<span class="pc-hdr-badge" id="ops-complaint-count">…</span></div>
    <div id="ops-complaints-list" style="overflow-y:auto;flex:1;padding:8px;scrollbar-width:thin;scrollbar-color:var(--pc-border2) transparent">
      <div style="padding:16px;color:var(--pc-text2);font-size:11px">Loading…</div>
    </div>`;
}

function buildHotspotTaskCard(h) {
  const eps = h.eps_score || 0;
  const pri = eps >= 0.80 ? 'critical' : eps >= 0.65 ? 'high' : eps >= 0.50 ? 'medium' : 'low';
  const priLabel = pri.charAt(0).toUpperCase() + pri.slice(1);
  return `<div class="pc-task-card ${pri}" onclick="zoomToHotspot(${h.latitude},${h.longitude},'${h.police_station}')">
    <div class="pc-task-top">
      <div class="pc-task-id">${h.police_station}</div>
      <div class="pc-task-badge ${pri}">${priLabel}</div>
    </div>
    <div class="pc-task-loc">${h.junction_name || ''}</div>
    <div class="pc-task-meta">EPS ${(eps*100).toFixed(0)} · ${h.top_violation_type || ''} · ${(h.total_violations||0).toLocaleString()} violations</div>
  </div>`;
}

async function loadOpsComplaints() {
  const listEl = document.getElementById('ops-complaints-list');
  const countEl = document.getElementById('ops-complaint-count');
  const kpiEl = document.getElementById('pkpi-complaints');
  try {
    const res = await api('/api/v1/police/complaints?status=Pending&limit=10');
    _opsComplaints = res.complaints || [];
    if (countEl) countEl.textContent = res.count ?? _opsComplaints.length;
    if (kpiEl) kpiEl.textContent = res.count ?? _opsComplaints.length;
    if (listEl) {
      listEl.innerHTML = _opsComplaints.length
        ? _opsComplaints.map(buildOpsComplaintCard).join('')
        : '<div style="padding:16px;color:var(--pc-text2);font-size:11px">No pending complaints.</div>';
    }
    renderOpsMapLayers();
  } catch (e) {
    if (listEl) listEl.innerHTML = '<div style="padding:16px;color:var(--pc-text2);font-size:11px">Couldn\'t load complaints.</div>';
    if (kpiEl) kpiEl.textContent = '—';
  }
}

function buildOpsComplaintCard(c) {
  const id = c.complaint_id || c.id;
  return `<div class="pc-complaint-card">
    <div class="pc-complaint-top">
      <div class="pc-complaint-photo">📸</div>
      <div class="pc-complaint-info">
        <div class="pc-complaint-type">${c.violation_type || c.type || 'Violation report'}</div>
        <div class="pc-complaint-loc">${c.zone || c.location || 'Unknown zone'}</div>
        <div class="pc-complaint-time">${c.created_at ? new Date(c.created_at).toLocaleString() : ''}</div>
      </div>
    </div>
    <div class="pc-complaint-btns">
      <button class="pc-complaint-btn accept"  onclick="handleComplaint('${id}','Verified')">Verify</button>
      <button class="pc-complaint-btn resolve" onclick="handleComplaint('${id}','Action Taken')">Action Taken</button>
      <button class="pc-complaint-btn reject"  onclick="handleComplaint('${id}','Rejected')">Reject</button>
    </div>
  </div>`;
}

async function handleComplaint(id, newStatus) {
  try {
    await api(`/api/v1/police/complaints/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus, officer_note: `Updated by ${_user?.name||'Officer'} via Operations` })
    });
    toast(`${id}: marked ${newStatus} — citizen notified`);
  } catch(e) {
    toast(`${id}: couldn't update right now`, true);
  }
  loadOpsComplaints();
}

// ── OPS MAP ───────────────────────────────────────────────────────────────────
function initOpsMap() {
  if (_opsMapRef) { try { _opsMapRef.remove(); } catch(e) {} _opsMapRef = null; }
  const el = document.getElementById('police-ops-map');
  if (!el) return;

  _opsMapRef = L.map('police-ops-map', {
    zoomControl: true,
    attributionControl: false,
  }).setView([12.975, 77.580], 12);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19, subdomains: 'abcd'
  }).addTo(_opsMapRef);

  _policeMap = _opsMapRef;
  renderOpsMapLayers();
}

function renderOpsMapLayers() {
  if (!_opsMapRef) return;

  Object.values(_opsMarkers).flat().forEach(m => { try { _opsMapRef.removeLayer(m); } catch(e) {} });
  _opsMarkers = { hotspots:[], complaints:[], route:[] };

  const hs = _hotspots || [];

  // Hotspot layer — real EPS-scored zones
  hs.forEach(h => {
    if (!h.latitude) return;
    const col = h.eps_score >= 0.80 ? '#ef4444' : h.eps_score >= 0.65 ? '#f59e0b' : '#3b82f6';
    const r = 8 + h.eps_score * 14;
    const circle = L.circleMarker([h.latitude, h.longitude], {
      radius: r, color: col, fillColor: col, fillOpacity: .25, weight: 2,
    });
    circle.bindPopup(`<div class="pc-popup">
      <div class="pc-popup-title">${h.police_station} — ${h.junction_name || ''}</div>
      <div class="pc-popup-row"><span>EPS Score</span><b>${(h.eps_score*100).toFixed(0)}</b></div>
      <div class="pc-popup-row"><span>Tier</span><b style="color:${col}">${h.hotspot_tier||''}</b></div>
      <div class="pc-popup-row"><span>Violations</span><b>${(h.total_violations||0).toLocaleString()}</b></div>
      <div class="pc-popup-row"><span>Top violation</span><b>${h.top_violation_type||''}</b></div>
      <div class="pc-popup-row"><span>Action rate</span><b>${((h.action_rate||0)*100).toFixed(0)}%</b></div>
    </div>`);
    if (_activeLayers.has('hotspots')) circle.addTo(_opsMapRef);
    _opsMarkers.hotspots.push(circle);
  });

  // Complaint markers — real pending complaints, using zone's hotspot coords as a proxy location
  const stationCoords = {};
  hs.forEach(h => { if (h.latitude && !stationCoords[h.police_station]) stationCoords[h.police_station] = [h.latitude, h.longitude]; });
  _opsComplaints.forEach(c => {
    const coord = stationCoords[c.zone];
    if (!coord) return;
    const m = L.marker(coord, {
      icon: L.divIcon({ className:'', html:`<div style="background:#3b82f6;color:#fff;padding:3px 6px;border-radius:4px;font-size:10px;font-weight:700;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,.4)">📸 ${(c.violation_type||'Report').split(' ')[0]}</div>`, iconAnchor:[30,10] })
    });
    m.bindPopup(`<div class="pc-popup"><div class="pc-popup-title">${c.violation_type||'Citizen report'}</div><div class="pc-popup-row"><span>Zone</span><b>${c.zone||''}</b></div><div class="pc-popup-row"><span>Status</span><b>${c.status}</b></div></div>`);
    if (_activeLayers.has('complaints')) m.addTo(_opsMapRef);
    _opsMarkers.complaints.push(m);
  });

  // Patrol route polyline — real assigned route
  const stops = _myRoute?.stops || [];
  if (stops.length > 0) {
    const stopCoords = stops.filter(s => s.latitude).map(s => [s.latitude, s.longitude]);
    // Prefer optimized_path_coordinates if available (may include intermediate waypoints)
    const routeCoords = (_myRoute?.path_coordinates && _myRoute.path_coordinates.length > 1)
      ? _myRoute.path_coordinates.map(c => [c[0], c[1]])
      : stopCoords;
    if (routeCoords.length > 1) {
      const polyline = L.polyline(routeCoords, { color:'#00d98e', weight:2, dashArray:'6,4', opacity:.7 });
      if (_activeLayers.has('route')) polyline.addTo(_opsMapRef);
      _opsMarkers.route.push(polyline);
    }
    stopCoords.forEach((coord, i) => {
      const m = L.marker(coord, {
        icon: L.divIcon({ className:'', html:`<div style="background:#00d98e;color:#000;width:18px;height:18px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;border:2px solid rgba(0,217,142,.5)">${i+1}</div>`, iconSize:[18,18], iconAnchor:[9,9] })
      });
      if (_activeLayers.has('route')) m.addTo(_opsMapRef);
      _opsMarkers.route.push(m);
    });
  }
}

function toggleLayer(layer) {
  if (_activeLayers.has(layer)) {
    _activeLayers.delete(layer);
  } else {
    _activeLayers.add(layer);
  }
  // Update button style
  document.querySelectorAll(`[data-layer="${layer}"]`).forEach(btn => {
    const colorClass = btn.classList.contains('red') ? 'red' : btn.classList.contains('amber') ? 'amber' : btn.classList.contains('green') ? 'green' : btn.classList.contains('purple') ? 'purple' : '';
    btn.classList.toggle('active', _activeLayers.has(layer));
    if (colorClass && _activeLayers.has(layer)) btn.classList.add(colorClass);
  });
  renderOpsMapLayers();
}

function zoomToHotspot(lat, lon, id) {
  if (_opsMapRef) _opsMapRef.setView([lat, lon], 16, { animate: true });
  toast(`Zoomed to ${id}`);
}

// ── AI COPILOT ────────────────────────────────────────────────────────────────
function toggleCopilot() {
  _copilotOpen = !_copilotOpen;
  const panel = document.getElementById('copilot-panel');
  if (panel) panel.classList.toggle('open', _copilotOpen);
}

function copilotQuery(query) {
  document.getElementById('copilot-input').value = query;
  copilotSend();
}

async function copilotSend() {
  const inp = document.getElementById('copilot-input');
  if (!inp) return;
  const q = inp.value.trim();
  if (!q) return;
  inp.value = '';

  const msgs = document.getElementById('copilot-msgs');
  if (!msgs) return;

  // Use DOM appendChild (not innerHTML +=) to avoid destroying existing nodes
  const userBubble = document.createElement('div');
  userBubble.className = 'pc-copilot-msg user';
  userBubble.textContent = q;
  msgs.appendChild(userBubble);

  // Stable unique ID for the AI thinking bubble
  const thinkId = 'copilot-think-' + Date.now();
  const aiBubble = document.createElement('div');
  aiBubble.className = 'pc-copilot-msg ai';
  aiBubble.id = thinkId;
  aiBubble.innerHTML = `<div class="copilot-label">PARKINSIGHT AI</div><span class="pc-copilot-thinking">…</span>`;
  msgs.appendChild(aiBubble);
  msgs.scrollTop = msgs.scrollHeight;

  const page = document.querySelector('nav button.active')?.dataset.page || 'police-ops';
  try {
    const reply = await askCopilot(q, page);
    const el = document.getElementById(thinkId);
    if (el) {
      const fmt = (typeof marked !== 'undefined')
        ? marked.parse(reply || 'No response.')
        : (reply || 'No response.').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
      el.innerHTML = `<div class="copilot-label">PARKINSIGHT AI</div><div class="copilot-md">${fmt}</div>`;
    }
  } catch(e) {
    const el = document.getElementById(thinkId);
    if (el) el.innerHTML = `<div class="copilot-label">PARKINSIGHT AI</div>Sorry, I couldn't reach the assistant right now. Please try again shortly.`;
    console.error('Copilot error:', e);
  }
  msgs.scrollTop = msgs.scrollHeight;
}

// ── EMERGENCY SOS (Operations page button) ───────────────────────────────────
// Reuses the same real backend call as the standalone SOS page —
// no fake "broadcast" toast without an actual request going out.
function triggerEmergency() {
  triggerSOSBroadcast();
}

// Shared KPI bar used across the standalone police pages
function buildPoliceKpiBar() {
  const s = _summary || {};
  const hs = _hotspots || [];
  const criticalCount = hs.filter(h => h.eps_score >= 0.80).length || s.critical_hotspot_zones || 0;
  const highCount = hs.filter(h => h.eps_score >= 0.65 && h.eps_score < 0.80).length;
  return `<div class="pc-kpi-bar">
    <div class="pc-kpi"><div class="pc-kpi-label">Critical Zones</div><div class="pc-kpi-val danger">${criticalCount}</div></div>
    <div class="pc-kpi"><div class="pc-kpi-label">High Priority</div><div class="pc-kpi-val warn">${highCount}</div></div>
    <div class="pc-kpi"><div class="pc-kpi-label">Active Risk Zones</div><div class="pc-kpi-val danger">${s.active_risk_zones_now ?? '—'}</div></div>
    <div class="pc-kpi"><div class="pc-kpi-label">My Route Stops</div><div class="pc-kpi-val blue">${(_myRoute?.stops||[]).length}</div></div>
    <div class="pc-kpi"><div class="pc-kpi-label">Route Coverage</div><div class="pc-kpi-val ok">${_myRoute?.estimated_coverage_mins ? _myRoute.estimated_coverage_mins+'m' : '—'}</div></div>
  </div>`;
}

function buildPoliceCopilotBtn() {
  return `<button onclick="openPoliceCopilot()" style="position:fixed;bottom:24px;right:24px;z-index:999;background:linear-gradient(135deg,#7c3aed,#2563eb);color:#fff;border:none;border-radius:50px;padding:12px 20px;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 4px 20px rgba(124,58,237,.5);letter-spacing:.5px">⚡ AI COPILOT</button>
  <div id="police-copilot-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:1000;align-items:center;justify-content:center">
    <div style="background:#0d1117;border:1px solid #30363d;border-radius:12px;width:min(520px,95vw);max-height:80vh;display:flex;flex-direction:column;padding:0;overflow:hidden">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 20px;border-bottom:1px solid #30363d;background:linear-gradient(135deg,rgba(124,58,237,.2),rgba(37,99,235,.2))">
        <div style="font-weight:700;color:#e6edf3;font-size:15px">⚡ AI Police Copilot</div>
        <button onclick="document.getElementById('police-copilot-modal').style.display='none'" style="background:none;border:none;color:#8b949e;font-size:18px;cursor:pointer">✕</button>
      </div>
      <div id="pc-modal-msgs" style="flex:1;overflow-y:auto;padding:16px;min-height:200px;scrollbar-width:thin">
        <div style="background:rgba(124,58,237,.1);border:1px solid rgba(124,58,237,.2);border-radius:8px;padding:12px;margin-bottom:10px;font-size:13px;color:#c9d1d9">
          <div style="font-size:10px;color:#7c3aed;font-weight:700;margin-bottom:4px;letter-spacing:1px">PARKINSIGHT AI</div>
          Ready. Ask me about hotspot priorities, patrol routes, complaints, or enforcement tactics.
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px;padding:10px 16px;border-top:1px solid #30363d">
        ${['Which hotspot next?','Top priority complaint','Generate patrol route','Critical violations now'].map(q=>`<button onclick="policeCopilotQuery('${q}')" style="background:#161b22;border:1px solid #30363d;color:#8b949e;border-radius:20px;padding:5px 12px;font-size:11px;cursor:pointer;transition:all .2s" onmouseover="this.style.borderColor='#7c3aed';this.style.color='#c9d1d9'" onmouseout="this.style.borderColor='#30363d';this.style.color='#8b949e'">${q}</button>`).join('')}
      </div>
      <div style="display:flex;gap:8px;padding:12px 16px;border-top:1px solid #30363d">
        <input id="pc-modal-input" placeholder="Ask anything about operations…" onkeydown="if(event.key==='Enter')policeCopilotSend()" style="flex:1;background:#161b22;border:1px solid #30363d;border-radius:8px;padding:10px 14px;color:#e6edf3;font-size:13px;outline:none"/>
        <button onclick="policeCopilotSend()" style="background:#7c3aed;border:none;border-radius:8px;padding:10px 16px;color:#fff;font-size:14px;cursor:pointer">➤</button>
      </div>
    </div>
  </div>`;
}

function openPoliceCopilot() {
  document.getElementById('police-copilot-modal').style.display = 'flex';
}

function policeCopilotQuery(q) {
  document.getElementById('pc-modal-input').value = q;
  policeCopilotSend();
}

async function policeCopilotSend() {
  const inp = document.getElementById('pc-modal-input');
  if (!inp) return;
  const q = inp.value.trim();
  if (!q) return;
  inp.value = '';
  const msgs = document.getElementById('pc-modal-msgs');
  if (!msgs) return;

  // Use appendChild to avoid innerHTML += destroying existing DOM nodes
  const userDiv = document.createElement('div');
  userDiv.style.cssText = 'text-align:right;margin-bottom:8px';
  userDiv.innerHTML = `<span style="background:#1f2937;border-radius:8px;padding:8px 12px;font-size:13px;color:#e6edf3;display:inline-block;max-width:85%"></span>`;
  userDiv.querySelector('span').textContent = q;
  msgs.appendChild(userDiv);

  const thinkId = 'think-' + Date.now();
  const thinkDiv = document.createElement('div');
  thinkDiv.id = thinkId;
  thinkDiv.style.cssText = 'background:rgba(124,58,237,.1);border:1px solid rgba(124,58,237,.2);border-radius:8px;padding:12px;margin-bottom:10px;font-size:13px;color:#c9d1d9';
  thinkDiv.innerHTML = `<div style="font-size:10px;color:#7c3aed;font-weight:700;margin-bottom:4px;letter-spacing:1px">PARKINSIGHT AI</div><span style="opacity:.5">Thinking…</span>`;
  msgs.appendChild(thinkDiv);
  msgs.scrollTop = msgs.scrollHeight;

  const page = document.querySelector('nav button.active')?.dataset.page || 'police';
  try {
    const reply = await askCopilot(q, page);
    const el = document.getElementById(thinkId);
    if (el) {
      const fmt = (typeof marked !== 'undefined') ? marked.parse(reply || 'No response.') : (reply || 'No response.').replace(/\*\*(.*?)\*\*/g,'<strong>$1</strong>').replace(/\n/g,'<br>');
      el.innerHTML = `<div style="font-size:10px;color:#7c3aed;font-weight:700;margin-bottom:4px;letter-spacing:1px">PARKINSIGHT AI</div><div class="copilot-md">${fmt}</div>`;
    }
  } catch(e) {
    const el = document.getElementById(thinkId);
    if (el) el.innerHTML = `<div style="font-size:10px;color:#7c3aed;font-weight:700;margin-bottom:4px;letter-spacing:1px">PARKINSIGHT AI</div>Sorry, I couldn't reach the assistant right now. Please try again shortly.`;
  }
  msgs.scrollTop = msgs.scrollHeight;
}

// ── POLICE COMPLAINTS PAGE ────────────────────────────────────────────────────
let _liveComplaints = null;
async function renderPoliceComplaints(c) {
  c.innerHTML = `<div class="pc-page-wrap">
    ${buildPoliceKpiBar()}
    <div style="padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div style="font-size:16px;font-weight:700;color:var(--text)">📋 Citizen Complaints</div>
        <div style="display:flex;gap:8px">
          <select id="cmp-filter-status" onchange="filterPoliceComplaints()" class="pc-select">
            <option value="">All Status</option>
            <option value="Pending">Pending</option>
            <option value="Verified">Verified</option>
            <option value="Action Taken">Action Taken</option>
            <option value="Resolved">Resolved</option>
          </select>
          <button onclick="loadPoliceComplaints()" class="pc-btn-sm">↻ Refresh</button>
        </div>
      </div>
      <div id="police-complaints-list">
        <div style="text-align:center;padding:40px;color:var(--muted)">Loading complaints…</div>
      </div>
    </div>
    ${buildPoliceCopilotBtn()}
  </div>`;
  await loadPoliceComplaints();
}

async function loadPoliceComplaints() {
  const el = document.getElementById('police-complaints-list');
  if (!el) return;
  try {
    const status = document.getElementById('cmp-filter-status')?.value || '';
    const res = await api(`/api/v1/police/complaints${status ? '?status='+encodeURIComponent(status) : ''}`);
    _liveComplaints = res.complaints;
    renderComplaintsList(el, res.complaints);
  } catch(e) {
    el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted)">Couldn\'t load complaints. <button onclick="loadPoliceComplaints()" class="pc-btn-sm" style="margin-left:8px">Retry</button></div>';
  }
}

function renderComplaintsList(el, complaints) {
  if (!complaints || complaints.length === 0) {
    el.innerHTML = '<div style="text-align:center;padding:40px;color:var(--muted)">No complaints found</div>';
    return;
  }
  const statusColor = { Pending:'#f97316', Verified:'#3b82f6', 'Action Taken':'#00d98e', Resolved:'#00d98e', Rejected:'#6b7280' };
  el.innerHTML = `<div style="display:grid;gap:12px">
    ${complaints.map(cmp => { const id = cmp.complaint_id||cmp.id; return `
    <div onclick="openComplaintDetail('${id}')" style="cursor:pointer;background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:14px;border-left:3px solid ${statusColor[cmp.status]||'#f97316'};transition:border-color .15s" onmouseover="this.style.borderColor='#3b82f6'" onmouseout="this.style.borderColor='var(--border)'">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
        <div style="display:flex;gap:10px;align-items:flex-start;min-width:0">
          ${cmp.photo_base64 ? `<img src="${cmp.photo_base64}" style="width:48px;height:48px;border-radius:6px;object-fit:cover;flex-shrink:0"/>` : `<div style="width:48px;height:48px;border-radius:6px;background:var(--panel2);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0;color:var(--muted)">📋</div>`}
          <div style="min-width:0">
            <div style="font-size:13px;font-weight:700;color:var(--text)">${cmp.category||cmp.type||'Unknown'}</div>
            <div style="font-size:11px;color:var(--text2);margin-top:2px">📍 ${cmp.zone||cmp.location} · <span style="font-family:monospace">${id}</span></div>
            ${cmp.description ? `<div style="font-size:11px;color:var(--text2);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:340px">${cmp.description}</div>` : ''}
          </div>
        </div>
        <div style="text-align:right;flex-shrink:0;margin-left:12px">
          <span style="background:${statusColor[cmp.status]||'#f97316'}22;color:${statusColor[cmp.status]||'#f97316'};border:1px solid ${statusColor[cmp.status]||'#f97316'}44;border-radius:20px;padding:3px 10px;font-size:10px;font-weight:700">${cmp.status||'Pending'}</span>
          <div style="font-size:10px;color:var(--muted);margin-top:4px">${new Date(cmp.created_at||Date.now()).toLocaleString()}</div>
        </div>
      </div>
      <div style="font-size:10px;color:#3b82f6;margin-top:4px">Click to view full details →</div>
    </div>`; }).join('')}
  </div>`;
}

function openComplaintDetail(id) {
  const cmp = (_liveComplaints||[]).find(c => (c.complaint_id||c.id) === id);
  if (!cmp) { toast('Complaint not found', true); return; }
  const statusColor = { Pending:'#f97316', Verified:'#3b82f6', 'Action Taken':'#00d98e', Resolved:'#00d98e', Rejected:'#6b7280' };
  const col = statusColor[cmp.status]||'#f97316';
  let modal = document.getElementById('complaint-detail-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'complaint-detail-modal';
    modal.style = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:2000;display:flex;align-items:center;justify-content:center;padding:20px';
    document.body.appendChild(modal);
  }
  const actionButtons = cmp.status === 'Pending' ? `
    <button onclick="updateComplaintStatus('${id}','Verified')" style="flex:1;background:#1d4ed822;border:1px solid #1d4ed8;color:#60a5fa;border-radius:6px;padding:10px;font-size:12px;font-weight:700;cursor:pointer">✓ Verify</button>
    <button onclick="openActionForm('${id}')" style="flex:1;background:#14532d22;border:1px solid #16a34a;color:#4ade80;border-radius:6px;padding:10px;font-size:12px;font-weight:700;cursor:pointer">🚔 Log Action Taken</button>
    <button onclick="updateComplaintStatus('${id}','Rejected')" style="flex:1;background:#7f1d1d22;border:1px solid #b91c1c;color:#f87171;border-radius:6px;padding:10px;font-size:12px;font-weight:700;cursor:pointer">✗ Reject</button>
  ` : cmp.status === 'Verified' ? `
    <button onclick="openActionForm('${id}')" style="flex:1;background:#14532d22;border:1px solid #16a34a;color:#4ade80;border-radius:6px;padding:10px;font-size:12px;font-weight:700;cursor:pointer">🚔 Log Action Taken</button>
    <button onclick="updateComplaintStatus('${id}','Resolved')" style="flex:1;background:#1e3a5f22;border:1px solid #2563eb;color:#93c5fd;border-radius:6px;padding:10px;font-size:12px;font-weight:700;cursor:pointer">✅ Mark Resolved</button>
  ` : cmp.status === 'Action Taken' ? `
    <button onclick="updateComplaintStatus('${id}','Resolved')" style="flex:1;background:#1e3a5f22;border:1px solid #2563eb;color:#93c5fd;border-radius:6px;padding:10px;font-size:12px;font-weight:700;cursor:pointer">✅ Mark Resolved</button>
  ` : '<div style="font-size:12px;color:var(--muted);text-align:center;width:100%">No further actions — this complaint is closed.</div>';

  modal.innerHTML = `<div onclick="event.stopPropagation()" style="background:var(--panel);border:1px solid var(--border);border-radius:14px;width:min(520px,100%);max-height:88vh;overflow-y:auto;color:var(--text);font-family:'Inter',sans-serif">
    <div style="padding:18px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:flex-start">
      <div>
        <div style="font-size:16px;font-weight:800;color:var(--text)">${cmp.category||cmp.type||'Unknown'}</div>
        <div style="font-size:11px;color:var(--muted);font-family:monospace;margin-top:2px">${id}</div>
      </div>
      <button onclick="document.getElementById('complaint-detail-modal').remove()" style="background:none;border:none;color:var(--text2);font-size:20px;cursor:pointer;line-height:1">✕</button>
    </div>
    <div style="padding:18px">
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:14px">
        <span style="background:${col}22;color:${col};border:1px solid ${col}44;border-radius:20px;padding:4px 12px;font-size:11px;font-weight:700">${cmp.status||'Pending'}</span>
        ${cmp.submitted_as === 'guest' ? '<span style="background:var(--panel2);color:var(--text2);border:1px solid var(--border);border-radius:20px;padding:4px 12px;font-size:11px;font-weight:700">GUEST REPORT</span>' : ''}
      </div>

      ${cmp.photo_base64 ? `<img src="${cmp.photo_base64}" style="width:100%;max-height:320px;object-fit:contain;border-radius:8px;background:#000;margin-bottom:14px"/>` : `<div style="background:var(--panel2);border:1px dashed var(--border);border-radius:8px;padding:20px;text-align:center;color:var(--muted);font-size:12px;margin-bottom:14px">📷 No photo attached to this report</div>`}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
        <div style="background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:10px">
          <div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Zone</div>
          <div style="font-size:13px;font-weight:600;margin-top:2px;color:var(--text)">📍 ${cmp.zone||cmp.location||'—'}</div>
        </div>
        <div style="background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:10px">
          <div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Filed</div>
          <div style="font-size:13px;font-weight:600;margin-top:2px;color:var(--text)">${new Date(cmp.created_at||Date.now()).toLocaleString()}</div>
        </div>
      </div>

      ${cmp.latitude && cmp.longitude ? `<a href="https://www.google.com/maps?q=${cmp.latitude},${cmp.longitude}" target="_blank" style="display:block;background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:14px;color:#60a5fa;font-size:12px;text-decoration:none">🗺 ${cmp.latitude.toFixed(5)}, ${cmp.longitude.toFixed(5)} — open in Google Maps ↗</a>` : ''}

      <div style="margin-bottom:14px">
        <div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">Description</div>
        <div style="background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:12px;font-size:13px;line-height:1.6;color:var(--text)">${cmp.description || '<span style="color:var(--muted)">No description provided.</span>'}</div>
      </div>

      ${cmp.officer_note ? `<div style="margin-bottom:14px"><div style="font-size:9px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">Officer Note</div><div style="background:var(--panel2);border:1px solid var(--border);border-radius:8px;padding:12px;font-size:13px;color:var(--text)">👮 ${cmp.officer_note}</div></div>` : ''}

      <div id="action-form-area"></div>

      <div style="display:flex;gap:8px;flex-wrap:wrap">${actionButtons}</div>
    </div>
  </div>`;
  modal.onclick = () => modal.remove();
}

// Replaces the old standalone Evidence page — that page wrote a JSON file to
// disk that nothing else in the app ever read back. Capturing "what action
// was taken" right here, when resolving a complaint, makes the same
// information actually useful: it becomes the officer_note, which the
// citizen sees on their Track Complaint page.
function openActionForm(id) {
  const area = document.getElementById('action-form-area');
  if (!area) return;
  area.innerHTML = `<div style="background:var(--panel2);border:1px solid #16a34a;border-radius:8px;padding:14px;margin-bottom:14px">
    <div style="font-size:12px;font-weight:700;color:#4ade80;margin-bottom:10px">🚔 Log Action Taken</div>
    <div style="margin-bottom:10px"><label style="font-size:10px;color:var(--text2);display:block;margin-bottom:4px">Action</label>
      <select id="action-type-${id}" class="pc-select" style="width:100%;padding:8px 10px;font-size:13px">
        <option>Challan Issued</option><option>Tow Dispatched</option><option>Warning Given</option>
        <option>Vehicle Moved</option><option>Owner Contacted</option><option>FIR Filed</option>
      </select></div>
    <div style="margin-bottom:10px"><label style="font-size:10px;color:var(--text2);display:block;margin-bottom:4px">Notes (optional)</label>
      <textarea id="action-notes-${id}" placeholder="Additional details for the citizen…" class="pc-select" style="width:100%;padding:8px 10px;font-size:13px;min-height:60px;box-sizing:border-box"></textarea></div>
    <div style="display:flex;gap:8px">
      <button onclick="confirmActionTaken('${id}')" style="flex:1;background:#16a34a;border:none;color:#fff;border-radius:6px;padding:9px;font-size:12px;font-weight:700;cursor:pointer">✓ Confirm</button>
      <button onclick="document.getElementById('action-form-area').innerHTML=''" class="pc-btn-sm" style="padding:9px 14px;font-size:12px">Cancel</button>
    </div>
  </div>`;
}

function confirmActionTaken(id) {
  const action = document.getElementById(`action-type-${id}`)?.value || 'Action taken';
  const notes = document.getElementById(`action-notes-${id}`)?.value?.trim();
  const note = notes ? `${action} — ${notes}` : action;
  updateComplaintStatus(id, 'Action Taken', note);
}

// Terminal statuses end the workflow for this complaint — closing the modal
// there is correct. Verified/Action Taken are mid-workflow steps (the officer
// still has more buttons to click next), so closing the modal on those forced
// them to re-find and re-open the same complaint after every single click.
const TERMINAL_COMPLAINT_STATUSES = ['Resolved', 'Rejected'];

async function updateComplaintStatus(id, status, note) {
  const officer_note = note || `Updated by ${_user?.name||'Officer'}`;
  const isTerminal = TERMINAL_COMPLAINT_STATUSES.includes(status);
  let persisted = false;
  try {
    await api(`/api/v1/police/complaints/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status, officer_note })
    });
    toast(`${id} marked as ${status}`);
    persisted = true;
  } catch(e) {
    toast(`${id} marked as ${status} (local)`, true);
  }

  // Update our local copy so the list and modal both reflect the change
  // immediately, whether or not the PATCH round-trip succeeded.
  if (_liveComplaints) {
    const idx = _liveComplaints.findIndex(c => (c.complaint_id||c.id) === id);
    if (idx > -1) { _liveComplaints[idx].status = status; _liveComplaints[idx].officer_note = officer_note; }
  }
  const listEl = document.getElementById('police-complaints-list');
  if (listEl && _liveComplaints) renderComplaintsList(listEl, _liveComplaints);

  if (isTerminal) {
    document.getElementById('complaint-detail-modal')?.remove();
  } else if (document.getElementById('complaint-detail-modal')) {
    // Keep the modal open, just re-render it with the new status so the
    // next action in the workflow (e.g. Log Action Taken → Mark Resolved)
    // is one click away instead of requiring the list to be re-opened.
    openComplaintDetail(id);
  }

  // If the PATCH failed, still refresh from the server in the background so
  // we don't drift from what's actually persisted next time the page loads.
  if (!persisted) loadPoliceComplaints();
}

function filterPoliceComplaints() { loadPoliceComplaints(); }

// ── POLICE HOTSPOTS PAGE ──────────────────────────────────────────────────────
let _policeHotspotMap = null;
function renderPoliceHotspots(c) {
  const hotspots = [...(_hotspots || [])].sort((a,b) => b.eps_score - a.eps_score).slice(0, 30);
  c.innerHTML = `<div class="pc-page-wrap">
    ${buildPoliceKpiBar()}
    <div class="pc-split-layout">
      <div class="pc-sidebar">
        <div class="pc-section-title">🔥 Top Hotspots by EPS</div>
        ${hotspots.length === 0 ? `<div class="pc-empty">No hotspot data available.</div>` : hotspots.map(h => {
          const col = h.eps_score >= 0.80 ? '#ef4444' : h.eps_score >= 0.65 ? '#f97316' : '#f59e0b';
          return `<div onclick="if(_policeHotspotMap)_policeHotspotMap.setView([${h.latitude},${h.longitude}],16,{animate:true})" class="pc-card" style="border-left:3px solid ${col}">
          <div style="display:flex;justify-content:space-between">
            <div class="pc-card-title">${h.police_station}</div>
            <div style="font-size:18px;font-weight:900;color:${col}">${(h.eps_score*100).toFixed(0)}</div>
          </div>
          <div class="pc-card-meta">${h.junction_name||''} · ${h.top_violation_type||''} · ${(h.total_violations||0).toLocaleString()} violations</div>
        </div>`;
        }).join('')}
      </div>
      <div id="police-hotspot-map" style="height:100%"></div>
    </div>
    ${buildPoliceCopilotBtn()}
  </div>`;
  setTimeout(() => initPoliceHotspotMap(hotspots), 80);
}

function initPoliceHotspotMap(hotspots) {
  if (_policeHotspotMap) { try { _policeHotspotMap.remove(); } catch(e) {} _policeHotspotMap = null; }
  const el = document.getElementById('police-hotspot-map');
  if (!el) return;
  _policeHotspotMap = L.map('police-hotspot-map').setView([12.97, 77.59], 12);
  L.tileLayer(getTileUrl(), {maxZoom:19,subdomains:'abcd'}).addTo(_policeHotspotMap);
  (hotspots || []).forEach(h => {
    if (!h.latitude) return;
    const col = h.eps_score >= 0.80 ? '#ef4444' : h.eps_score >= 0.65 ? '#f97316' : '#f59e0b';
    L.circleMarker([h.latitude, h.longitude], { radius: 14, color: col, fillColor: col, fillOpacity: 0.4, weight: 2 })
      .addTo(_policeHotspotMap)
      .bindPopup(`<b>${h.police_station}</b><br>EPS: ${(h.eps_score*100).toFixed(0)} · ${h.hotspot_tier}<br>${h.top_violation_type||''} · ${(h.total_violations||0).toLocaleString()} violations`);
  });
}

// ── POLICE PATROL PAGE ────────────────────────────────────────────────────────
let _policePatrolMap = null;
function renderPolicePatrol(c) {
  const stops = _myRoute?.stops || [];
  // Build a fallback panel using top hotspots when no route is assigned
  const noRoutePanel = (() => {
    const topHs = [...(_hotspots||[])].sort((a,b)=>b.eps_score-a.eps_score).slice(0,8);
    if (!topHs.length) return `<div class="pc-empty">No route assigned and no hotspot data available. Please contact your station admin.</div>`;
    return `
      <div style="padding:12px;background:var(--warn-light);border:1px solid var(--warn);border-radius:8px;margin-bottom:12px;font-size:12px;color:var(--warn)">
        ⚠️ No patrol route has been assigned to your account yet. Showing top-priority hotspots in your city as a suggested starting point.
      </div>
      <div class="pc-section-title" style="margin-bottom:8px">🔥 Suggested Priority Locations</div>
      ${topHs.map((h,i)=>{
        const col = h.eps_score>=0.80?'#ef4444':h.eps_score>=0.65?'#f97316':'#f59e0b';
        return `<div class="pc-card" style="border-left:3px solid ${col};display:flex;gap:10px;align-items:flex-start"
                    onclick="if(_policePatrolMap)_policePatrolMap.setView([${h.latitude||12.97},${h.longitude||77.59}],15,{animate:true})">
          <div style="width:22px;height:22px;border-radius:50%;background:${col};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0;color:#fff">${i+1}</div>
          <div>
            <div class="pc-card-title">${h.police_station}${h.junction_name?' — '+h.junction_name:''}</div>
            <div class="pc-card-meta">EPS ${(h.eps_score*100).toFixed(0)} · ${h.hotspot_tier||''} · ${h.top_violation_type||''}</div>
          </div>
        </div>`;
      }).join('')}`;
  })();

  c.innerHTML = `<div class="pc-page-wrap">
    ${buildPoliceKpiBar()}
    <div class="pc-split-layout">
      <div class="pc-sidebar">
        <div class="pc-section-title">🚔 ${stops.length ? 'Optimized Patrol Route' : 'Patrol Route'}</div>
        ${stops.length ? `<div style="font-size:11px;color:var(--text2);margin-bottom:12px">${_myRoute?.assigned_vehicle ? _myRoute.assigned_vehicle.replace(/_/g,' ') + ' · ' : ''}${stops.length} stops · ~${_myRoute?.estimated_route_distance_km || '—'} km · ${_myRoute?.estimated_coverage_mins || '—'} min coverage</div>` : ''}
        ${stops.length === 0 ? noRoutePanel : stops.map((s,i) => {
          const col = s.priority === 'Critical' ? '#ef4444' : s.priority === 'High' ? '#f97316' : '#f59e0b';
          return `<div onclick="if(_policePatrolMap)_policePatrolMap.setView([${s.latitude},${s.longitude}],16,{animate:true})" class="pc-card" style="display:flex;gap:10px;align-items:flex-start">
          <div style="width:24px;height:24px;border-radius:50%;background:${col};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0;color:#fff">${s.stop_number || i+1}</div>
          <div>
            <div class="pc-card-title">${s.station}${s.junction ? ' — '+s.junction : ''}</div>
            <div class="pc-card-meta">${s.target_issue || ''} · <span style="color:${col}">${s.priority}</span> · EPS ${((s.eps_score||0)*100).toFixed(0)}</div>
          </div>
        </div>`;
        }).join('')}
      </div>
      <div id="police-patrol-map" style="height:100%"></div>
    </div>
    ${buildPoliceCopilotBtn()}
  </div>`;
  setTimeout(() => initPolicePatrolMap(stops), 80);
}

function initPolicePatrolMap(stops) {
  if (_policePatrolMap) { try { _policePatrolMap.remove(); } catch(e) {} _policePatrolMap = null; }
  const el = document.getElementById('police-patrol-map');
  if (!el) return;
  _policePatrolMap = L.map('police-patrol-map').setView([12.97, 77.59], 13);
  L.tileLayer(getTileUrl(), {maxZoom:19,subdomains:'abcd'}).addTo(_policePatrolMap);

  if (stops && stops.length > 0) {
    const latlngs = stops.filter(s => s.latitude).map((s,i) => {
      const col = s.priority === 'Critical' ? '#ef4444' : s.priority === 'High' ? '#f97316' : '#f59e0b';
      L.circleMarker([s.latitude, s.longitude], { radius: 14, color: col, fillColor: col, fillOpacity: 0.5, weight: 2 })
        .addTo(_policePatrolMap).bindPopup(`<b>Stop ${s.stop_number}: ${s.station}</b><br>${s.target_issue||''}`);
      return [s.latitude, s.longitude];
    });
    // Use optimized_path_coordinates from API response if available (may have
    // intermediate waypoints beyond the stop markers), otherwise fall back to
    // connecting stop coordinates in sequence.
    const pathCoords = (_myRoute?.path_coordinates && _myRoute.path_coordinates.length > 1)
      ? _myRoute.path_coordinates.map(c => [c[0], c[1]])
      : latlngs;
    if (pathCoords.length > 1) L.polyline(pathCoords, { color: '#00d98e', weight: 3, dashArray: '6,6' }).addTo(_policePatrolMap);
  } else {
    // No route - show top hotspots as a helpful fallback
    const topHs = [...(_hotspots||[])].sort((a,b)=>b.eps_score-a.eps_score).slice(0,8);
    topHs.forEach((h,i) => {
      if (!h.latitude) return;
      const col = h.eps_score>=0.80?'#ef4444':h.eps_score>=0.65?'#f97316':'#f59e0b';
      L.circleMarker([h.latitude, h.longitude], { radius: 14, color: col, fillColor: col, fillOpacity: 0.4, weight: 2 })
        .addTo(_policePatrolMap)
        .bindPopup(`<b>${i+1}. ${h.police_station}</b><br>EPS ${(h.eps_score*100).toFixed(0)} · ${h.hotspot_tier||''}<br>${h.top_violation_type||''}`);
    });
  }
}

// ── POLICE ANALYTICS PAGE ─────────────────────────────────────────────────────
// Real Chart.js visualizations driven entirely by the ML pipeline output
// (_hotspots / _forecasts), scoped to the officer's own patrol zones.
// Honest about data granularity: forecast only has 3 real windows (Now/+24h/+7d),
// so we chart those windows directly rather than fabricating a daily series.
let _epsChart = null, _violChart = null, _windowChart = null;

function renderPoliceAnalytics(c) {
  const myStations = [...new Set((_myRoute?.stops || []).map(s => s.station).filter(Boolean))];
  const allHs = _hotspots || [];
  const allFc = _forecasts || [];

  let hs = myStations.length ? allHs.filter(h => myStations.includes(h.police_station)) : allHs;
  if (!hs.length) hs = allHs;
  hs = [...hs].sort((a,b) => b.eps_score - a.eps_score).slice(0, 8);

  const fcByStationWindow = {};
  allFc.forEach(f => {
    const key = f.police_station;
    if (!fcByStationWindow[key]) fcByStationWindow[key] = {};
    if (!fcByStationWindow[key][f.window_minutes] || f.predicted_risk_score > fcByStationWindow[key][f.window_minutes].predicted_risk_score) {
      fcByStationWindow[key][f.window_minutes] = f;
    }
  });

  const scopeLabel = myStations.length ? myStations.join(' · ') : 'Citywide (no zone assigned)';

  // Violation-type composition across the scoped zones (real categorical counts)
  const violCounts = {};
  hs.forEach(h => { const t = h.top_violation_type || 'Unspecified'; violCounts[t] = (violCounts[t]||0) + 1; });

  c.innerHTML = `<div class="pc-page-wrap">
    ${buildPoliceKpiBar()}
    <div style="padding:20px;max-width:1280px;margin:0 auto">

      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px;flex-wrap:wrap;gap:8px">
        <div style="font-size:16px;font-weight:700;color:var(--text)">📊 Zone Analytics</div>
        <div style="font-size:11px;color:var(--text2)">Scope: <b style="color:var(--text)">${scopeLabel}</b></div>
      </div>
      <div style="font-size:10px;color:var(--muted);margin-bottom:18px">From the enforcement pipeline (Jan–May 2024 dataset) · not live counts</div>

      ${hs.length === 0 ? `<div style="padding:30px;text-align:center;color:var(--muted);background:var(--panel);border:1px solid var(--border);border-radius:10px">No hotspot data available for this zone.</div>` : `

      <!-- Row 1: EPS ranking + Violation composition -->
      <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:16px;margin-bottom:16px;align-items:stretch">
        <div style="background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:16px;display:flex;flex-direction:column">
          <div style="font-size:13px;font-weight:700;margin-bottom:2px;color:var(--text)">🔥 EPS Score by Zone</div>
          <div style="font-size:10px;color:var(--muted);margin-bottom:10px">Higher = more enforcement priority</div>
          <div style="flex:1;min-height:260px;position:relative"><canvas id="eps-chart"></canvas></div>
        </div>
        <div style="background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:16px;display:flex;flex-direction:column">
          <div style="font-size:13px;font-weight:700;margin-bottom:2px;color:var(--text)">🚧 Violation Type Mix</div>
          <div style="font-size:10px;color:var(--muted);margin-bottom:10px">Most common violation per zone, scoped above</div>
          <div style="flex:1;min-height:260px;position:relative;display:flex;align-items:center;justify-content:center"><canvas id="viol-chart"></canvas></div>
        </div>
      </div>

      <!-- Row 2: Forecast risk by real time window -->
      <div style="background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:16px">
        <div style="font-size:13px;font-weight:700;margin-bottom:2px;color:var(--text)">⚡ Forecast Risk by Window</div>
        <div style="font-size:10px;color:var(--muted);margin-bottom:10px">Model output has three real windows — Now, +24h, +7d. No daily interpolation shown.</div>
        <div style="height:260px;position:relative"><canvas id="window-chart"></canvas></div>
      </div>

      <!-- Row 3: Per-zone detail cards -->
      <div style="font-size:13px;font-weight:700;margin-bottom:10px;color:var(--text)">🔍 Zone Detail</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:14px">
        ${hs.map(h => {
          const eps = h.eps_score || 0;
          const col = eps >= 0.80 ? '#ef4444' : eps >= 0.65 ? '#f97316' : '#f59e0b';
          const w = Math.round(eps * 100);
          const fcNow = fcByStationWindow[h.police_station]?.[0];
          const fc7d = fcByStationWindow[h.police_station]?.[10080];
          return `<div style="background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:14px">
            <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
              <div style="font-size:12px;font-weight:700;color:var(--text);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h.police_station}</div>
              <div style="font-size:9px;color:var(--muted);flex-shrink:0">${h.hotspot_tier || ''}</div>
            </div>
            <div style="font-size:10px;color:var(--text2);margin-bottom:8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${h.junction_name || ''}</div>
            <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:8px">
              <div style="font-size:26px;font-weight:900;color:${col}">${w}</div>
              <div style="font-size:9px;color:var(--text2)">EPS</div>
            </div>
            <div style="background:var(--panel2);border-radius:4px;height:5px;overflow:hidden;margin-bottom:10px">
              <div style="background:${col};height:100%;width:${w}%"></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:10px;color:var(--text2)">
              <div>Violations: <b style="color:var(--text)">${(h.total_violations||0).toLocaleString()}</b></div>
              <div>Action rate: <b style="color:#4ade80">${((h.action_rate||0)*100).toFixed(0)}%</b></div>
              <div>Repeat vehicles: <b style="color:var(--text)">${((h.repeat_vehicle_rate||0)*100).toFixed(0)}%</b></div>
              <div>Peak-hour share: <b style="color:var(--text)">${((h.peak_hour_ratio||0)*100).toFixed(0)}%</b></div>
            </div>
            ${fc7d ? `<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border);font-size:10px;color:var(--text2)">
              Forecast next 7 days: <b style="color:#f59e0b">${Math.round(fc7d.predicted_7day_violations||0).toLocaleString()}</b> violations <span style="color:var(--muted);font-style:italic">(est. — fixed decay, not a separate model)</span>
              ${fcNow?.is_ghost_violation ? `<div style="margin-top:3px;color:#a78bfa">👻 Ghost zone — ${(fcNow.ghost_reason || 'irregular recent activity').toLowerCase()}</div>` : ''}
            </div>` : ''}
          </div>`;
        }).join('')}
      </div>
      `}
    </div>
    ${buildPoliceCopilotBtn()}
  </div>`;

  if (hs.length) setTimeout(() => initAnalyticsCharts(hs, violCounts, fcByStationWindow), 60);
}

function initAnalyticsCharts(hs, violCounts, fcByStationWindow) {
  [_epsChart, _violChart, _windowChart].forEach(ch => { try { ch?.destroy(); } catch(e) {} });

  const tierColor = h => h.eps_score >= 0.80 ? '#ef4444' : h.eps_score >= 0.65 ? '#f97316' : '#f59e0b';
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark' || _currentTheme === 'dark';
  const gridColor = isDark ? 'rgba(255,255,255,.06)' : 'rgba(0,0,0,.06)';
  const textColor = isDark ? '#8b949e' : '#475569';

  // ── Chart 1: EPS by zone (horizontal bar) ──
  const epsEl = document.getElementById('eps-chart');
  if (epsEl) {
    _epsChart = new Chart(epsEl, {
      type: 'bar',
      data: {
        labels: hs.map(h => h.police_station),
        datasets: [{
          data: hs.map(h => +(h.eps_score*100).toFixed(1)),
          backgroundColor: hs.map(tierColor),
          borderRadius: 4,
          maxBarThickness: 26,
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => `EPS ${ctx.parsed.x}` } }
        },
        scales: {
          x: { min: 0, max: 100, grid: { color: gridColor }, ticks: { color: textColor, font: { size: 10 } } },
          y: { grid: { display: false }, ticks: { color: textColor, font: { size: 10 } } }
        }
      }
    });
  }

  // ── Chart 2: Violation type composition (doughnut) ──
  const violEl = document.getElementById('viol-chart');
  if (violEl) {
    const labels = Object.keys(violCounts);
    const palette = ['#3b82f6','#ef4444','#f59e0b','#00d98e','#a78bfa','#f97316','#06b6d4','#ec4899'];
    _violChart = new Chart(violEl, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: Object.values(violCounts),
          backgroundColor: labels.map((_,i) => palette[i % palette.length]),
          borderColor: '#161b22',
          borderWidth: 2,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'bottom', labels: { color: textColor, font: { size: 9 }, boxWidth: 10, padding: 8 } }
        }
      }
    });
  }

  // ── Chart 3: Forecast risk by real window (grouped bar) ──
  const winEl = document.getElementById('window-chart');
  if (winEl) {
    const windows = [[0,'Now'],[1440,'+24h'],[10080,'+7d']];
    _windowChart = new Chart(winEl, {
      type: 'bar',
      data: {
        labels: hs.map(h => h.police_station),
        datasets: windows.map(([wm, label], i) => ({
          label,
          data: hs.map(h => {
            const f = fcByStationWindow[h.police_station]?.[wm];
            return f ? +(f.predicted_risk_score*100).toFixed(1) : 0;
          }),
          backgroundColor: ['#3b82f6','#f59e0b','#ef4444'][i],
          borderRadius: 3,
          maxBarThickness: 18,
        }))
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { position: 'top', labels: { color: textColor, font: { size: 10 } } }
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: textColor, font: { size: 9 }, maxRotation: 25, minRotation: 0 } },
          y: { min: 0, max: 100, grid: { color: gridColor }, ticks: { color: textColor, font: { size: 10 } } }
        }
      }
    });
  }
}

// ── POLICE SOS (history modal, triggered from the Operations map button) ────
function openSOSHistory() {
  let modal = document.getElementById('sos-history-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'sos-history-modal';
    modal.style = 'position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:2000;display:flex;align-items:center;justify-content:center;padding:20px';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `<div onclick="event.stopPropagation()" style="background:#0d1117;border:1px solid #30363d;border-radius:14px;width:min(440px,100%);max-height:80vh;overflow-y:auto;color:#e6edf3;font-family:'Inter',sans-serif">
    <div style="padding:16px;border-bottom:1px solid #30363d;display:flex;justify-content:space-between;align-items:center">
      <div style="font-size:14px;font-weight:800">🆘 Recent SOS Activity</div>
      <button onclick="document.getElementById('sos-history-modal').remove()" style="background:none;border:none;color:#8b949e;font-size:18px;cursor:pointer">✕</button>
    </div>
    <div id="sos-events-list" style="padding:16px"><div style="padding:16px;text-align:center;color:#8b949e;font-size:11px">Loading…</div></div>
  </div>`;
  modal.onclick = () => modal.remove();
  loadSOSEvents();
}

async function loadSOSEvents() {
  const el = document.getElementById('sos-events-list');
  if (!el) return;
  try {
    const res = await api('/api/v1/admin/sos-queue');
    const flags = res.flags || [];
    el.innerHTML = flags.length ? flags.slice(0,8).map(f => `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #30363d">
        <div><div style="font-size:12px;color:#c9d1d9">${f.issue || 'Emergency flag'}${f.officer_id ? ' · '+f.officer_id : ''}</div><div style="font-size:10px;color:#6b7280">${f.created_at ? new Date(f.created_at).toLocaleString() : ''}</div></div>
        <span style="font-size:10px;font-weight:700;color:${f.resolved ? '#00d98e' : '#ef4444'};flex-shrink:0;margin-left:8px">${f.resolved ? 'RESOLVED' : 'ACTIVE'}</span>
      </div>`).join('') : '<div style="padding:16px;text-align:center;color:#8b949e;font-size:11px">No SOS events recorded.</div>';
  } catch(e) {
    el.innerHTML = '<div style="padding:16px;text-align:center;color:#8b949e;font-size:11px">Couldn\'t load SOS history.</div>';
  }
}

async function triggerSOSBroadcast() {
  const firstStop = (_myRoute?.stops || [])[0];
  const lat = firstStop?.latitude ?? 12.9767;
  const lon = firstStop?.longitude ?? 77.5774;
  try {
    const res = await api('/api/v1/police/emergency-flag', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ officer_id: _user?.user_id, latitude: lat, longitude: lon, issue: 'Emergency bottleneck', needs_heavy_tow: true })
    });
    toast('🆘 SOS BROADCAST SENT — ' + res.flag_id);
  } catch(e) {
    toast('🆘 Couldn\'t send SOS broadcast — please try again', true);
  }
  if (document.getElementById('sos-history-modal')) loadSOSEvents();
}